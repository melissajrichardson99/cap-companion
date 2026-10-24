#!/usr/bin/env bash
# Build a cleaned copy of this repo's history for the public version, in a
# scratch folder. It never touches the source repo: it makes its own fresh
# clones under --work and rewrites only those.
#
# What the rewrite does (git filter-repo, commit count kept):
#   - strips EXIF/GPS/XMP/IPTC/comment metadata from every JPEG/PNG/WebP blob
#     in every commit (scripts/check-image-metadata.py strip_bytes; lossless,
#     aborts on an EXIF-rotated photo instead of turning it sideways)
#   - removes historical build artefacts that are not in the current tree:
#     frontend/public/games/**, Godot .godot/ caches, any other .wasm/.pck
#   - removes the paths listed in --withhold (default scripts/withhold-paths.txt)
#   - with --author-email, rewrites author/committer identity via a mailmap
#
# Then it verifies the result (tree compare, commit count, blob metadata scan,
# secrets scan, fresh-checkout build + tests, sizes) and writes
# <work>/report.txt. Nothing is pushed.
#
# Usage:
#   scripts/prepare-public-history.sh --work DIR [--source REPO]
#       [--withhold FILE] [--author-email EMAIL [--author-name NAME]]
#       [--env-file FILE [--env-allow KEYS]] [--python PY] [--skip-build]
#
#   --work DIR     scratch folder; must not exist yet, must be outside --source
#   --source REPO  repo to clone (path or URL); default: this script's repo.
#                  Cloned with --no-local --bare: only its branches and tags
#                  are copied, never remote-tracking refs.
#   --env-file F   also count occurrences of each value in F (8+ chars) in the
#                  rewritten history; prints key names and counts only
#   --env-allow K  comma-separated keys whose values are public by design
#                  (e.g. FRONTEND_BASE_URL,RESEND_FROM_ADDRESS): reported,
#                  but they don't fail the run
#   --python PY    base interpreter for the venvs (default: python3 or python)
#   --skip-build   skip the fresh-checkout frontend build and backend tests
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
WITHHOLD="$SCRIPT_DIR/withhold-paths.txt"
WORK="" AUTHOR_EMAIL="" AUTHOR_NAME="" ENV_FILE="" ENV_ALLOW="" SKIP_BUILD=0
PY=""
for cand in python3 python; do   # Windows' python3 can be a Store stub that only prints a hint
  if "$cand" -c 'import sys' >/dev/null 2>&1; then PY="$cand"; break; fi
done

while [ $# -gt 0 ]; do
  case "$1" in
    --work) WORK="$2"; shift 2 ;;
    --source) SOURCE="$2"; shift 2 ;;
    --withhold) WITHHOLD="$2"; shift 2 ;;
    --author-email) AUTHOR_EMAIL="$2"; shift 2 ;;
    --author-name) AUTHOR_NAME="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --env-allow) ENV_ALLOW="$2"; shift 2 ;;
    --python) PY="$2"; shift 2 ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    -h|--help) sed -n '2,/^set -euo/p' "$0" | sed '$d; s/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

die() { echo "ERROR: $*" >&2; exit 1; }
[ -n "$WORK" ] || die "--work DIR is required"
[ ! -e "$WORK" ] || die "$WORK already exists; pick a new folder"
[ -f "$WITHHOLD" ] || die "withhold file not found: $WITHHOLD"
[ -z "$AUTHOR_NAME" ] || [ -n "$AUTHOR_EMAIL" ] || die "--author-name needs --author-email"
if grep -qE '^regex:' "$WITHHOLD"; then die "$WITHHOLD: only plain paths and glob: lines are supported"; fi
mkdir -p "$WORK"
WORK="$(cd "$WORK" && pwd)"
if [ -d "$SOURCE" ]; then
  SOURCE_ABS="$(cd "$SOURCE" && pwd)"
  case "$WORK/" in "$SOURCE_ABS"/*) rmdir "$WORK"; die "--work must be outside the source repo" ;; esac
fi

REPORT="$WORK/report.txt"
log() { echo "$*" | tee -a "$REPORT"; }
HELPER="$SCRIPT_DIR/verify-public-history.py"
STRIP="$SCRIPT_DIR/check-image-metadata.py"
# Snapshot the helpers so a later checkout in the source repo can't change them mid-run.
mkdir -p "$WORK/tools"
cp "$HELPER" "$STRIP" "$WITHHOLD" "$WORK/tools/"
HELPER="$WORK/tools/verify-public-history.py"
STRIP="$WORK/tools/check-image-metadata.py"
WITHHOLD="$WORK/tools/$(basename "$WITHHOLD")"

venv_bin() { if [ -d "$1/Scripts" ]; then echo "$1/Scripts"; else echo "$1/bin"; fi; }

log "== prepare-public-history $(date -u +%Y-%m-%dT%H:%M:%SZ)"
log "source: $SOURCE"
log "work:   $WORK"

# ---------------------------------------------------------------- tools
"$PY" -m venv "$WORK/venv"
VBIN="$(venv_bin "$WORK/venv")"
"$VBIN/python" -m pip install -q --disable-pip-version-check git-filter-repo==2.47.0 detect-secrets==1.5.0
FILTER_REPO=("$VBIN/python" -m git_filter_repo)
log "git-filter-repo $("${FILTER_REPO[@]}" --version)"

# ---------------------------------------------------------------- clones
git clone -q --no-local --bare "$SOURCE" "$WORK/before.git"
git clone -q --no-local --bare "$WORK/before.git" "$WORK/public.git"   # filter-repo drops its origin remote itself
COMMITS_BEFORE="$(git -C "$WORK/before.git" rev-list --all --count)"
log "branches: $(git -C "$WORK/before.git" for-each-ref --format='%(refname:short)' refs/heads | tr '\n' ' ')"
log "tags: $(git -C "$WORK/before.git" tag | wc -l | tr -d ' ')"

# ---------------------------------------------------------------- what goes
log ""
log "== removal list"
"$VBIN/python" "$HELPER" artefacts "$WORK/before.git" "$WORK/artefact-paths.txt" | tee -a "$REPORT"
log "artefact path list: $WORK/artefact-paths.txt"
grep -vE '^[[:space:]]*(#|$)' "$WITHHOLD" > "$WORK/withhold-active.txt" || true
log "withheld (from $(basename "$WITHHOLD")): $(wc -l < "$WORK/withhold-active.txt" | tr -d ' ') rule(s)"
sed 's/^/  /' "$WORK/withhold-active.txt" | tee -a "$REPORT"
cat "$WORK/artefact-paths.txt" "$WORK/withhold-active.txt" > "$WORK/remove-paths.txt"

# ---------------------------------------------------------------- rewrite
FILTER_ARGS=(--prune-empty never --prune-degenerate never)
if [ -s "$WORK/remove-paths.txt" ]; then
  FILTER_ARGS+=(--invert-paths --paths-from-file "$WORK/remove-paths.txt")
fi
# The path is embedded in Python source, so Git Bash won't translate /tmp/...-style
# paths for a Windows Python the way it does for plain arguments.
if command -v cygpath >/dev/null 2>&1; then STRIP_PY="$(cygpath -m "$STRIP")"; else STRIP_PY="$STRIP"; fi
FILTER_ARGS+=(--blob-callback "
import sys
m = sys.modules.get('cap_strip')
if m is None:
    import importlib.util as u
    s = u.spec_from_file_location('cap_strip', r'$STRIP_PY')
    m = u.module_from_spec(s)
    s.loader.exec_module(m)
    sys.modules['cap_strip'] = m
blob.data = m.strip_bytes(blob.data)
")
if [ -n "$AUTHOR_EMAIL" ]; then
  : > "$WORK/mailmap"
  git -C "$WORK/before.git" log --all --format='%an%x09%ae%n%cn%x09%ce' | sort -u | while IFS=$'\t' read -r name email; do
    [ "$email" = "noreply@github.com" ] && continue   # GitHub web-merge committer stays as is
    printf '%s <%s> %s <%s>\n' "${AUTHOR_NAME:-$name}" "$AUTHOR_EMAIL" "$name" "$email" >> "$WORK/mailmap"
  done
  FILTER_ARGS+=(--mailmap "$WORK/mailmap")
  log "identity rewrite: $(wc -l < "$WORK/mailmap" | tr -d ' ') identity(ies) -> new email (mailmap: $WORK/mailmap)"
else
  log "identity rewrite: none (authors left alone)"
fi

log ""
log "== git filter-repo"
( cd "$WORK/public.git" && "${FILTER_REPO[@]}" "${FILTER_ARGS[@]}" ) 2>&1 | tail -n 5 | tee -a "$REPORT"
git -C "$WORK/public.git" reflog expire --expire=now --all
git -C "$WORK/public.git" gc -q --prune=now --aggressive
git -C "$WORK/before.git" gc -q --prune=now --aggressive

# ---------------------------------------------------------------- verify
FAIL=0
check() { if "$@" 2>&1 | tee -a "$REPORT"; then :; else FAIL=1; fi; }
log ""
log "== verify"
COMMITS_AFTER="$(git -C "$WORK/public.git" rev-list --all --count)"
if [ "$COMMITS_BEFORE" = "$COMMITS_AFTER" ]; then log "commit count: $COMMITS_BEFORE -> $COMMITS_AFTER (unchanged)"
else log "commit count: $COMMITS_BEFORE -> $COMMITS_AFTER  PROBLEM"; FAIL=1; fi
check "$VBIN/python" "$HELPER" compare "$WORK/before.git" "$WORK/public.git" "$WORK/withhold-active.txt"
log "before (for reference):"
"$VBIN/python" "$HELPER" scan "$WORK/before.git" 2>&1 | tee -a "$REPORT" || true
log "after:"
check "$VBIN/python" "$HELPER" scan "$WORK/public.git"
size_pack() { git -C "$1" count-objects -v | awk '/^size-pack/ {printf "%.1f MiB", $2/1024}'; }
log "repo size (packed, after gc --aggressive): before $(size_pack "$WORK/before.git"), after $(size_pack "$WORK/public.git")"

# secrets: detect-secrets over the full patch history, chunked (it silently
# finds nothing in one huge file), with a planted canary to prove it ran.
log ""
log "== secrets scan (rewritten history)"
mkdir -p "$WORK/secrets/chunks"
git -C "$WORK/public.git" log --all -p --format='commit %H' > "$WORK/secrets/history.patch"
( cd "$WORK/secrets/chunks" && split -l 3000 -a 4 "$WORK/secrets/history.patch" chunk_ )
printf 'aws_access_key_id = "AKIA%s"\n' "QYLPMN5HHHFPZAM2" > "$WORK/secrets/chunks/zz_canary"
( cd "$WORK/secrets/chunks" && "$VBIN/detect-secrets" scan --all-files . ) > "$WORK/secrets/results.json"
"$VBIN/python" - "$WORK/secrets/results.json" <<'PY' | tee -a "$REPORT" || FAIL=1
import json, sys
from collections import Counter
res = json.load(open(sys.argv[1]))["results"]
canary = sum(1 for f in res if "zz_canary" in f)
types = Counter(r["type"] for f, rs in res.items() if "zz_canary" not in f for r in rs)
print(f"canary found: {'yes' if canary else 'NO - scan did not run properly'}")
print(f"findings outside canary: {sum(types.values())}" + ("".join(f"\n  {t}: {n}" for t, n in sorted(types.items()))))
print(f"(review {sys.argv[1]} if non-zero; it holds hashes and chunk line numbers, not values)")
sys.exit(0 if canary else 1)
PY
if [ -n "$ENV_FILE" ]; then
  check "$VBIN/python" "$HELPER" envcount "$WORK/public.git" "$ENV_FILE" "$ENV_ALLOW"
fi

# fresh checkout: frontend type check + lint + build, backend tests
if [ "$SKIP_BUILD" = 0 ]; then
  log ""
  log "== fresh checkout build + tests"
  git clone -q "$WORK/public.git" "$WORK/checkout"
  ( cd "$WORK/checkout/frontend" && npm ci --no-audit --no-fund --loglevel=error && npm run lint && npm run build ) \
    > "$WORK/frontend-build.log" 2>&1 && log "frontend: npm ci + lint + build OK" \
    || { log "frontend: FAILED (see $WORK/frontend-build.log)"; FAIL=1; }
  "$PY" -m venv "$WORK/checkout-venv"
  CBIN="$(venv_bin "$WORK/checkout-venv")"
  ( cd "$WORK/checkout/backend" && "$CBIN/python" -m pip install -q --disable-pip-version-check -r requirements.txt pytest \
    && "$CBIN/python" -m pytest -q ) > "$WORK/backend-tests.log" 2>&1 \
    && log "backend: $(tail -n 1 "$WORK/backend-tests.log")" \
    || { log "backend: FAILED: $(tail -n 1 "$WORK/backend-tests.log") (see $WORK/backend-tests.log)"; FAIL=1; }
fi

log ""
if [ "$FAIL" = 0 ]; then log "RESULT: all checks passed. Rewritten repo: $WORK/public.git"
else log "RESULT: one or more checks FAILED. Do not publish $WORK/public.git"; fi
exit "$FAIL"
