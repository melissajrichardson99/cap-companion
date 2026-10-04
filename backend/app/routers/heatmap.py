from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query

from app.models import HeatmapSummary
from app.services import heatmap as heatmap_service
from app.staff_auth import require_staff

router = APIRouter(prefix="/staff", tags=["heatmap"])


@router.get("/heatmap", response_model=HeatmapSummary, dependencies=[Depends(require_staff)])
def get_heatmap(
    start: date,
    end: date,
    day: str | None = None,
    hour_start: int | None = Query(default=None, ge=0, le=23),
    hour_end: int | None = Query(default=None, ge=1, le=24),
) -> HeatmapSummary:
    try:
        return heatmap_service.get_heatmap(start, end, day=day, hour_start=hour_start, hour_end=hour_end)
    except heatmap_service.HeatmapFilterError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
