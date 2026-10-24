#!/usr/bin/env python3
"""Checks for scripts/prepare-public-history.sh. Prints counts and paths,
never secret values or photo coordinates.

  artefacts REPO OUT     list historical build artefacts absent from HEAD
                         (frontend/public/games/, Godot .godot/ caches, any
                         .wasm/.pck) into OUT, and print the size removing
                         them saves (blobs reachable only through them)
  compare BEFORE AFTER WITHHOLD
                         every branch tip in AFTER must equal BEFORE except
                         image blobs (must equal strip_bytes(before)) and
                         withheld paths (must be gone); no extra paths
  scan REPO              metadata scan of every blob reachable from any ref;
                         exit 1 if any image blob still carries metadata
  envcount REPO ENVFILE [KEY,KEY...]
                         how many times each .env value (8+ chars) occurs in
                         any blob or commit message; prints key names and
                         counts only. Listed keys hold public values (a site
                         URL, a sender address) and don't fail the check
"""
from __future__ import annotations

import fnmatch
import importlib.util
import os
import re
import subprocess
import sys
from collections import Counter, defaultdict

_here = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("check_image_metadata", os.path.join(_here, "check-image-metadata.py"))
guard = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(guard)

ARTEFACT_RE = re.compile(r"(^frontend/public/games/|(^|/)\.godot/|\.(wasm|pck)$)")


def git(repo: str, *args: str, input: bytes | None = None) -> bytes:
    return subprocess.run(["git", "-C", repo, *args], input=input, capture_output=True, check=True).stdout


def cat_blobs(repo: str, shas: list[str]):
    """Yield (sha, type, data) for each object id, in order."""
    if not shas:
        return
    out = git(repo, "cat-file", "--batch=%(objectname) %(objecttype) %(objectsize)", input=("\n".join(shas) + "\n").encode())
    pos = 0
    while pos < len(out):
        nl = out.index(b"\n", pos)
        sha, typ, size = out[pos:nl].decode().split()
        size = int(size)
        yield sha, typ, out[nl + 1: nl + 1 + size]
        pos = nl + 1 + size + 1


def tree(repo: str, rev: str) -> dict[str, str]:
    out = git(repo, "ls-tree", "-r", "-z", "--full-tree", rev).decode("utf-8")
    entries = {}
    for item in filter(None, out.split("\0")):
        meta, path = item.split("\t", 1)
        mode, typ, sha = meta.split()
        if typ == "blob":
            entries[path] = sha
    return entries


def read_withhold(path: str) -> list[str]:
    rules = []
    if path and os.path.exists(path):
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line and not line.startswith("#"):
                    rules.append(line)
    return rules


def withheld(path: str, rules: list[str]) -> bool:
    for rule in rules:
        if rule.startswith("glob:"):
            if fnmatch.fnmatchcase(path, rule[5:]):
                return True
        elif path == rule or path.startswith(rule.rstrip("/") + "/"):
            return True
    return False


def cmd_artefacts(repo: str, out_path: str) -> int:
    head = set(tree(repo, "HEAD"))
    blob_paths: dict[str, set] = defaultdict(set)
    raw = git(repo, "log", "--all", "--format=", "--raw", "--no-abbrev", "--no-renames", "-c", "-z").decode("utf-8")
    # -z raw format: ":meta\0path\0" pairs (merge -c lines have one path too)
    parts = raw.split("\0")
    i = 0
    while i < len(parts) - 1:
        meta = parts[i].lstrip("\n")
        if meta.startswith(":"):
            new = meta.split()[-2]
            if set(new) != {"0"}:
                blob_paths[new].add(parts[i + 1])
            i += 2
        else:
            i += 1
    artefact_paths = sorted({p for ps in blob_paths.values() for p in ps if p not in head and ARTEFACT_RE.search(p)})
    art = set(artefact_paths)
    only = [b for b, ps in blob_paths.items() if ps <= art]
    sizes = {sha: len(data) for sha, _, data in cat_blobs(repo, only)}
    by_dir: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for b in only:
        p = sorted(blob_paths[b])[0]
        bits = p.split("/")
        key = "/".join(bits[: bits.index(".godot") + 1]) if ".godot" in bits else "/".join(bits[:3])
        by_dir[key][0] += 1
        by_dir[key][1] += sizes[b]
    with open(out_path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(artefact_paths) + ("\n" if artefact_paths else ""))
    print(f"historical build artefacts absent from HEAD: {len(artefact_paths)} paths, "
          f"{len(only)} blobs only reachable through them, {sum(sizes.values()) / 2**20:.2f} MiB uncompressed")
    for key, (n, s) in sorted(by_dir.items(), key=lambda kv: -kv[1][1]):
        print(f"  {s / 2**20:7.2f} MiB  {n:4d} blobs  {key}")
    kept_wasm = {b for b, ps in blob_paths.items() if any(p.endswith(".wasm") for p in ps) and ps & head}
    if kept_wasm:
        print(f"  note: {len(kept_wasm)} .wasm blob(s) also used by HEAD (frontend/games-dist/) stay in history")
    return 0


def cmd_compare(before: str, after: str, withhold_file: str) -> int:
    rules = read_withhold(withhold_file)
    problems: list[str] = []
    branches_b = git(before, "for-each-ref", "--format=%(refname)", "refs/heads").decode().split()
    branches_a = git(after, "for-each-ref", "--format=%(refname)", "refs/heads").decode().split()
    if branches_b != branches_a:
        problems.append(f"branch list differs: {branches_b} vs {branches_a}")
    stats = Counter()
    for ref in branches_b:
        tb, ta = tree(before, ref), tree(after, ref)
        expect = {p: s for p, s in tb.items() if not withheld(p, rules)}
        stats["withheld"] += len(tb) - len(expect)
        extra = set(ta) - set(expect)
        missing = set(expect) - set(ta)
        if extra:
            problems.append(f"{ref}: {len(extra)} unexpected path(s), e.g. {sorted(extra)[:3]}")
        if missing:
            problems.append(f"{ref}: {len(missing)} missing path(s), e.g. {sorted(missing)[:3]}")
        changed = [p for p in expect if p in ta and ta[p] != expect[p]]
        stats["identical"] += len(expect) - len(changed) - len(missing)
        old = {sha: data for sha, _, data in cat_blobs(before, [expect[p] for p in changed])}
        new = {sha: data for sha, _, data in cat_blobs(after, [ta[p] for p in changed])}
        for p in changed:
            if guard.strip_bytes(old[expect[p]]) == new[ta[p]] and guard.kind_of(old[expect[p]]):
                stats["stripped_images"] += 1
            else:
                problems.append(f"{ref}: {p} differs and is not just stripped metadata")
    print(f"tree compare: {stats['identical']} identical, {stats['stripped_images']} images differ only by stripped "
          f"metadata, {stats['withheld']} withheld, {len(problems)} problem(s)")
    for p in problems:
        print("  PROBLEM " + p)
    return 1 if problems else 0


def cmd_scan(repo: str) -> int:
    objs = git(repo, "rev-list", "--objects", "--all").decode().splitlines()
    blobs = images = with_meta = gps = errors = 0
    cats: Counter = Counter()
    for _, typ, data in cat_blobs(repo, [o.split(" ", 1)[0] for o in objs]):
        if typ != "blob":
            continue
        blobs += 1
        result = guard.scan_bytes(data)
        if result is None:
            continue
        images += 1
        if result.get("error"):
            errors += 1
        elif result["found"]:
            with_meta += 1
            cats.update(result["found"].keys())
            gps += "gps" in result["found"]
    print(f"blob scan: blobs={blobs} image_blobs={images} with_metadata={with_meta} gps={gps} unparseable={errors}")
    if cats:
        print("  categories: " + ", ".join(f"{k}={v}" for k, v in sorted(cats.items())))
    return 1 if (with_meta or errors) else 0


def cmd_envcount(repo: str, env_file: str, allow: str = "") -> int:
    allowed = {k for k in allow.split(",") if k}
    values = {}
    with open(env_file, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            val = val.strip().strip("'\"")
            if len(val) >= 8:
                values[key.strip()] = val.encode()
    objs = git(repo, "rev-list", "--objects", "--all").decode().splitlines()
    hits: Counter = Counter()
    for _, typ, data in cat_blobs(repo, [o.split(" ", 1)[0] for o in objs]):
        if typ in ("blob", "commit", "tag"):
            for key, val in values.items():
                if val in data:
                    hits[key] += 1
    print(f"env values checked: {len(values)}; found in history: {sum(hits.values())}")
    for key in sorted(hits):
        print(f"  {key}: {hits[key]} object(s)" + ("  (allowed: public value)" if key in allowed else "  PROBLEM"))
    return 1 if set(hits) - allowed else 0


def main(argv: list[str]) -> int:
    cmds = {"artefacts": (cmd_artefacts, (2,)), "compare": (cmd_compare, (3,)), "scan": (cmd_scan, (1,)),
            "envcount": (cmd_envcount, (2, 3))}
    if not argv or argv[0] not in cmds or len(argv) - 1 not in cmds[argv[0]][1]:
        print(__doc__)
        return 2
    fn, _ = cmds[argv[0]]
    return fn(*argv[1:])


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
