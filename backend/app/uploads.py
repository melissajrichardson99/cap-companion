"""Shared guard for every photo upload route: POST /photos/submit (Favorite
Photo), POST /passport/generate (Family Passport group photo) and staff POST
/animal-photos/{slug}.

Two layers, both server-side (the frontend's accept="image/*" and its own
size pre-check in api.ts are conveniences, never trusted):

1. LimitedUploadRoute caps the request body while it is being received --
   a Content-Length over the cap is turned away before any of the body is
   read, and a body with no (or a lying) Content-Length is cut off as soon
   as the running byte count passes the cap. Starlette would otherwise
   spool an upload of any size to a temp file before the endpoint runs.
2. read_image_upload() checks what the bytes actually are -- magic bytes
   plus a Pillow parse restricted to that one format -- and ignores the
   client's filename and Content-Type entirely. Callers store the result
   under the extension and content type chosen here.

The limits are deliberately sized for unprocessed phone photos: the
frontend sends the camera's file as-is, with no resizing or compression
(see MAX_UPLOAD_BYTES below).
"""

from __future__ import annotations

import io
from dataclasses import dataclass

from fastapi import HTTPException, Request, UploadFile
from fastapi.routing import APIRoute
from PIL import Image

# Phones send their camera file untouched (the frontend never resizes): a
# default-mode 12-24MP JPEG is ~2-8MB, and the largest default-mode photos
# (50MP sensors, or iOS converting a 48MP HEIF to JPEG on upload) land
# around 10-14MB. 15MB covers all of those with headroom; only full-res
# 108/200MP "pro" modes go over, and those exceed the pixel limit anyway.
MAX_UPLOAD_BYTES = 15 * 1024 * 1024
# The multipart envelope (boundaries, part headers) plus the small text
# fields sent alongside the file (guest_label, email, family_label).
_FORM_OVERHEAD_BYTES = 64 * 1024
MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + _FORM_OVERHEAD_BYTES

# Header-only check, made before any pixels are decoded. 60MP clears every
# default-mode phone photo (50MP sensors included). JPEG is only decoded at
# 1/8 scale and PNG not at all, so this bounds their cost loosely; WebP has
# no cheap check and is fully decoded, so it gets a tighter cap -- phones
# don't shoot WebP, it only arrives as already-downsized web images.
MAX_PIXELS = 60_000_000
MAX_WEBP_PIXELS = 25_000_000

TOO_LARGE_MESSAGE = "That photo is too large to upload. Please choose one under 15 MB."
UNSUPPORTED_TYPE_MESSAGE = "That file isn't a supported photo. Please choose a JPEG, PNG or WebP image."
UNREADABLE_MESSAGE = "That photo couldn't be read -- it may be damaged or only partly saved. Please try another one."

_FORMATS = {
    # Pillow format name -> (stored extension, stored content type)
    "JPEG": ("jpg", "image/jpeg"),
    "PNG": ("png", "image/png"),
    "WEBP": ("webp", "image/webp"),
}


@dataclass(frozen=True)
class ValidatedImage:
    content: bytes
    extension: str
    content_type: str


def _too_large() -> HTTPException:
    return HTTPException(status_code=413, detail=TOO_LARGE_MESSAGE)


class LimitedUploadRoute(APIRoute):
    """Route class for routers that take uploads (route_class=... on the
    APIRouter). The HTTPException raised from the receive wrapper surfaces
    from inside FastAPI's request.form() call, which re-raises
    HTTPExceptions as-is (anything else becomes a generic 400), so the
    client gets the 413 below rather than a parse error."""

    def get_route_handler(self):
        original_handler = super().get_route_handler()

        async def handler(request: Request):
            return await original_handler(_limit_body(request))

        return handler


def _limit_body(request: Request) -> Request:
    content_length = request.headers.get("content-length")
    if content_length is not None:
        try:
            declared = int(content_length)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid Content-Length header") from None
        if declared > MAX_REQUEST_BYTES:
            raise _too_large()

    receive = request.receive
    received = 0

    async def limited_receive():
        nonlocal received
        message = await receive()
        if message["type"] == "http.request":
            received += len(message.get("body", b""))
            if received > MAX_REQUEST_BYTES:
                raise _too_large()
        return message

    return Request(request.scope, limited_receive, request._send)


def _sniff_format(content: bytes) -> str | None:
    if content.startswith(b"\xff\xd8\xff"):
        return "JPEG"
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "PNG"
    if content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "WEBP"
    return None


def validate_image(content: bytes) -> ValidatedImage:
    if len(content) > MAX_UPLOAD_BYTES:
        raise _too_large()

    fmt = _sniff_format(content)
    if fmt is None:
        raise HTTPException(status_code=415, detail=UNSUPPORTED_TYPE_MESSAGE)

    try:
        # formats=[fmt]: the bytes must parse as the format their magic
        # bytes claim, not merely as *something* Pillow recognises.
        with Image.open(io.BytesIO(content), formats=[fmt]) as image:
            width, height = image.size
            if width * height > (MAX_WEBP_PIXELS if fmt == "WEBP" else MAX_PIXELS):
                raise _too_large()
            if fmt == "JPEG":
                # Decodes every scan at 1/8 scale -- cheap, but still runs
                # out of data (and raises) on a truncated file.
                image.draft(None, (max(width // 8, 1), max(height // 8, 1)))
                image.load()
            elif fmt == "PNG":
                # Walks every chunk to IEND checking CRCs, no pixel decode.
                image.verify()
            else:
                image.load()
    except HTTPException:
        raise
    except Image.DecompressionBombError:
        raise _too_large() from None
    except Exception:
        raise HTTPException(status_code=422, detail=UNREADABLE_MESSAGE) from None

    extension, content_type = _FORMATS[fmt]
    return ValidatedImage(content=content, extension=extension, content_type=content_type)


async def read_image_upload(file: UploadFile) -> ValidatedImage:
    # The body cap above already bounds this; reading one byte past the
    # file limit is what tells "exactly at the limit" from "over it".
    return validate_image(await file.read(MAX_UPLOAD_BYTES + 1))
