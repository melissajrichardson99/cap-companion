"""Generates the printable QR PNG for a scan code.

Each code's QR encodes <FRONTEND_BASE_URL>/scan/<code> -- the same route the
frontend's /scan/:code screen serves -- so a phone's normal camera app (no
in-app scanning needed) opens straight into the right challenge/placeholder
page. FRONTEND_BASE_URL defaults to the local Vite dev server; set it in
.env to the real deployed frontend origin before printing signage for the park.
"""

from __future__ import annotations

import io
import os

import qrcode

FRONTEND_BASE_URL = os.environ.get("FRONTEND_BASE_URL", "http://localhost:5173")


def scan_url(code: str) -> str:
    return f"{FRONTEND_BASE_URL.rstrip('/')}/scan/{code}"


def generate_qr_png(code: str) -> bytes:
    image = qrcode.make(scan_url(code))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()
