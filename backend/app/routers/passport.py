from fastapi import APIRouter, Depends, File, Form, UploadFile

from app.device_session import get_or_create_session
from app.guest_auth import get_optional_guest
from app.models import DeviceSession, Guest, PassportSession
from app.services import passport as passport_service

router = APIRouter(prefix="/passport", tags=["passport"])


@router.post("/generate", response_model=PassportSession)
async def generate(
    family_label: str = Form(...),
    file: UploadFile | None = File(default=None),
    session: DeviceSession = Depends(get_or_create_session),
    guest: Guest | None = Depends(get_optional_guest),
) -> PassportSession:
    file_bytes = await file.read() if file is not None else None
    return passport_service.generate_passport(
        family_label,
        file.filename if file is not None else None,
        file.content_type if file is not None else None,
        file_bytes,
        session.id,
        guest.id if guest else None,
    )
