"""Generates printable QR PNGs for scan codes and Our Animals deep links.

Each Hunt code's QR encodes <FRONTEND_BASE_URL>/scan/<code> -- the same route
the frontend's /scan/:code screen serves -- so a phone's normal camera app (no
in-app scanning needed) opens straight into the right challenge/placeholder
page. Our Animals QRs encode <FRONTEND_BASE_URL>/animals/<slug> instead -- a
deliberately separate URL scheme (not /scan/<code>) so the 4 animal names
that are also Hunt characters never collide with a Hunt code. FRONTEND_BASE_URL
defaults to the local Vite dev server; set it in .env to the real deployed
frontend origin before printing signage for the park.
"""

from __future__ import annotations

import io
import os

import qrcode

FRONTEND_BASE_URL = os.environ.get("FRONTEND_BASE_URL", "http://localhost:5173")


def scan_url(code: str) -> str:
    return f"{FRONTEND_BASE_URL.rstrip('/')}/scan/{code}"


def animal_url(slug: str) -> str:
    return f"{FRONTEND_BASE_URL.rstrip('/')}/animals/{slug}"


def generate_qr_png_for_url(url: str) -> bytes:
    image = qrcode.make(url)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def generate_qr_png(code: str) -> bytes:
    return generate_qr_png_for_url(scan_url(code))
