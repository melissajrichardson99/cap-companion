"""Shared by every QR generator script (generate_animal_qr_codes.py,
generate_hunt_qr_codes.py, generate_qr_codes.py, generate_all_qr_codes.py):
where the codes point, the confirmation before writing, the manifest, and
verification.

The base URL every code encodes is an explicit, checked input -- never a
default, never FRONTEND_BASE_URL. A printed sign can't be updated, so:

- It comes from --base-url or the QR_BASE_URL environment variable, and
  the script refuses to run with neither.
- It must be https:// with a public host name -- localhost, 127.x, other
  private/link-local/reserved IPs, .local/.internal names and single-label
  hosts are refused -- and nothing after the origin (no path, query,
  fragment or user:password@). --allow-insecure lifts all of that, for
  local testing only.
- The script prints the base URL and the first full URL, then needs --yes
  or the host name typed back before it writes anything.

Every run writes manifest.csv next to the PNGs (file, kind, name, slug or
code, full URL), then decodes every PNG and checks it against the manifest.
--verify DIR re-runs just that check on an existing folder, e.g. right
before printing. Decoding uses jsQR through scripts/qr_decode.mjs (Node +
the frontend's existing jsqr dependency).
"""

from __future__ import annotations

import argparse
import base64
import csv
import ipaddress
import json
import os
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.qr import generate_qr_png_for_url  # noqa: E402

BASE_URL_ENV = "QR_BASE_URL"
MANIFEST = "manifest.csv"
MANIFEST_FIELDS = ["file", "kind", "name", "id", "url"]
DECODER = Path(__file__).resolve().parent / "qr_decode.mjs"

_LOCAL_SUFFIXES = (".localhost", ".local", ".internal", ".lan", ".home", ".home.arpa", ".test", ".example", ".invalid")


class BaseUrlError(ValueError):
    pass


def validate_base_url(raw: str | None, *, allow_insecure: bool = False) -> str:
    """The base URL with any trailing slash removed, or BaseUrlError saying
    why it can't go on a printed sign."""
    if raw is None or not raw.strip():
        raise BaseUrlError(f"No base URL: pass --base-url https://<your domain> or set {BASE_URL_ENV}. There is no default.")
    url = raw.strip()
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise BaseUrlError(f"{url!r} isn't a full URL -- it needs to look like https://example.com")
    if parts.username is not None or parts.password is not None:
        raise BaseUrlError(f"{url!r} contains a user name or password -- give just the site's address")
    if parts.path not in ("", "/") or parts.query or parts.fragment:
        raise BaseUrlError(
            f"{url!r} has something after the site's address -- give just the origin (e.g. https://example.com); "
            "the scripts add /scan/..., /animals/... themselves"
        )
    try:
        parts.port  # noqa: B018 -- raises on a malformed port
    except ValueError:
        raise BaseUrlError(f"{url!r} has an invalid port") from None

    if not allow_insecure:
        if parts.scheme != "https":
            raise BaseUrlError(f"{url!r} isn't https -- signs must use https:// (--allow-insecure for local testing only)")
        host = parts.hostname.rstrip(".").lower()
        reason = _non_public_host_reason(host)
        if reason:
            raise BaseUrlError(f"{url!r} points at {reason}, which a guest's phone can't reach (--allow-insecure for local testing only)")

    return f"{parts.scheme}://{parts.netloc}"


def _non_public_host_reason(host: str) -> str | None:
    if host == "localhost" or host.endswith(_LOCAL_SUFFIXES):
        return f"a local-only name ({host})"
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        if "." not in host:
            return f"a single-label host name ({host})"
        return None
    if ip.is_loopback:
        return f"a loopback address ({host})"
    if ip.is_private or ip.is_link_local or ip.is_unspecified or ip.is_reserved or ip.is_multicast:
        return f"a private or reserved IP address ({host})"
    return None


def base_url_warnings(base_url: str) -> list[str]:
    host = (urlsplit(base_url).hostname or "").lower()
    warnings = []
    if host.endswith(".workers.dev") or host.endswith(".pages.dev"):
        warnings.append(
            f"{host} is a Cloudflare-provided address tied to one Cloudflare account -- "
            "printed signs stop working if that account or project goes away. Prefer the park's own domain."
        )
    return warnings


@dataclass(frozen=True)
class QrEntry:
    file: str  # PNG file name inside the output folder
    kind: str  # animal / hunt / scan-code / scoring / puzzle
    name: str  # human label, for whoever is printing
    id: str  # the slug or scan code
    path: str  # e.g. /animals/goat -- joined to the base URL

    def url(self, base_url: str) -> str:
        return f"{base_url}{self.path}"


# --- argument handling --------------------------------------------------------


def add_arguments(parser: argparse.ArgumentParser, default_output_dir: Path) -> None:
    parser.add_argument(
        "output_dir", nargs="?", type=Path, default=default_output_dir, help=f"where to write (default {default_output_dir})"
    )
    parser.add_argument("--base-url", help=f"origin every code encodes, e.g. https://example.com (or set {BASE_URL_ENV})")
    parser.add_argument("--allow-insecure", action="store_true", help="LOCAL TESTING ONLY: allow http://, localhost and private IPs")
    parser.add_argument("--yes", action="store_true", help="write without the typed confirmation")
    parser.add_argument("--overwrite", action="store_true", help="allow writing into a folder that already has QR PNGs")
    parser.add_argument("--verify", action="store_true", help="don't generate: decode output_dir's PNGs and check them against its manifest")


def run(args: argparse.Namespace, build_entries) -> int:
    """The whole flow for a generator script. build_entries() returns the
    QrEntry list; it's only called once the base URL has passed."""
    if args.verify:
        return verify(args.output_dir, allow_insecure=args.allow_insecure)

    try:
        base_url = validate_base_url(args.base_url or os.environ.get(BASE_URL_ENV), allow_insecure=args.allow_insecure)
    except BaseUrlError as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 2

    entries = build_entries()
    if not entries:
        print("Nothing to generate.", file=sys.stderr)
        return 1

    print(f"These QR codes will encode: {base_url}")
    print(f"  e.g. {entries[0].url(base_url)}")
    if args.allow_insecure:
        print("  --allow-insecure: FOR LOCAL TESTING ONLY -- do not print these.")
    for warning in base_url_warnings(base_url):
        print(f"  WARNING: {warning}")
    print(f"{len(entries)} PNG(s) + {MANIFEST} -> {args.output_dir}")

    existing = sorted(p.name for p in args.output_dir.glob("*.png")) if args.output_dir.is_dir() else []
    if existing and not args.overwrite:
        print(
            f"REFUSED: {args.output_dir} already holds {len(existing)} QR PNG(s) (e.g. {existing[0]}) -- "
            "old codes could get mixed in. Pick an empty folder, or pass --overwrite.",
            file=sys.stderr,
        )
        return 2

    if not _confirm(base_url, args.yes):
        return 2

    write(entries, base_url, args.output_dir)
    print(f"Wrote {len(entries)} QR code(s) and {MANIFEST} to {args.output_dir}")
    return verify(args.output_dir, allow_insecure=args.allow_insecure)


def _confirm(base_url: str, yes: bool) -> bool:
    if yes:
        return True
    host = urlsplit(base_url).hostname or ""
    if not sys.stdin.isatty():
        print("REFUSED: not interactive and --yes not given -- nothing written.", file=sys.stderr)
        return False
    # On Windows a NUL stdin can report as a terminal; EOF there is a "no".
    try:
        typed = input(f"Type the host name ({host}) to write these files: ").strip()
    except (EOFError, KeyboardInterrupt):
        print()
        typed = None
    if typed != host:
        print("REFUSED: confirmation did not match -- nothing written.", file=sys.stderr)
        return False
    return True


# --- writing ------------------------------------------------------------------


def write(entries: list[QrEntry], base_url: str, output_dir: Path) -> None:
    files = [e.file for e in entries]
    duplicates = {f for f in files if files.count(f) > 1}
    if duplicates:
        raise ValueError(f"Two codes would share a file name: {sorted(duplicates)}")
    output_dir.mkdir(parents=True, exist_ok=True)
    for entry in entries:
        (output_dir / entry.file).write_bytes(generate_qr_png_for_url(entry.url(base_url)))
    with open(output_dir / MANIFEST, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=MANIFEST_FIELDS)
        writer.writeheader()
        for entry in entries:
            writer.writerow({"file": entry.file, "kind": entry.kind, "name": entry.name, "id": entry.id, "url": entry.url(base_url)})


# --- verification -------------------------------------------------------------


def decode_pngs(paths: list[Path]) -> dict[str, str | None]:
    """{file name: decoded text, or None if no QR code was found}."""
    from PIL import Image

    payload = []
    for path in paths:
        with Image.open(path) as image:
            rgba = image.convert("RGBA")
            payload.append(
                {"file": path.name, "width": rgba.width, "height": rgba.height, "rgba": base64.b64encode(rgba.tobytes()).decode()}
            )
    try:
        result = subprocess.run(
            ["node", str(DECODER)], input=json.dumps(payload), capture_output=True, text=True, encoding="utf-8", check=False
        )
    except FileNotFoundError:
        raise RuntimeError("Verification needs Node.js on PATH (it decodes with the frontend's jsqr package).") from None
    if result.returncode != 0:
        raise RuntimeError(f"QR decoder failed (is frontend/node_modules installed? run npm install in frontend/):\n{result.stderr.strip()}")
    return {r["file"]: r["text"] for r in json.loads(result.stdout)}


def verify(output_dir: Path, *, allow_insecure: bool = False) -> int:
    """Decodes every PNG in output_dir and checks it against manifest.csv.
    0 if everything matches, 1 otherwise (each problem printed)."""
    manifest_path = output_dir / MANIFEST
    if not manifest_path.exists():
        print(f"VERIFY FAILED: no {MANIFEST} in {output_dir}", file=sys.stderr)
        return 1
    with open(manifest_path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    expected = {row["file"]: row["url"] for row in rows}
    pngs = sorted(output_dir.glob("*.png"))
    problems = []

    for name in sorted(set(expected) - {p.name for p in pngs}):
        problems.append(f"{name}: listed in {MANIFEST} but missing")
    for path in pngs:
        if path.name not in expected:
            problems.append(f"{path.name}: not in {MANIFEST} (left over from an older run?)")

    try:
        decoded = decode_pngs([p for p in pngs if p.name in expected])
    except RuntimeError as exc:
        print(f"VERIFY FAILED: {exc}", file=sys.stderr)
        return 1
    for name, text in sorted(decoded.items()):
        if text is None:
            problems.append(f"{name}: no QR code could be decoded")
        elif text != expected[name]:
            problems.append(f"{name}: encodes {text!r}, manifest says {expected[name]!r}")

    bases = set()
    for url in expected.values():
        parts = urlsplit(url)
        bases.add(f"{parts.scheme}://{parts.netloc}")
    for base in sorted(bases):
        try:
            validate_base_url(base, allow_insecure=allow_insecure)
        except BaseUrlError as exc:
            problems.append(f"manifest base URL refused: {exc}")
    if len(bases) > 1:
        problems.append(f"manifest mixes base URLs: {sorted(bases)}")

    if problems:
        print(f"VERIFY FAILED: {len(problems)} problem(s) in {output_dir}", file=sys.stderr)
        for problem in problems:
            print(f"  {problem}", file=sys.stderr)
        return 1
    print(f"Verified: all {len(decoded)} PNG(s) in {output_dir} decode to their {MANIFEST} URL ({', '.join(sorted(bases))}).")
    return 0
