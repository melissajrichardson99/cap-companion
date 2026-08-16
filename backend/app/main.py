import logging
import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.routers import (
    bingo,
    coins,
    hunt,
    map as map_router,
    passport,
    photos,
    puzzles,
    scan,
    scoring,
    session,
    staff_auth,
    staff_requests,
)

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


# Comma-separated list of allowed frontend origins, e.g.
# "https://cap-companion.pages.dev,https://staff-test.cap-companion.pages.dev".
# Defaults to the local Vite dev server so `.env` doesn't need to set this for
# local development; set it explicitly once the frontend is deployed.
_cors_origins_env = os.environ.get("CORS_ALLOWED_ORIGINS")
CORS_ALLOWED_ORIGINS = (
    [origin.strip() for origin in _cors_origins_env.split(",") if origin.strip()]
    if _cors_origins_env
    else ["http://localhost:5173"]
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(map_router.router)
app.include_router(bingo.router)
app.include_router(puzzles.router)
app.include_router(scoring.router)
app.include_router(hunt.router)
app.include_router(scan.router)
app.include_router(staff_auth.router)
app.include_router(staff_requests.router)
app.include_router(coins.router)
app.include_router(photos.router)
app.include_router(passport.router)
app.include_router(session.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
