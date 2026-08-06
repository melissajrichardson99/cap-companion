import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.routers import bingo, hunt, map as map_router, puzzles, scan, scoring, staff_requests

logger = logging.getLogger("app")

app = FastAPI(title="Cobb's Adventure Park Companion API")


@app.middleware("http")
async def catch_unhandled_exceptions(request: Request, call_next):
    # Registered before CORSMiddleware is added below, so it ends up *inside*
    # CORSMiddleware in the middleware stack. A handler registered via
    # @app.exception_handler(Exception) instead binds to Starlette's
    # ServerErrorMiddleware, which always sits outside every user middleware
    # (including CORSMiddleware) — so an unhandled exception would ship with
    # no Access-Control-Allow-Origin header, the browser would block the
    # frontend from reading it, and fetch() would throw a generic
    # "TypeError: Failed to fetch" instead of surfacing the real error.
    # Catching it here keeps the response inside CORSMiddleware's wrapping.
    try:
        return await call_next(request)
    except Exception as exc:
        logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
        return JSONResponse(status_code=500, content={"detail": str(exc)})


app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(map_router.router)
app.include_router(bingo.router)
app.include_router(puzzles.router)
app.include_router(scoring.router)
app.include_router(hunt.router)
app.include_router(scan.router)
app.include_router(staff_requests.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
