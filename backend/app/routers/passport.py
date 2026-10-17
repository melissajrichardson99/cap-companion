from fastapi import APIRouter, Depends, File, Form, UploadFile

from app.device_session import get_or_create_session
from app.guest_auth import get_optional_guest
from app.models import DeviceSession, Guest, PassportSession
from app.services import passport as passport_service
from app.uploads import LimitedUploadRoute, read_image_upload

router = APIRouter(prefix="/passport", tags=["passport"], route_class=LimitedUploadRoute)


@router.post("/generate", response_model=PassportSession)
async def generate(
    family_label: str = Form(...),
    file: UploadFile | None = File(default=None),
    session: DeviceSession = Depends(get_or_create_session),
    guest: Guest | None = Depends(get_optional_guest),
) -> PassportSession:
    image = await read_image_upload(file) if file is not None else None
    return passport_service.generate_passport(family_label, image, session.id, guest.id if guest else None)
