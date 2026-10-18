"""Generates QR PNGs.

generate_qr_png_for_url() is what the printable-signage scripts use
(scripts/generate_*_qr_codes.py via scripts/qr_output.py): they build each
URL from an explicit, checked --base-url / QR_BASE_URL, never from the
environment default below.

generate_qr_png(code) serves GET /scan/{code}/qr.png, a one-off/testing
convenience: it encodes <FRONTEND_BASE_URL>/scan/<code>, so it is only as
right as that server's FRONTEND_BASE_URL (localhost when unset). Don't
print from it -- use the scripts, which refuse localhost and non-https.
"""

from __future__ import annotations

import io
import os

import qrcode

FRONTEND_BASE_URL = os.environ.get("FRONTEND_BASE_URL", "http://localhost:5173")


def scan_url(code: str) -> str:
    return f"{FRONTEND_BASE_URL.rstrip('/')}/scan/{code}"


def generate_qr_png_for_url(url: str) -> bytes:
    image = qrcode.make(url)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def generate_qr_png(code: str) -> bytes:
    return generate_qr_png_for_url(scan_url(code))
