from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import bingo, map as map_router

app = FastAPI(title="Cobb's Adventure Park Companion API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(map_router.router)
app.include_router(bingo.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
