from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.errors import NotFoundError, ValidationError
from app.models import AnimalPhoto, ReorderAnimalPhotosRequest
from app.services import animal_photos as animal_photos_service
from app.staff_auth import require_staff
from app.uploads import ANIMAL_MAX_EDGE, LimitedUploadRoute, read_image_upload

router = APIRouter(prefix="/animal-photos", tags=["animal-photos"], route_class=LimitedUploadRoute)


@router.get("", response_model=list[AnimalPhoto])
def list_all() -> list[AnimalPhoto]:
    return animal_photos_service.list_all()


@router.post("/{animal_slug}", response_model=AnimalPhoto, dependencies=[Depends(require_staff)])
async def upload(animal_slug: str, file: UploadFile = File(...)) -> AnimalPhoto:
    image = await read_image_upload(file, ANIMAL_MAX_EDGE)
    try:
        return animal_photos_service.upload(animal_slug, image)
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/{photo_id}", status_code=204, dependencies=[Depends(require_staff)])
def delete(photo_id: UUID) -> None:
    try:
        animal_photos_service.delete(photo_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.put("/{animal_slug}/reorder", response_model=list[AnimalPhoto], dependencies=[Depends(require_staff)])
def reorder(animal_slug: str, body: ReorderAnimalPhotosRequest) -> list[AnimalPhoto]:
    try:
        return animal_photos_service.reorder(animal_slug, body.photo_ids)
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
