from datetime import date

from fastapi import APIRouter, Depends

from app.models import AnalyticsSummary
from app.services import analytics as analytics_service
from app.staff_auth import require_staff

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/summary", response_model=AnalyticsSummary, dependencies=[Depends(require_staff)])
def get_summary(start: date, end: date) -> AnalyticsSummary:
    return analytics_service.get_summary(start, end)
