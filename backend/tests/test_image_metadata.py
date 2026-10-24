"""Image metadata guard (scripts/check-image-metadata.py): no tracked image may
carry EXIF, GPS, XMP, IPTC or comment metadata -- phone photos dropped into
frontend/public/ ship their camera GPS to every visitor otherwise. The unit
tests inject real metadata segments into a tracked image and check that
detection fires and stripping gives back the original bytes exactly.

Skipped, not failed, outside a git checkout (the guard lists files via git).
"""

from __future__ import annotations

import importlib.util
import shutil
import struct
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location("check_image_metadata", REPO / "scripts" / "check-image-metadata.py")
guard = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(guard)

needs_git = pytest.mark.skipif(
    shutil.which("git") is None or not (REPO / ".git").exists(), reason="guard lists tracked files via git"
)

# Minimal little-endian TIFF: IFD0 with one entry, the GPS IFD pointer (0x8825).
_TIFF_WITH_GPS = b"II*\x00" + struct.pack("<I", 8) + struct.pack("<H", 1) + struct.pack("<HHII", 0x8825, 4, 1, 26) + b"\x00" * 4


def _first_tracked(ext: str) -> bytes:
    out = subprocess.run(["git", "ls-files", "*" + ext], cwd=REPO, capture_output=True, text=True, check=True).stdout
    return (REPO / out.splitlines()[0]).read_bytes()


@needs_git
def test_no_tracked_image_carries_metadata(capsys):
    assert guard.main([]) == 0, capsys.readouterr().out


@needs_git
def test_jpeg_exif_gps_and_comment_detected_and_stripped_losslessly():
    clean = _first_tracked(".jpg")
    payload = b"Exif\x00\x00" + _TIFF_WITH_GPS
    app1 = b"\xff\xe1" + struct.pack(">H", len(payload) + 2) + payload
    com = b"\xff\xfe" + struct.pack(">H", 7) + b"hello"
    dirty = clean[:2] + app1 + com + clean[2:] + b"MPF-trailer"
    found = guard.scan_bytes(dirty)["found"]
    assert {"exif", "gps", "comment", "trailer"} <= set(found)
    assert guard.strip_bytes(dirty) == clean


@needs_git
def test_png_exif_and_text_chunks_detected_and_stripped_losslessly():
    clean = _first_tracked(".png")
    ihdr_end = 8 + 25

    def chunk(ctype: bytes, body: bytes) -> bytes:
        import zlib

        return struct.pack(">I", len(body)) + ctype + body + struct.pack(">I", zlib.crc32(ctype + body))

    dirty = clean[:ihdr_end] + chunk(b"eXIf", _TIFF_WITH_GPS) + chunk(b"tEXt", b"Comment\x00hi") + clean[ihdr_end:]
    found = guard.scan_bytes(dirty)["found"]
    assert {"exif", "gps", "comment"} <= set(found)
    assert guard.strip_bytes(dirty) == clean


def test_webp_exif_and_xmp_chunks_stripped_and_flags_cleared():
    def chunk(ctype: bytes, body: bytes) -> bytes:
        return ctype + struct.pack("<I", len(body)) + body + (b"\x00" if len(body) & 1 else b"")

    vp8x = chunk(b"VP8X", bytes([0x0C]) + b"\x00" * 9)
    image = chunk(b"VP8L", b"\x2f" + b"\x00" * 8)
    meta = chunk(b"EXIF", _TIFF_WITH_GPS) + chunk(b"XMP ", b"<x:xmpmeta exif:GPSLatitude='1'/>")
    body = b"WEBP" + vp8x + image + meta
    dirty = b"RIFF" + struct.pack("<I", len(body)) + body
    assert {"exif", "gps", "xmp"} <= set(guard.scan_bytes(dirty)["found"])
    stripped = guard.strip_bytes(dirty)
    assert not guard.scan_bytes(stripped)["found"]
    assert stripped[20] & 0x0C == 0  # VP8X flags byte
    assert struct.unpack("<I", stripped[4:8])[0] == len(stripped) - 8


@needs_git
def test_strip_refuses_to_drop_exif_rotation():
    clean = _first_tracked(".jpg")
    tiff = b"II*\x00" + struct.pack("<I", 8) + struct.pack("<H", 1) + struct.pack("<HHIHH", 0x0112, 3, 1, 6, 0) + b"\x00" * 4
    payload = b"Exif\x00\x00" + tiff
    dirty = clean[:2] + b"\xff\xe1" + struct.pack(">H", len(payload) + 2) + payload + clean[2:]
    with pytest.raises(guard.RotatedImageError):
        guard.strip_bytes(dirty)


def test_non_images_pass_through_untouched():
    data = b"\x00asm\x01\x00\x00\x00 not an image"
    assert guard.scan_bytes(data) is None
    assert guard.strip_bytes(data) is data
