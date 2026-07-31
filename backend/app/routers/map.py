from uuid import UUID

from fastapi import APIRouter, HTTPException

from app.errors import NotFoundError
from app.models import MapNode, VisitNodeRequest, VisitNodeResponse
from app.services import map_bingo

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
