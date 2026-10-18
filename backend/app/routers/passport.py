from fastapi import APIRouter, Depends, File, Form, UploadFile

from app.device_session import get_or_create_session
from app.guest_auth import get_optional_guest
from app.models import DeviceSession, Guest, PassportSession
from app.rate_limit import PASSPORT_PHOTO_UPLOAD, device_rate_limit
from app.services import passport as passport_service
from app.uploads import GUEST_MAX_EDGE, LimitedUploadRoute, read_image_upload

router = APIRouter(prefix="/passport", tags=["passport"], route_class=LimitedUploadRoute)


# Counts every passport generated (with or without a photo) -- each is a
# public write, and 10 an hour is far past what one family makes.
@router.post("/generate", response_model=PassportSession, dependencies=[Depends(device_rate_limit(PASSPORT_PHOTO_UPLOAD))])
async def generate(
    family_label: str = Form(...),
    file: UploadFile | None = File(default=None),
    session: DeviceSession = Depends(get_or_create_session),
    guest: Guest | None = Depends(get_optional_guest),
) -> PassportSession:
    image = await read_image_upload(file, GUEST_MAX_EDGE) if file is not None else None
    return passport_service.generate_passport(family_label, image, session.id, guest.id if guest else None)
