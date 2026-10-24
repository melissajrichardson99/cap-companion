#!/usr/bin/env python3
"""Fail if any tracked image carries EXIF, GPS, XMP, IPTC or comment metadata.

Stdlib only, so it runs anywhere Python does (pytest, CI, a git hook) with no
Pillow or exiftool. Detection and stripping work on the raw container bytes:

- JPEG: APP1 (Exif / XMP), APP13 (Photoshop IRB / IPTC), COM, other vendor
  APPn segments, and any data after EOI. Entropy-coded data is never touched,
  so stripping is lossless. APP0 (JFIF), APP2 ICC_PROFILE and APP14 (Adobe
  colour transform) are kept because they change how the pixels render.
- PNG: eXIf, tEXt, zTXt, iTXt (XMP lives here) and tIME chunks. Colour chunks
  (iCCP, sRGB, gAMA, cHRM, pHYs) are kept.
- WebP: EXIF and XMP chunks, with the VP8X flags and RIFF size fixed up.

Usage:
  python scripts/check-image-metadata.py            # check tracked images, exit 1 on any hit
  python scripts/check-image-metadata.py --report   # per-folder counts, always exit 0
  python scripts/check-image-metadata.py --strip    # strip in place (refuses EXIF rotation)
  python scripts/check-image-metadata.py FILE...    # check only the given files

The history rewrite (scripts/prepare-public-history.sh) imports strip_bytes()
from this file, so keep it free of side effects at import time.
"""
from __future__ import annotations

import os
import struct
import subprocess
import sys
import zlib
from collections import Counter, defaultdict

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}

# PNG chunks that carry metadata rather than pixels or colour information.
PNG_META_CHUNKS = {b"eXIf", b"tEXt", b"zTXt", b"iTXt", b"tIME"}

XMP_SIG = b"http://ns.adobe.com/xap/1.0/\x00"
XMP_EXT_SIG = b"http://ns.adobe.com/xmp/extension/\x00"


def kind_of(data: bytes) -> str | None:
    if data[:3] == b"\xff\xd8\xff":
        return "jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


# ---------------------------------------------------------------- EXIF parse

def _exif_tags(tiff: bytes) -> tuple[bool, int | None]:
    """Return (has_gps_ifd, orientation) from a TIFF-structured EXIF block."""
    if len(tiff) < 8 or tiff[:2] not in (b"II", b"MM"):
        return False, None
    end = "<" if tiff[:2] == b"II" else ">"
    try:
        (ifd,) = struct.unpack(end + "I", tiff[4:8])
        (count,) = struct.unpack(end + "H", tiff[ifd:ifd + 2])
    except struct.error:
        return False, None
    has_gps, orientation = False, None
    for i in range(count):
        entry = tiff[ifd + 2 + i * 12: ifd + 14 + i * 12]
        if len(entry) < 12:
            break
        tag, typ = struct.unpack(end + "HH", entry[:4])
        if tag == 0x8825:
            has_gps = True
        elif tag == 0x0112 and typ == 3:
            (orientation,) = struct.unpack(end + "H", entry[8:10])
    return has_gps, orientation


def _xmp_has_gps(xmp: bytes) -> bool:
    return b"GPSLatitude" in xmp or b"GPSLongitude" in xmp


# ---------------------------------------------------------------- JPEG

def _jpeg_segments(data: bytes):
    """Yield (marker, start, end) for each header segment up to and including SOS,
    then ('scan', sos_end, eoi_end) and ('trailer', eoi_end, len) if present."""
    pos = 2
    n = len(data)
    while pos < n:
        if data[pos] != 0xFF:
            raise ValueError("bad JPEG marker at %d" % pos)
        while pos < n and data[pos] == 0xFF:
            pos += 1
        marker = data[pos]
        pos += 1
        seg_start = pos - 2
        if marker == 0xD9:  # EOI with no scan
            yield marker, seg_start, pos
            return
        if 0xD0 <= marker <= 0xD7 or marker == 0x01:
            yield marker, seg_start, pos
            continue
        (length,) = struct.unpack(">H", data[pos:pos + 2])
        seg_end = pos + length
        yield marker, seg_start, seg_end
        pos = seg_end
        if marker == 0xDA:
            # Entropy-coded data runs until a marker that is not RST or a
            # stuffed 0x00. Progressive files have several scans, so keep
            # walking markers after each one until EOI.
            scan = pos
            while True:
                j = data.find(b"\xff", scan)
                if j < 0 or j + 1 >= n:
                    yield "scan", pos, n
                    return
                nxt = data[j + 1]
                if nxt == 0x00 or 0xD0 <= nxt <= 0xD7 or nxt == 0xFF:
                    scan = j + 1 if nxt == 0xFF else j + 2
                    continue
                yield "scan", pos, j
                if nxt == 0xD9:
                    yield 0xD9, j, j + 2
                    if j + 2 < n:
                        yield "trailer", j + 2, n
                    return
                pos = j
                break


def _jpeg_classify(marker, payload: bytes) -> str | None:
    """Return a metadata category for an APPn/COM segment, or None to keep it."""
    if marker == 0xFE:
        return "comment"
    if marker == 0xE1:
        if payload.startswith(b"Exif\x00\x00"):
            return "exif"
        if payload.startswith(XMP_SIG) or payload.startswith(XMP_EXT_SIG):
            return "xmp"
        return "app-other"
    if marker == 0xED:
        return "iptc"
    if marker == 0xE0:
        return None if payload.startswith(b"JFIF\x00") else "app-other"
    if marker == 0xE2:
        return None if payload.startswith(b"ICC_PROFILE\x00") else "app-other"
    if marker == 0xEE:
        return None  # Adobe APP14: colour transform, affects decoding
    if 0xE3 <= marker <= 0xEF:
        return "app-other"
    return None


def scan_jpeg(data: bytes) -> dict:
    found: Counter = Counter()
    orientation = None
    for marker, start, end in _jpeg_segments(data):
        if marker == "trailer":
            if data[start:end].strip(b"\x00"):
                found["trailer"] += 1
            continue
        if not isinstance(marker, int) or not (0xE0 <= marker <= 0xEF or marker == 0xFE):
            continue
        payload = data[start + 4:end]
        cat = _jpeg_classify(marker, payload)
        if cat is None:
            continue
        found[cat] += 1
        if cat == "exif":
            gps, orient = _exif_tags(payload[6:])
            if gps:
                found["gps"] += 1
            if orient is not None:
                orientation = orient
        elif cat == "xmp" and _xmp_has_gps(payload):
            found["gps"] += 1
    return {"found": found, "orientation": orientation}


def strip_jpeg(data: bytes) -> bytes:
    out = [data[:2]]
    for marker, start, end in _jpeg_segments(data):
        if marker == "trailer":
            continue
        if isinstance(marker, int) and (0xE0 <= marker <= 0xEF or marker == 0xFE):
            if _jpeg_classify(marker, data[start + 4:end]) is not None:
                continue
        out.append(data[start:end])
    return b"".join(out)


# ---------------------------------------------------------------- PNG

def _png_chunks(data: bytes):
    pos = 8
    while pos + 8 <= len(data):
        (length,) = struct.unpack(">I", data[pos:pos + 4])
        ctype = data[pos + 4:pos + 8]
        end = pos + 12 + length
        yield ctype, pos, end
        pos = end
        if ctype == b"IEND":
            if pos < len(data):
                yield b"trailer", pos, len(data)
            return


def scan_png(data: bytes) -> dict:
    found: Counter = Counter()
    orientation = None
    for ctype, start, end in _png_chunks(data):
        body = data[start + 8:end - 4]
        if ctype == b"trailer":
            found["trailer"] += 1
        elif ctype == b"eXIf":
            found["exif"] += 1
            gps, orientation = _exif_tags(body)
            if gps:
                found["gps"] += 1
        elif ctype == b"iTXt" and body.startswith(b"XML:com.adobe.xmp\x00"):
            found["xmp"] += 1
            if _xmp_has_gps(body):
                found["gps"] += 1
        elif ctype in (b"tEXt", b"zTXt", b"iTXt"):
            key = body.split(b"\x00", 1)[0]
            found["iptc" if b"iptc" in key.lower() else "comment"] += 1
            if b"exif" in key.lower():  # ImageMagick "Raw profile type exif"
                found["exif"] += 1
                text = body
                if ctype == b"zTXt":
                    try:
                        text = zlib.decompress(body[len(key) + 2:])
                    except zlib.error:
                        text = b""
                if b"GPS" in text or b"\x88\x25" in text or b"8825" in text:
                    found["gps"] += 1
        elif ctype == b"tIME":
            found["comment"] += 1
    return {"found": found, "orientation": orientation}


def strip_png(data: bytes) -> bytes:
    out = [data[:8]]
    for ctype, start, end in _png_chunks(data):
        if ctype in PNG_META_CHUNKS or ctype == b"trailer":
            continue
        out.append(data[start:end])
    return b"".join(out)


# ---------------------------------------------------------------- WebP

def _webp_chunks(data: bytes):
    pos = 12
    while pos + 8 <= len(data):
        ctype = data[pos:pos + 4]
        (length,) = struct.unpack("<I", data[pos + 4:pos + 8])
        end = pos + 8 + length + (length & 1)
        yield ctype, pos, end
        pos = end


def scan_webp(data: bytes) -> dict:
    found: Counter = Counter()
    orientation = None
    for ctype, start, end in _webp_chunks(data):
        body = data[start + 8:end]
        if ctype == b"EXIF":
            found["exif"] += 1
            tiff = body[6:] if body.startswith(b"Exif\x00\x00") else body
            gps, orientation = _exif_tags(tiff)
            if gps:
                found["gps"] += 1
        elif ctype == b"XMP ":
            found["xmp"] += 1
            if _xmp_has_gps(body):
                found["gps"] += 1
    return {"found": found, "orientation": orientation}


def strip_webp(data: bytes) -> bytes:
    chunks = []
    for ctype, start, end in _webp_chunks(data):
        if ctype in (b"EXIF", b"XMP "):
            continue
        chunk = data[start:end]
        if ctype == b"VP8X":
            flags = chunk[8] & ~0x0C  # clear EXIF (0x08) and XMP (0x04) bits
            chunk = chunk[:8] + bytes([flags]) + chunk[9:]
        chunks.append(chunk)
    body = b"WEBP" + b"".join(chunks)
    return b"RIFF" + struct.pack("<I", len(body)) + body


# ---------------------------------------------------------------- API

SCANNERS = {"jpeg": scan_jpeg, "png": scan_png, "webp": scan_webp}
STRIPPERS = {"jpeg": strip_jpeg, "png": strip_png, "webp": strip_webp}


def scan_bytes(data: bytes) -> dict | None:
    kind = kind_of(data)
    if kind is None:
        return None
    try:
        result = SCANNERS[kind](data)
    except (ValueError, struct.error, IndexError) as exc:
        return {"kind": kind, "found": Counter(), "orientation": None, "error": str(exc)}
    result["kind"] = kind
    return result


class RotatedImageError(ValueError):
    """Stripping would drop an EXIF orientation the pixels still depend on."""


def strip_bytes(data: bytes) -> bytes:
    """Return data with all metadata removed, or data unchanged if it is not a
    supported image, has nothing to strip, or cannot be parsed safely. Raises
    RotatedImageError rather than silently turning a rotated photo sideways."""
    result = scan_bytes(data)
    if not result or result.get("error") or not result["found"]:
        return data
    if result["orientation"] not in (None, 1):
        raise RotatedImageError("EXIF orientation %s: rotate pixels first" % result["orientation"])
    try:
        return STRIPPERS[result["kind"]](data)
    except (ValueError, struct.error, IndexError):
        return data


def tracked_images(root: str) -> list[str]:
    out = subprocess.run(
        ["git", "ls-files", "-z"], cwd=root, capture_output=True, check=True
    ).stdout.decode("utf-8")
    return [p for p in out.split("\0") if os.path.splitext(p)[1].lower() in IMAGE_EXTS]


def main(argv: list[str]) -> int:
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    flags = {a for a in argv if a.startswith("--")}
    files = [a for a in argv if not a.startswith("--")]
    paths = files or tracked_images(root)

    per_folder: dict[str, Counter] = defaultdict(Counter)
    bad: list[tuple[str, list[str]]] = []
    for rel in paths:
        full = rel if os.path.isabs(rel) else os.path.join(root, rel)
        with open(full, "rb") as fh:
            data = fh.read()
        result = scan_bytes(data)
        folder = os.path.dirname(rel).replace("\\", "/") or "."
        per_folder[folder]["images"] += 1
        if result is None:
            continue
        if result.get("error"):
            bad.append((rel, ["unparseable: " + result["error"]]))
            continue
        cats = sorted(result["found"])
        for c in cats:
            per_folder[folder][c] += 1
        if not cats:
            continue
        per_folder[folder]["with_metadata"] += 1
        if "--strip" in flags:
            if result["orientation"] not in (None, 1):
                bad.append((rel, ["EXIF orientation %s: rotate pixels first" % result["orientation"]]))
                continue
            with open(full, "wb") as fh:
                fh.write(STRIPPERS[result["kind"]](data))
        else:
            bad.append((rel, cats))

    if "--report" in flags or "--strip" in flags:
        cols = ["images", "with_metadata", "exif", "gps", "xmp", "iptc", "comment", "app-other", "trailer"]
        print("folder\t" + "\t".join(cols))
        for folder in sorted(per_folder):
            print(folder + "\t" + "\t".join(str(per_folder[folder][c]) for c in cols))
        if "--strip" in flags:
            for rel, why in bad:
                print("SKIPPED %s: %s" % (rel, "; ".join(why)))
            return 1 if bad else 0
        return 0

    if bad:
        print("Image metadata found (run: python scripts/check-image-metadata.py --strip):")
        for rel, cats in bad:
            print("  %s: %s" % (rel, ", ".join(cats)))
        return 1
    print("OK: %d tracked images, no EXIF/GPS/XMP/IPTC/comment metadata" % len(paths))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
