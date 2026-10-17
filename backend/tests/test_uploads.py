"""Photo upload hardening (app/uploads.py) through every upload route --
POST /photos/submit, POST /passport/generate and staff POST
/animal-photos/{slug} -- over the in-memory fake Supabase:

- oversize bodies get a 413 without the body being read to the end
  (declared Content-Length, and a chunked body with none);
- anything that isn't really a JPEG/PNG/WebP is turned away by content,
  whatever its filename or Content-Type claims (415), and a damaged one
  of an allowed type gets a 422;
- valid photos are stored under the extension/content type the server
  picked, never the client's.
"""

from __future__ import annotations

import asyncio
import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

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
    ("content", "filename", "client_type", "extension", "stored_type"),
    [
        (JPEG, "IMG_0001.JPG", "image/jpeg", "jpg", "image/jpeg"),
        (PROGRESSIVE_JPEG, "photo.jpeg", "image/jpeg", "jpg", "image/jpeg"),
        (PNG, "screenshot.png", "image/png", "png", "image/png"),
        (WEBP, "photo.webp", "image/webp", "webp", "image/webp"),
        # Spoofed name/type on a genuine image: still accepted, but stored
        # as what it really is.
        (PNG, "photo.jpg", "image/jpeg", "png", "image/png"),
        (JPEG, "evil.html", "text/html", "jpg", "image/jpeg"),
        (WEBP, "no-extension", "application/octet-stream", "webp", "image/webp"),
    ],
    ids=["jpeg", "progressive-jpeg", "png", "webp", "png-sent-as-jpeg", "jpeg-sent-as-html", "webp-no-ext"],
)
def test_valid_photo_is_stored_under_the_server_chosen_type(
    client, db, route, bucket, fields, content, filename, client_type, extension, stored_type
):
    res = _post(client, route, fields, filename, content, client_type)
    assert res.status_code == 200, res.text
    assert len(db.storage_objects) == 1
    (stored_bucket, path) = next(iter(db.storage_objects))
    assert stored_bucket == bucket
    assert path.endswith(f".{extension}")
    assert db.storage_content_types[(bucket, path)] == stored_type


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
def test_image_with_too_many_pixels_is_rejected_with_413(client, db, route, bucket, fields, monkeypatch):
    monkeypatch.setattr(uploads, "MAX_PIXELS", 64 * 48 - 1)
    res = _post(client, route, fields, "photo.jpg", JPEG, "image/jpeg")
    assert res.status_code == 413, res.text
    assert db.storage_objects == set()


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
