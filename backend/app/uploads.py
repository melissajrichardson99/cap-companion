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
   client's filename and Content-Type entirely.
3. process_image() then re-encodes every accepted photo before it is
   stored: EXIF orientation applied, every bit of metadata (EXIF -- GPS
   included -- XMP, comments, ICC after converting to sRGB) dropped, the
   longest edge capped (GUEST_MAX_EDGE / ANIMAL_MAX_EDGE, never upscaled),
   and saved as a progressive JPEG. So whatever the guest sent, Storage
   only ever holds a .jpg / image/jpeg of bounded size with no location
   data in it. Callers store the result via ValidatedImage.file_options().

The input limits are deliberately sized for unprocessed phone photos: the
frontend sends the camera's file as-is, with no resizing or compression
(see MAX_UPLOAD_BYTES below). The shrinking happens here, server-side.
"""

from __future__ import annotations

import io
import threading
from dataclasses import dataclass

from fastapi import HTTPException, Request, UploadFile
from fastapi.routing import APIRoute
from PIL import Image, ImageCms, ImageOps
from starlette.concurrency import run_in_threadpool

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
# default-mode phone photo (50MP sensors included). JPEG is decoded in
# draft mode -- at 1/2..1/8 scale, just big enough for the target size --
# so even a 50MP JPEG peaks around +30-45MB. PNG and WebP have no
# reduced-size decode and are always decoded in full, so they get tighter
# caps, measured to keep one decode near ~200MB on Render's ~512MB
# instance: PNG ~9 bytes/pixel at peak (25MP -> ~216MB), WebP ~16 (its
# decoder holds a second full copy; 12MP -> ~188MB). Phones shoot neither
# -- they arrive as screenshots or already-downsized web images.
MAX_PIXELS = 60_000_000
MAX_PNG_PIXELS = 25_000_000
MAX_WEBP_PIXELS = 12_000_000

# Longest edge of the stored photo. Guest photos show at most ~800 CSS px
# wide (Home's Photo of the Day on desktop; the lightbox is 90vw), so 1600
# covers a 2x screen. Animal photos also fill Our Animals' full-width hero.
GUEST_MAX_EDGE = 1600
ANIMAL_MAX_EDGE = 2000
JPEG_QUALITY = 82

# Every stored path is a fresh uuid4, so an object's bytes never change
# under a URL -- browsers and Supabase's CDN can keep it for a year. The
# storage client and Storage both prefix "max-age=" to this value; checked
# on dev, the public URL then serves "public, max-age=31536000, immutable".
# (Before this, uploads were served "no-cache": refetched on every view.)
CACHE_CONTROL = "31536000, immutable"

# One PNG/WebP decode can take ~200MB (see the caps above), so only one
# photo is processed at a time; others wait their turn in the threadpool
# (a JPEG takes ~0.1-0.3s) rather than decoding together and exhausting
# memory.
_PROCESS_SLOTS = threading.BoundedSemaphore(1)

TOO_LARGE_MESSAGE = "That photo is too large to upload. Please choose one under 15 MB."
TOO_MANY_PIXELS_MESSAGE = (
    "That photo has too many pixels to process. Please choose a smaller one, or take it at the camera's normal setting."
)
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

    def file_options(self) -> dict[str, str]:
        """Storage upload options for this image."""
        return {"content-type": self.content_type, "cache-control": CACHE_CONTROL}


def _too_large() -> HTTPException:
    return HTTPException(status_code=413, detail=TOO_LARGE_MESSAGE)


def _too_many_pixels() -> HTTPException:
    return HTTPException(status_code=422, detail=TOO_MANY_PIXELS_MESSAGE)


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


def _pixel_cap(fmt: str) -> int:
    return {"JPEG": MAX_PIXELS, "PNG": MAX_PNG_PIXELS, "WEBP": MAX_WEBP_PIXELS}[fmt]


def validate_image(content: bytes) -> ValidatedImage:
    """Checks what the bytes really are; returns them unchanged, labelled
    with the format found. process_image() is what makes them storable."""
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
            if width * height > _pixel_cap(fmt):
                raise _too_many_pixels()
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
        raise _too_many_pixels() from None
    except Exception:
        raise HTTPException(status_code=422, detail=UNREADABLE_MESSAGE) from None

    extension, content_type = _FORMATS[fmt]
    return ValidatedImage(content=content, extension=extension, content_type=content_type)


_SRGB = ImageCms.createProfile("sRGB")


def _to_srgb(image: Image.Image, icc: bytes | None) -> Image.Image:
    """RGB pixels in sRGB, the colour space browsers assume for an image
    with no ICC profile. iPhones shoot Display P3, so just dropping the
    profile would leave their photos slightly washed out."""
    if icc:
        try:
            source = ImageCms.ImageCmsProfile(io.BytesIO(icc))
            return ImageCms.profileToProfile(image, source, _SRGB, outputMode="RGB")
        except Exception:
            pass  # An unusable profile: fall back to a plain conversion.
    return image.convert("RGB")


def _resizable(image: Image.Image) -> Image.Image:
    """A mode Pillow resizes smoothly. Palette images would otherwise be
    resized nearest-neighbour, and 16-bit/1-bit ones not at all."""
    if image.mode in ("RGB", "RGBA", "L", "LA", "CMYK"):
        return image
    has_alpha = image.mode in ("PA", "RGBa", "La") or "transparency" in image.info
    return image.convert("RGBA" if has_alpha else "RGB")


def _flatten(image: Image.Image) -> Image.Image:
    """Transparency (PNG/WebP alpha, palette transparency) onto white --
    JPEG has no alpha, and a plain convert("RGB") would turn it black."""
    if image.mode in ("RGBA", "LA"):
        rgba = image.convert("RGBA")
        background = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        background.alpha_composite(rgba)
        return background.convert("RGB")
    return image


def process_image(validated: ValidatedImage, max_edge: int) -> ValidatedImage:
    """Re-encodes an already-validated photo for storage: oriented, longest
    edge at most `max_edge` (never upscaled), all metadata dropped, saved
    as a progressive JPEG. Synchronous and CPU-heavy -- route handlers go
    through read_image_upload(), which runs it off the event loop."""
    fmt = _sniff_format(validated.content)
    with _PROCESS_SLOTS:
        try:
            with Image.open(io.BytesIO(validated.content), formats=[fmt]) as source:
                width, height = source.size
                if width * height > _pixel_cap(fmt):
                    raise _too_many_pixels()
                scale = min(1.0, max_edge / max(width, height))
                if fmt == "JPEG":
                    # Lets libjpeg decode straight to the smallest 1/2^n
                    # scale that is still at least the target size.
                    source.draft(None, (max(1, int(width * scale)), max(1, int(height * scale))))
                source.load()
                icc = source.info.get("icc_profile")
                image = _resizable(source)
                # Shrink first, in place, so the full-size decode is freed
                # before the orientation/alpha/colour steps make their
                # copies (those then only ever touch the small image).
                # Rotation never changes which edge is longest.
                image.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
                image = _to_srgb(_flatten(ImageOps.exif_transpose(image)), icc)

                out = io.BytesIO()
                # No exif=/icc_profile= passed and a fresh buffer, so nothing
                # from the original's metadata reaches the output.
                image.save(out, "JPEG", quality=JPEG_QUALITY, progressive=True, optimize=True)
        except HTTPException:
            raise
        except Image.DecompressionBombError:
            raise _too_many_pixels() from None
        except Exception:
            raise HTTPException(status_code=422, detail=UNREADABLE_MESSAGE) from None

    return ValidatedImage(content=out.getvalue(), extension="jpg", content_type="image/jpeg")


def prepare_image(content: bytes, max_edge: int) -> ValidatedImage:
    """validate_image() then process_image() -- the whole server-side path
    from uploaded bytes to what gets stored."""
    return process_image(validate_image(content), max_edge)


async def read_image_upload(file: UploadFile, max_edge: int) -> ValidatedImage:
    """The one entry point every upload route uses. The body cap above
    already bounds the read; reading one byte past the file limit is what
    tells "exactly at the limit" from "over it". Decoding and re-encoding
    run in the threadpool so one big photo doesn't stall every other
    guest's request."""
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    return await run_in_threadpool(prepare_image, content, max_edge)
