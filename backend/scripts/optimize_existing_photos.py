"""One-off: shrink and clean the photos already in Storage, in place.

New uploads are processed on the way in (app/uploads.py's process_image:
EXIF orientation applied, all metadata -- GPS included -- dropped, longest
edge capped, progressive JPEG). Everything uploaded before that is still the
camera's original file, location data and all. This script runs the same
processing over the three photo buckets:

    favorite-photos, family-passport-photos   longest edge 1600 (GUEST_MAX_EDGE)
    animal-photos                             longest edge 2000 (ANIMAL_MAX_EDGE)

Each object is replaced at its SAME path, so every public URL and every
database row stays as it is -- no database change. A .png/.webp path ends
up holding JPEG bytes served as image/jpeg; browsers go by the served
Content-Type, not the extension.

Skipped: anything already small and clean -- under SMALL_ENOUGH_BYTES,
within the target size, and carrying no EXIF (so no GPS) -- and anything a
previous --apply run already did (see the progress log below).

This is meant to run against production, so like migrate_animal_photos.py
it is NOT behind the dev-only DEV_SUPABASE_PROJECT_REFS guard; instead:

  1. It always prints the target project (and whether it is one of the
     DEV_SUPABASE_PROJECT_REFS -- if not, treat it as PRODUCTION), then a
     read-only plan: every object, its size now, its size after
     processing, and the total saving. Without --apply that is all it does.
  2. --apply changes nothing until you type the project ref (or pass --yes).
  3. With --apply, for each object in turn: download the original into the
     backup folder (printed first) -> process -> upload over the same path
     -> download it again and check it is exactly what was uploaded,
     decodes, and is stored as image/jpeg -> fetch it through its public
     URL and check the same -> append a line to <backup folder>/
     progress.jsonl. It stops at the first failure with the reason, and
     never deletes anything (not in Storage, not in the backup folder).
     Supabase's CDN may keep serving its cached old copy of a plain public
     URL for a minute or so after the replace; that clears by itself.
  4. Resumable: rerunning with the same backup folder skips everything
     progress.jsonl records as done. An object whose backup exists but
     isn't logged (a run cut off mid-object) is checked against that
     backup before anything else happens to it.
  5. --restore puts every logged original back (same confirmation; honours
     --bucket), from the backup folder, with its original content type,
     and moves those lines from progress.jsonl to restored-progress.jsonl.

Rewritten objects get Cache-Control max-age of one day, not the year new
uploads get: these URLs' bytes DO change once (now), and a short cache
keeps a --restore visible to guests within a day.

Run from anywhere with the backend venv active (backend/.env decides which
project -- check the "Target project" line):

    python backend/scripts/optimize_existing_photos.py                    # plan only
    python backend/scripts/optimize_existing_photos.py --apply            # plan, then asks
    python backend/scripts/optimize_existing_photos.py --restore          # undo, from the backups
    ... --bucket favorite-photos    (repeatable) limit to some buckets
    ... --backup-dir PATH           default backend/scripts/output/photo-backups/<project ref>/
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx  # noqa: E402
from PIL import Image  # noqa: E402

from app import uploads  # noqa: E402
from app.services.animal_photos import BUCKET as ANIMAL_BUCKET  # noqa: E402
from app.services.passport import BUCKET as PASSPORT_BUCKET  # noqa: E402
from app.services.photos import BUCKET as FAVORITE_BUCKET  # noqa: E402
from app.supabase_client import SUPABASE_URL, get_supabase_client  # noqa: E402

BUCKET_MAX_EDGE = {
    FAVORITE_BUCKET: uploads.GUEST_MAX_EDGE,
    PASSPORT_BUCKET: uploads.GUEST_MAX_EDGE,
    ANIMAL_BUCKET: uploads.ANIMAL_MAX_EDGE,
}
SMALL_ENOUGH_BYTES = 500 * 1024
REWRITE_CACHE_CONTROL = "86400"
DEFAULT_BACKUP_ROOT = Path(__file__).resolve().parent / "output" / "photo-backups"
PROGRESS_FILE = "progress.jsonl"
_LIST_PAGE = 1000


class StopRun(Exception):
    """A failure that ends the run; the message says what and where."""


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def project_ref() -> str:
    return SUPABASE_URL.split("//", 1)[-1].split(".", 1)[0] if SUPABASE_URL else ""


def _dev_refs() -> set[str]:
    return {r.strip() for r in os.environ.get("DEV_SUPABASE_PROJECT_REFS", "").split(",") if r.strip()}


def _print_target(buckets: list[str]) -> None:
    ref = project_ref()
    kind = "a listed DEV project" if ref in _dev_refs() else "NOT a listed dev project -- treat as PRODUCTION"
    print(f"Target project: {SUPABASE_URL}  (ref {ref}: {kind})")
    print(f"Buckets: {', '.join(buckets)}")


# --- listing ------------------------------------------------------------------


@dataclass
class StoredObject:
    bucket: str
    path: str
    size: int
    content_type: str | None


def list_objects(client, bucket: str, prefix: str = "") -> list[StoredObject]:
    found: list[StoredObject] = []
    offset = 0
    while True:
        items = client.storage.from_(bucket).list(prefix, {"limit": _LIST_PAGE, "offset": offset, "sortBy": {"column": "name", "order": "asc"}})
        for item in items:
            path = f"{prefix}/{item['name']}" if prefix else item["name"]
            if item.get("id") is None:  # a folder
                found.extend(list_objects(client, bucket, path))
            else:
                meta = item.get("metadata") or {}
                found.append(StoredObject(bucket, path, int(meta.get("size") or 0), meta.get("mimetype")))
        if len(items) < _LIST_PAGE:
            return found
        offset += _LIST_PAGE


# --- per-object decision -------------------------------------------------------


@dataclass
class Plan:
    obj: StoredObject
    action: str  # "process", "skip", "done", "unreadable"
    reason: str
    new_size: int | None = None
    processed: bytes | None = None


def _needs_processing(original: bytes, max_edge: int) -> tuple[bool, str]:
    with Image.open(io.BytesIO(original)) as image:
        width, height = image.size
        has_exif = len(image.getexif()) > 0 or "exif" in image.info
    if len(original) >= SMALL_ENOUGH_BYTES:
        return True, f"{len(original) // 1024} KB"
    if max(width, height) > max_edge:
        return True, f"{width}x{height}"
    if has_exif:
        return True, "carries EXIF metadata"
    return False, f"already small ({len(original) // 1024} KB, {width}x{height}, no EXIF)"


def plan_object(original: bytes, obj: StoredObject) -> Plan:
    max_edge = BUCKET_MAX_EDGE[obj.bucket]
    try:
        needed, reason = _needs_processing(original, max_edge)
    except Exception as exc:  # not an image Pillow can open (e.g. a stray GIF/text)
        return Plan(obj, "unreadable", f"can't open: {exc.__class__.__name__}")
    if not needed:
        return Plan(obj, "skip", reason)
    try:
        processed = uploads.process_image(uploads.validate_image(original), max_edge).content
    except Exception as exc:
        detail = getattr(exc, "detail", None) or exc.__class__.__name__
        return Plan(obj, "unreadable", f"can't process: {detail}")
    return Plan(obj, "process", reason, new_size=len(processed), processed=processed)


# --- progress log --------------------------------------------------------------


def read_progress(backup_dir: Path) -> dict[tuple[str, str], dict]:
    log = backup_dir / PROGRESS_FILE
    done: dict[tuple[str, str], dict] = {}
    if log.exists():
        for line in log.read_text(encoding="utf-8").splitlines():
            if line.strip():
                entry = json.loads(line)
                done[(entry["bucket"], entry["path"])] = entry
    return done


def _append_progress(backup_dir: Path, entry: dict) -> None:
    with open(backup_dir / PROGRESS_FILE, "a", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(entry) + "\n")
        f.flush()
        os.fsync(f.fileno())


def _move_restored_out_of_log(backup_dir: Path, restored: list[dict]) -> None:
    """A restored object's original is back in Storage, so its line no
    longer describes Storage: it moves to restored-progress.jsonl, and the
    rest of the log (other buckets, or ones a stopped restore didn't reach)
    stays as it was."""
    if not restored:
        return
    keys = {(e["bucket"], e["path"]) for e in restored}
    log = backup_dir / PROGRESS_FILE
    keep = [e for k, e in read_progress(backup_dir).items() if k not in keys]
    with open(backup_dir / f"restored-{PROGRESS_FILE}", "a", encoding="utf-8", newline="\n") as f:
        for e in restored:
            f.write(json.dumps(e) + "\n")
    tmp = log.with_name(PROGRESS_FILE + ".partial")
    tmp.write_text("".join(json.dumps(e) + "\n" for e in keep), encoding="utf-8", newline="\n")
    tmp.replace(log)


def _backup_path(backup_dir: Path, obj: StoredObject) -> Path:
    return backup_dir / obj.bucket / Path(*obj.path.split("/"))


# --- apply ---------------------------------------------------------------------


def _verify(client, obj: StoredObject, expected: bytes, content_type: str = "image/jpeg") -> None:
    name = f"{obj.bucket}/{obj.path}"
    bucket = client.storage.from_(obj.bucket)
    stored = bucket.download(obj.path)
    if _sha256(stored) != _sha256(expected):
        raise StopRun(f"{name}: what Storage holds now is not what was just uploaded")
    with Image.open(io.BytesIO(stored)) as image:
        image.load()
    stored_type = bucket.info(obj.path).get("content_type")
    if stored_type != content_type:
        raise StopRun(f"{name}: Storage has it as {stored_type!r}, not {content_type}")
    # Supabase's CDN keeps serving its cached copy of the plain public URL
    # for a minute or so after an object is replaced (seen on dev, even for
    # objects stored as no-cache), so the check goes through a query string
    # the CDN hasn't cached: same object, fetched fresh.
    url = bucket.get_public_url(obj.path)
    res = httpx.get(f"{url}?v={_sha256(expected)[:12]}", timeout=30)
    if res.status_code != 200:
        raise StopRun(f"{name}: public URL returned {res.status_code}")
    if _sha256(res.content) != _sha256(expected):
        raise StopRun(f"{name}: public URL doesn't serve what was just uploaded")
    with Image.open(io.BytesIO(res.content)) as image:
        image.load()


def _upload_replace(client, obj: StoredObject, content: bytes, content_type: str, cache_control: str) -> None:
    # update() is a PUT to the existing path: replaces in place, same URL.
    client.storage.from_(obj.bucket).update(obj.path, content, {"content-type": content_type, "cache-control": cache_control})


def apply_one(client, obj: StoredObject, backup_dir: Path) -> dict | None:
    """Processes one object; returns its progress entry, or None if skipped."""
    backup = _backup_path(backup_dir, obj)
    current = client.storage.from_(obj.bucket).download(obj.path)

    if backup.exists():
        # A previous run backed this up but never logged it as done -- it
        # stopped somewhere between the backup and the log line.
        original = backup.read_bytes()
        if _sha256(current) != _sha256(original):
            redo = plan_object(original, obj)
            if redo.processed is not None and _sha256(redo.processed) == _sha256(current):
                print(f"  {obj.path}: already replaced by an interrupted run -- verifying and logging it.")
                _verify(client, obj, current)
                return _entry(obj, original, current, backup)
            raise StopRun(
                f"{obj.bucket}/{obj.path}: Storage holds something that is neither the backed-up original "
                f"({backup}) nor its processed version. Nothing was changed; look at it before rerunning."
            )
    else:
        original = current
        backup.parent.mkdir(parents=True, exist_ok=True)
        tmp = backup.with_name(backup.name + ".partial")
        tmp.write_bytes(original)
        tmp.replace(backup)
        if _sha256(backup.read_bytes()) != _sha256(original):
            raise StopRun(f"{obj.bucket}/{obj.path}: backup at {backup} didn't read back identically")

    plan = plan_object(original, obj)
    if plan.action == "skip":
        return None
    if plan.processed is None:
        raise StopRun(f"{obj.bucket}/{obj.path}: {plan.reason}")

    _upload_replace(client, obj, plan.processed, "image/jpeg", REWRITE_CACHE_CONTROL)
    _verify(client, obj, plan.processed)
    return _entry(obj, original, plan.processed, backup)


def _content_type_of(content: bytes, fallback: str | None) -> str | None:
    """From the bytes themselves: after an interrupted run the listing's
    mimetype describes the processed copy, not the original."""
    fmt = uploads._sniff_format(content)
    return uploads._FORMATS[fmt][1] if fmt else fallback


def _entry(obj: StoredObject, original: bytes, processed: bytes, backup: Path) -> dict:
    return {
        "bucket": obj.bucket,
        "path": obj.path,
        "original_bytes": len(original),
        "original_sha256": _sha256(original),
        "original_content_type": _content_type_of(original, obj.content_type),
        "new_bytes": len(processed),
        "new_sha256": _sha256(processed),
        "backup": str(backup),
    }


def restore_one(client, entry: dict) -> None:
    backup = Path(entry["backup"])
    original = backup.read_bytes()
    if _sha256(original) != entry["original_sha256"]:
        raise StopRun(f"{backup}: backup doesn't match the checksum logged when it was taken")
    obj = StoredObject(entry["bucket"], entry["path"], entry["original_bytes"], entry["original_content_type"])
    content_type = entry["original_content_type"] or "image/jpeg"
    _upload_replace(client, obj, original, content_type, REWRITE_CACHE_CONTROL)
    _verify(client, obj, original, content_type)


# --- entry point ---------------------------------------------------------------


def _confirm(question: str, yes: bool) -> bool:
    if yes:
        return True
    expected = project_ref()
    if not sys.stdin.isatty():
        print("REFUSED: not interactive and --yes not given -- nothing changed.", file=sys.stderr)
        return False
    # Same as migrate_animal_photos.py: on Windows a NUL stdin can report as
    # a terminal and input() then hits end-of-file -- that's "not confirmed".
    try:
        typed = input(f"Type the project ref ({expected}) to {question}: ").strip()
    except (EOFError, KeyboardInterrupt):
        print()
        typed = None
    if not expected or typed != expected:
        print("REFUSED: confirmation did not match -- nothing changed.", file=sys.stderr)
        return False
    return True


def _kb(n: int | None) -> str:
    return "-" if n is None else f"{n / 1024:,.0f} KB"


def run(*, apply: bool, restore: bool, yes: bool, buckets: list[str], backup_dir: Path | None) -> int:
    client = get_supabase_client()
    _print_target(buckets)
    backup_dir = backup_dir or DEFAULT_BACKUP_ROOT / (project_ref() or "unknown-project")
    print(f"Backup folder: {backup_dir}")
    done = read_progress(backup_dir)

    if restore:
        entries = [e for e in done.values() if e["bucket"] in buckets]
        print(f"{len(entries)} logged object(s) to restore from the backup folder.")
        for e in entries:
            print(f"  {e['bucket']}/{e['path']}: {_kb(e['new_bytes'])} -> {_kb(e['original_bytes'])}")
        if not entries or not _confirm(f"put {len(entries)} original(s) back", yes):
            return 0 if not entries else 2
        restored: list[dict] = []
        try:
            for e in entries:
                try:
                    restore_one(client, e)
                except Exception as exc:
                    print(f"STOPPED restoring {e['bucket']}/{e['path']}: {exc}", file=sys.stderr)
                    return 1
                restored.append(e)
                print(f"  restored {e['bucket']}/{e['path']}")
        finally:
            _move_restored_out_of_log(backup_dir, restored)
        print(f"Restored {len(restored)}. Their lines moved to restored-{PROGRESS_FILE}; backups kept.")
        return 0

    plans: list[Plan] = []
    for bucket in buckets:
        for obj in list_objects(client, bucket):
            if (bucket, obj.path) in done:
                entry = done[(bucket, obj.path)]
                plans.append(Plan(obj, "done", "done by an earlier run", new_size=entry["new_bytes"]))
                continue
            backup = _backup_path(backup_dir, obj)
            if backup.exists():
                # Backed up by a run that stopped before logging it. Judge it
                # by the backup (the original): what's in Storage now may
                # already be the processed copy, which would look "small".
                original = backup.read_bytes()
                plan = plan_object(original, StoredObject(bucket, obj.path, len(original), obj.content_type))
                if plan.action == "process":
                    plan.reason = "left unfinished by an earlier run"
                plans.append(plan)
                continue
            plans.append(plan_object(client.storage.from_(bucket).download(obj.path), obj))

    print(f"{'object':<60} {'now':>10} {'after':>10}  action")
    for p in plans:
        name = f"{p.obj.bucket}/{p.obj.path}"
        after = p.new_size if p.action == "process" else None
        print(f"{name:<60} {_kb(p.obj.size):>10} {_kb(after):>10}  {p.action} ({p.reason})")
    todo = [p for p in plans if p.action == "process"]
    before_total = sum(p.obj.size for p in todo)
    after_total = sum(p.new_size or 0 for p in todo)
    print(
        f"{len(plans)} object(s): {len(todo)} to process, "
        f"{sum(p.action == 'skip' for p in plans)} already small, "
        f"{sum(p.action == 'done' for p in plans)} done earlier, "
        f"{sum(p.action == 'unreadable' for p in plans)} unreadable (left alone)."
    )
    if todo:
        saved = before_total - after_total
        print(f"Processing: {_kb(before_total)} -> {_kb(after_total)}, saving {_kb(saved)} ({saved / before_total:.0%}).")

    if not apply:
        print("Dry run: nothing changed. Add --apply to process.")
        return 0
    if not todo:
        print("Nothing to process.")
        return 0
    if not _confirm(f"back up and replace {len(todo)} photo(s)", yes):
        return 2

    backup_dir.mkdir(parents=True, exist_ok=True)
    for i, p in enumerate(todo, start=1):
        name = f"{p.obj.bucket}/{p.obj.path}"
        try:
            entry = apply_one(client, p.obj, backup_dir)
        except Exception as exc:
            print(f"STOPPED at {name} ({i}/{len(todo)}): {exc}", file=sys.stderr)
            print(f"Everything before it is done and logged in {backup_dir / PROGRESS_FILE}; rerun to resume.", file=sys.stderr)
            return 1
        if entry is None:
            print(f"  [{i}/{len(todo)}] {name}: changed since the plan, now small enough -- skipped")
            continue
        _append_progress(backup_dir, entry)
        print(f"  [{i}/{len(todo)}] {name}: {_kb(entry['original_bytes'])} -> {_kb(entry['new_bytes'])}  ok")
    print(f"Done. Originals are in {backup_dir} (never deleted).")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Shrink and strip metadata from stored photos (see module docstring).")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true", help="back up, process and replace (default is a dry run)")
    mode.add_argument("--restore", action="store_true", help="put the backed-up originals back")
    parser.add_argument("--yes", action="store_true", help="skip the typed project-ref confirmation")
    parser.add_argument("--bucket", action="append", choices=sorted(BUCKET_MAX_EDGE), help="limit to this bucket (repeatable)")
    parser.add_argument("--backup-dir", type=Path, help="backup folder (default: scripts/output/photo-backups/<project ref>)")
    args = parser.parse_args()
    try:
        code = run(
            apply=args.apply,
            restore=args.restore,
            yes=args.yes,
            buckets=args.bucket or list(BUCKET_MAX_EDGE),
            backup_dir=args.backup_dir,
        )
    except StopRun as exc:
        print(f"STOPPED: {exc}", file=sys.stderr)
        code = 1
    sys.exit(code)
