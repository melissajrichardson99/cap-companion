from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from app.errors import NotFoundError
from app.models import MapNode, SetNodeOpenStatusRequest, VisitNodeRequest, VisitNodeResponse
from app.services import map_bingo
from app.staff_auth import require_staff

router = APIRouter(prefix="/map", tags=["map"])


@router.get("/nodes", response_model=list[MapNode])
def list_nodes() -> list[MapNode]:
    return map_bingo.list_map_nodes()


@router.post("/nodes/{node_id}/visit", response_model=VisitNodeResponse)
def visit_node(node_id: UUID, body: VisitNodeRequest) -> VisitNodeResponse:
    try:
        return map_bingo.visit_node(node_id, body.completed_tile_ids)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.patch("/nodes/{node_id}/status", response_model=MapNode, dependencies=[Depends(require_staff)])
def set_node_status(node_id: UUID, body: SetNodeOpenStatusRequest) -> MapNode:
    try:
        return map_bingo.set_node_open_status(node_id, body.is_open)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
