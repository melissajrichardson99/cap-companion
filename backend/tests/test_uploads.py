"""Photo upload hardening (app/uploads.py) through every upload route --
POST /photos/submit, POST /passport/generate and staff POST
/animal-photos/{slug} -- over the in-memory fake Supabase:

- oversize bodies get a 413 without the body being read to the end
  (declared Content-Length, and a chunked body with none);
- anything that isn't really a JPEG/PNG/WebP is turned away by content,
  whatever its filename or Content-Type claims (415), and a damaged one
  of an allowed type gets a 422;
- valid photos are re-encoded and always stored as .jpg / image/jpeg with
  a year-long Cache-Control, whatever type or name the client sent;
- process_image() itself: size cap per route, never upscaled, EXIF
  orientation applied, EXIF/GPS/ICC gone, transparency onto white, and
  everything a guest's phone actually sends (progressive JPEG, WebP, PNG).
"""

from __future__ import annotations

import asyncio
import io

import pytest
from fastapi.testclient import TestClient
from fastapi import HTTPException
from PIL import Image, ImageCms

from app import device_session, supabase_client, uploads
from app.main import app
from app.staff_auth import require_staff
from tests.fake_supabase import FakeSupabase

GUEST = {"X-Device-Session": "upload-test-device"}

# (route, bucket, extra form fields) for every upload route.
ROUTES = [
    ("/photos/submit", "favorite-photos", {"guest_label": "The Testers"}),
    ("/passport/generate", "family-passport-photos", {"family_label": "The Testers"}),
    ("/animal-photos/goat", "animal-photos", {}),
]
ROUTE_IDS = ["favorite-photo", "family-passport", "staff-animal-photo"]


def _image(fmt: str, size=(64, 48), **save_kwargs) -> bytes:
    buf = io.BytesIO()
    Image.effect_noise(size, 40).convert("RGB").save(buf, fmt, **save_kwargs)
    return buf.getvalue()


def _with_claimed_size(jpeg: bytes, width: int, height: int) -> bytes:
    """Rewrites a baseline JPEG's SOF0 frame header to claim another size."""
    sof = jpeg.index(b"\xff\xc0")
    return jpeg[: sof + 5] + height.to_bytes(2, "big") + width.to_bytes(2, "big") + jpeg[sof + 9 :]


JPEG = _image("JPEG")
PNG = _image("PNG")
WEBP = _image("WEBP")
GIF = _image("GIF")
PROGRESSIVE_JPEG = _image("JPEG", size=(400, 300), progressive=True)


@pytest.fixture
def db(monkeypatch):
    fake = FakeSupabase()
    # Passport stats need at least one Hunt character to total against.
    fake.tables["hunt_characters"].append({"id": "11111111-1111-1111-1111-111111111111"})
    monkeypatch.setattr(supabase_client, "SUPABASE_URL", "https://fake.supabase.co")
    monkeypatch.setattr(supabase_client, "SUPABASE_KEY", "fake-key")
    monkeypatch.setattr(supabase_client, "_client", fake)
    monkeypatch.setattr(device_session, "_recent_sessions", device_session.OrderedDict())
    app.dependency_overrides[require_staff] = lambda: None
    yield fake
    app.dependency_overrides.pop(require_staff, None)


@pytest.fixture
def client(db):
    return TestClient(app)


def _post(client, route, fields, filename, content, content_type):
    return client.post(route, headers=GUEST, data=fields, files={"file": (filename, content, content_type)})


@pytest.mark.parametrize(("route", "bucket", "fields"), ROUTES, ids=ROUTE_IDS)
@pytest.mark.parametrize(
    ("content", "filename", "client_type"),
    [
        (JPEG, "IMG_0001.JPG", "image/jpeg"),
        (PROGRESSIVE_JPEG, "photo.jpeg", "image/jpeg"),
        (PNG, "screenshot.png", "image/png"),
        (WEBP, "photo.webp", "image/webp"),
        # Spoofed name/type on a genuine image: still accepted, and stored
        # as the JPEG the server made of it.
        (PNG, "photo.jpg", "image/jpeg"),
        (JPEG, "evil.html", "text/html"),
        (WEBP, "no-extension", "application/octet-stream"),
    ],
    ids=["jpeg", "progressive-jpeg", "png", "webp", "png-sent-as-jpeg", "jpeg-sent-as-html", "webp-no-ext"],
)
def test_valid_photo_is_stored_as_a_server_made_jpeg(client, db, route, bucket, fields, content, filename, client_type):
    res = _post(client, route, fields, filename, content, client_type)
    assert res.status_code == 200, res.text
    assert len(db.storage_objects) == 1
    (stored_bucket, path) = next(iter(db.storage_objects))
    assert stored_bucket == bucket
    assert path.endswith(".jpg")
    assert db.storage_content_types[(bucket, path)] == "image/jpeg"
    assert db.storage_cache_control[(bucket, path)] == uploads.CACHE_CONTROL
    stored = db.storage_bytes[(bucket, path)]
    assert stored != content
    with Image.open(io.BytesIO(stored)) as out:
        assert out.format == "JPEG"
        assert out.size == Image.open(io.BytesIO(content)).size  # small input: not resized


@pytest.mark.parametrize(("route", "bucket", "fields"), ROUTES, ids=ROUTE_IDS)
@pytest.mark.parametrize(
    ("content", "filename", "client_type"),
    [
        (b"MZ\x90\x00\x03\x00\x00\x00" + b"\x00" * 200, "holiday.jpg", "image/jpeg"),
        (b"<!doctype html><script>alert(1)</script>", "photo.jpg", "image/jpeg"),
        (
            b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
            "photo.svg",
            "image/svg+xml",
        ),
        (b'<svg xmlns="http://www.w3.org/2000/svg"/>', "photo.png", "image/png"),
        (GIF, "animation.gif", "image/gif"),
        (GIF, "animation.jpg", "image/jpeg"),
        # HEIC isn't handled anywhere in the app (Pillow can't read it and
        # most browsers can't display it), so it's refused like any other
        # unsupported type.
        (b"\x00\x00\x00\x18ftypheic\x00\x00\x00\x00mif1heic" + b"\x00" * 64, "IMG_0001.HEIC", "image/heic"),
        (b"", "empty.jpg", "image/jpeg"),
    ],
    ids=["renamed-exe", "html", "svg", "svg-as-png", "gif", "gif-as-jpeg", "heic", "empty"],
)
def test_unsupported_type_is_rejected_with_415(client, db, route, bucket, fields, content, filename, client_type):
    res = _post(client, route, fields, filename, content, client_type)
    assert res.status_code == 415, res.text
    assert res.json()["detail"] == uploads.UNSUPPORTED_TYPE_MESSAGE
    assert db.storage_objects == set()


@pytest.mark.parametrize(("route", "bucket", "fields"), ROUTES, ids=ROUTE_IDS)
@pytest.mark.parametrize(
    "content",
    [
        JPEG[: len(JPEG) // 2],
        PROGRESSIVE_JPEG[: len(PROGRESSIVE_JPEG) // 2],
        PNG[: len(PNG) - 20],
        WEBP[: len(WEBP) // 2],
        b"\xff\xd8\xff" + b"not really a jpeg" * 20,
        b"\x89PNG\r\n\x1a\n" + b"\x00" * 100,
    ],
    ids=["truncated-jpeg", "truncated-progressive-jpeg", "truncated-png", "truncated-webp", "jpeg-magic-only", "png-magic-only"],
)
def test_damaged_photo_is_rejected_with_422(client, db, route, bucket, fields, content):
    res = _post(client, route, fields, "photo.jpg", content, "image/jpeg")
    assert res.status_code == 422, res.text
    assert res.json()["detail"] == uploads.UNREADABLE_MESSAGE
    assert db.storage_objects == set()


@pytest.mark.parametrize(("route", "bucket", "fields"), ROUTES, ids=ROUTE_IDS)
def test_file_over_the_limit_is_rejected_with_413(client, db, route, bucket, fields):
    # One byte over the file limit, but inside the whole-request cap (which
    # allows for the multipart envelope) -- the file-level check catches it.
    content = b"\xff\xd8\xff" + b"\x00" * (uploads.MAX_UPLOAD_BYTES - 2)
    res = _post(client, route, fields, "big.jpg", content, "image/jpeg")
    assert res.status_code == 413, res.text
    assert res.json()["detail"] == uploads.TOO_LARGE_MESSAGE
    assert db.storage_objects == set()


@pytest.mark.parametrize(("route", "bucket", "fields"), ROUTES, ids=ROUTE_IDS)
@pytest.mark.parametrize(
    ("content", "cap"),
    [(JPEG, "MAX_PIXELS"), (PNG, "MAX_PNG_PIXELS"), (WEBP, "MAX_WEBP_PIXELS")],
    ids=["jpeg", "png", "webp"],
)
def test_image_with_too_many_pixels_is_rejected_with_422(client, db, route, bucket, fields, content, cap, monkeypatch):
    monkeypatch.setattr(uploads, cap, 64 * 48 - 1)
    res = _post(client, route, fields, "photo.jpg", content, "image/jpeg")
    assert res.status_code == 422, res.text
    assert res.json()["detail"] == uploads.TOO_MANY_PIXELS_MESSAGE
    assert db.storage_objects == set()


def test_60mp_header_is_refused_before_any_pixels_are_decoded():
    # A small JPEG whose frame header claims 9000x6800 (61MP): the cap fires
    # on the header alone -- decoding would fail on the missing data instead.
    with pytest.raises(HTTPException) as exc:
        uploads.validate_image(_with_claimed_size(JPEG, 9000, 6800))
    assert exc.value.status_code == 422
    assert exc.value.detail == uploads.TOO_MANY_PIXELS_MESSAGE


@pytest.mark.parametrize(
    ("route", "max_edge"),
    [("/photos/submit", uploads.GUEST_MAX_EDGE), ("/passport/generate", uploads.GUEST_MAX_EDGE), ("/animal-photos/goat", uploads.ANIMAL_MAX_EDGE)],
    ids=ROUTE_IDS,
)
def test_every_upload_route_goes_through_the_shared_processor(client, db, route, max_edge, monkeypatch):
    calls = []
    real = uploads.prepare_image

    def spy(content, edge):
        calls.append(edge)
        return real(content, edge)

    monkeypatch.setattr(uploads, "prepare_image", spy)
    fields = next(f for r, _, f in ROUTES if r == route)
    res = _post(client, route, fields, "photo.jpg", JPEG, "image/jpeg")
    assert res.status_code == 200, res.text
    assert calls == [max_edge]


def test_passport_without_a_photo_still_generates(client, db):
    res = client.post("/passport/generate", headers=GUEST, data={"family_label": "No Photo Family"})
    assert res.status_code == 200, res.text
    assert res.json()["photo_url"] is None
    assert db.storage_objects == set()


def test_413_response_carries_cors_headers(client, db):
    # The frontend can only show the friendly message if the browser lets
    # it read the response.
    content = b"\xff\xd8\xff" + b"\x00" * (uploads.MAX_UPLOAD_BYTES - 2)
    res = client.post(
        "/photos/submit",
        headers={**GUEST, "Origin": "http://localhost:5173"},
        files={"file": ("big.jpg", content, "image/jpeg")},
    )
    assert res.status_code == 413
    assert res.headers["access-control-allow-origin"] == "http://localhost:5173"


# --- body cap, driven at the ASGI level so the test controls (and counts)
# exactly how much of the body the app pulls in. TestClient buffers the
# whole request body before calling the app, so it can't show this.

CHUNK = b"\x00" * (1024 * 1024)
BOUNDARY = "capboundary"


def _run_asgi(path: str, headers: dict[str, str], total_chunks: int) -> tuple[int, int, bytes]:
    """Feeds the app a POST of `total_chunks` 1MB chunks; returns (status,
    chunks the app actually read, response body)."""
    state = {"read": 0}
    sent: list[dict] = []

    async def receive():
        if state["read"] >= total_chunks:
            return {"type": "http.disconnect"}
        state["read"] += 1
        if state["read"] == 1:
            preamble = (
                f'--{BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="big.jpg"\r\n'
                "Content-Type: image/jpeg\r\n\r\n"
            ).encode()
            return {"type": "http.request", "body": preamble + CHUNK, "more_body": True}
        return {"type": "http.request", "body": CHUNK, "more_body": state["read"] < total_chunks}

    async def send(message):
        sent.append(message)

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"",
        "root_path": "",
        "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()]
        + [(b"content-type", f"multipart/form-data; boundary={BOUNDARY}".encode())],
        "client": ("127.0.0.1", 50000),
        "server": ("testserver", 80),
    }
    asyncio.run(app(scope, receive, send))
    start = next(m for m in sent if m["type"] == "http.response.start")
    body = b"".join(m.get("body", b"") for m in sent if m["type"] == "http.response.body")
    return start["status"], state["read"], body


@pytest.mark.parametrize("path", [r[0] for r in ROUTES], ids=ROUTE_IDS)
def test_declared_oversize_content_length_is_refused_before_reading_any_body(db, path):
    status, chunks_read, body = _run_asgi(path, {**GUEST, "content-length": str(200 * 1024 * 1024)}, 200)
    assert status == 413
    assert chunks_read == 0
    assert uploads.TOO_LARGE_MESSAGE.encode() in body


@pytest.mark.parametrize("path", [r[0] for r in ROUTES], ids=ROUTE_IDS)
def test_chunked_oversize_body_is_cut_off_at_the_cap(db, path):
    # No Content-Length at all (chunked transfer): 200MB offered, and the
    # app stops pulling chunks as soon as the running total passes the cap.
    status, chunks_read, body = _run_asgi(path, GUEST, 200)
    assert status == 413
    cap_chunks = uploads.MAX_REQUEST_BYTES // len(CHUNK) + 1
    assert chunks_read <= cap_chunks
    assert uploads.TOO_LARGE_MESSAGE.encode() in body


@pytest.mark.parametrize("path", [r[0] for r in ROUTES], ids=ROUTE_IDS)
def test_understated_content_length_is_still_cut_off_at_the_cap(db, path):
    # A client that claims a small body and then keeps sending.
    status, chunks_read, _ = _run_asgi(path, {**GUEST, "content-length": "1000"}, 200)
    assert status == 413
    assert chunks_read <= uploads.MAX_REQUEST_BYTES // len(CHUNK) + 1


def test_non_upload_routes_on_the_same_routers_are_unaffected(client, db):
    assert client.get("/photos/gallery", headers=GUEST).status_code == 200
    assert client.get("/animal-photos").status_code == 200


# --- process_image(): what actually gets stored ----------------------------


def _process(content: bytes, max_edge: int = uploads.GUEST_MAX_EDGE) -> Image.Image:
    out = uploads.prepare_image(content, max_edge)
    assert out.extension == "jpg"
    assert out.content_type == "image/jpeg"
    image = Image.open(io.BytesIO(out.content))
    assert image.format == "JPEG"
    return image


def _halves(size, left, right, mode="RGB") -> Image.Image:
    image = Image.new(mode, size, left)
    image.paste(right, (size[0] // 2, 0, size[0], size[1]))
    return image


def _save(image: Image.Image, fmt: str, **kwargs) -> bytes:
    buf = io.BytesIO()
    image.save(buf, fmt, **kwargs)
    return buf.getvalue()


@pytest.mark.parametrize(
    ("size", "max_edge", "expected"),
    [
        ((4000, 3000), uploads.GUEST_MAX_EDGE, (1600, 1200)),
        ((3000, 4000), uploads.GUEST_MAX_EDGE, (1200, 1600)),
        ((4000, 3000), uploads.ANIMAL_MAX_EDGE, (2000, 1500)),
        ((2200, 1000), uploads.GUEST_MAX_EDGE, (1600, 727)),
        # Already within the cap: never upscaled.
        ((1600, 900), uploads.GUEST_MAX_EDGE, (1600, 900)),
        ((800, 600), uploads.ANIMAL_MAX_EDGE, (800, 600)),
        ((10, 10), uploads.GUEST_MAX_EDGE, (10, 10)),
    ],
    ids=["landscape", "portrait", "animal-cap", "panorama", "at-cap", "small-animal", "tiny"],
)
def test_longest_edge_is_capped_keeping_aspect_ratio(size, max_edge, expected):
    content = _save(_halves(size, (200, 40, 40), (40, 40, 200)), "JPEG", quality=95)
    assert _process(content, max_edge).size == expected


def test_output_is_a_progressive_jpeg():
    image = _process(_save(_halves((2000, 1500), "red", "blue"), "PNG"))
    assert image.info.get("progressive") or image.info.get("progression")


def test_exif_orientation_is_applied_then_dropped():
    # Stored landscape, red left / blue right, tagged "rotate 90 CW to
    # display" (orientation 6): shown upright it is portrait with red on top.
    exif = Image.Exif()
    exif[0x0112] = 6
    content = _save(_halves((400, 200), (255, 0, 0), (0, 0, 255)), "JPEG", exif=exif.tobytes(), quality=95)
    image = _process(content)
    assert image.size == (200, 400)
    top, bottom = image.getpixel((100, 50)), image.getpixel((100, 350))
    assert top[0] > 200 and top[2] < 60, top
    assert bottom[2] > 200 and bottom[0] < 60, bottom
    assert 0x0112 not in image.getexif()


def _phone_photo_with_gps(size=(1200, 900)) -> bytes:
    exif = Image.Exif()
    exif[0x010F] = "PhoneMaker"  # Make
    exif[0x0110] = "PhoneModel 15"  # Model
    exif[0x0132] = "2026:10:18 12:00:00"  # DateTime
    gps = exif.get_ifd(0x8825)
    gps[1] = "N"
    gps[2] = (51.0, 2.0, 30.5)
    gps[3] = "W"
    gps[4] = (114.0, 4.0, 12.25)
    icc = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
    content = _save(
        Image.effect_noise(size, 30).convert("RGB"), "JPEG", exif=exif.tobytes(), icc_profile=icc, comment=b"secret note"
    )
    with Image.open(io.BytesIO(content)) as check:  # the sample really carries it
        assert check.getexif().get_ifd(0x8825)[2] == (51.0, 2.0, 30.5)
        assert check.info.get("icc_profile")
    return content


def test_gps_and_all_other_metadata_are_stripped():
    out = uploads.prepare_image(_phone_photo_with_gps(), uploads.GUEST_MAX_EDGE).content
    image = Image.open(io.BytesIO(out))
    assert len(image.getexif()) == 0
    assert image.getexif().get_ifd(0x8825) == {}
    for key in ("exif", "icc_profile", "xmp", "comment", "photoshop"):
        assert key not in image.info, key
    # Belt and braces: no APP1 Exif/XMP segment, and none of the values.
    for needle in (b"Exif\x00\x00", b"http://ns.adobe.com/xap", b"PhoneMaker", b"PhoneModel", b"secret note", b"ICC_PROFILE"):
        assert needle not in out, needle


@pytest.mark.parametrize("fmt", ["PNG", "WEBP"])
def test_transparency_is_flattened_onto_white(fmt):
    image = Image.new("RGBA", (300, 200), (0, 0, 0, 0))
    image.paste((0, 128, 0, 255), (150, 0, 300, 200))
    out = _process(_save(image, fmt, **({"lossless": True} if fmt == "WEBP" else {})))
    assert out.mode == "RGB"
    clear, solid = out.getpixel((50, 100)), out.getpixel((250, 100))
    assert min(clear) > 245, clear
    assert solid[1] > 100 and solid[0] < 40, solid


def test_palette_png_with_transparency_is_flattened_onto_white():
    image = Image.new("P", (100, 100), 0)
    image.putpalette([0, 0, 0, 255, 0, 0] + [0] * 762)
    image.paste(1, (50, 0, 100, 100))
    content = _save(image, "PNG", transparency=0)
    out = _process(content)
    assert min(out.getpixel((10, 50))) > 245
    assert out.getpixel((90, 50))[0] > 200


@pytest.mark.parametrize("mode", ["L", "CMYK", "RGB"])
def test_other_colour_modes_come_out_rgb(mode):
    fmt = "PNG" if mode == "L" else "JPEG"
    out = _process(_save(Image.new(mode, (2400, 1800)), fmt), uploads.GUEST_MAX_EDGE)
    assert out.mode == "RGB"
    assert out.size == (1600, 1200)


def test_webp_input_is_resized_and_converted():
    out = _process(_save(Image.effect_noise((2500, 2000), 30).convert("RGB"), "WEBP", quality=90))  # 5MP
    assert out.size == (1600, 1280)


def test_large_progressive_jpeg_input_is_resized():
    out = _process(_save(Image.effect_noise((3000, 2250), 30).convert("RGB"), "JPEG", progressive=True, quality=95))
    assert out.size == (1600, 1200)


def test_processed_photo_is_far_smaller_than_the_original():
    # A 12MP phone-camera-quality JPEG (noise is a worst case for JPEG:
    # real photos shrink further).
    original = _save(Image.effect_noise((4000, 3000), 25).convert("RGB"), "JPEG", quality=95)
    processed = uploads.prepare_image(original, uploads.GUEST_MAX_EDGE).content
    assert len(processed) * 4 < len(original), (len(original), len(processed))


def test_processing_runs_off_the_event_loop(monkeypatch):
    seen = []

    async def spy(func, *args):
        seen.append(func)
        return func(*args)

    monkeypatch.setattr(uploads, "run_in_threadpool", spy)

    class _File:
        async def read(self, n):
            return JPEG

    asyncio.run(uploads.read_image_upload(_File(), uploads.GUEST_MAX_EDGE))
    assert seen == [uploads.prepare_image]
