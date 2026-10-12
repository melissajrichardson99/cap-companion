"""In-process cache for shared reference data (Supabase call budget, Phase 2).

Only rows that are identical for every guest go in here -- map nodes, the
bingo layout, minigames, puzzles, scoring games, Hunt characters/challenges,
announcements, animal photos, the shortlisted photo gallery and the QR
lookup tables. Nothing session-, guest- or staff-specific is ever stored:
callers cache the shared query and still run their per-session queries
(node_visits, session_tile_completions, hunt_progress, ...) on every request.

Freshness:
- Every API write to a cached table calls invalidate() for its keys in the
  same request, before the response goes out, so staff see their change on
  their next read and guests on their next load.
- Edits that bypass the API (migrations, a staff time typed into the SQL
  editor) are picked up when the entry's TTL runs out. DEFAULT_TTL is short
  for that reason; STATIC_TTL is only used for tables that change with a
  code release (minigames, scoring games, the bingo layout, Hunt challenge
  content).
- An in-flight load that started before an invalidate() never stores its
  (possibly pre-write) result: each key carries a generation number that
  invalidate() bumps, and a load only stores if the generation it started
  under is still current.

The cache is per process. The backend runs as a single uvicorn process
today, so every request sees the same entries; a restart (deploy, or the
free tier spinning down when idle) simply starts empty. With more than one
instance, each keeps its own copy and an invalidate() only reaches the
instance that handled the write -- other instances catch up within the TTL
(see DEPLOYMENT.md).

Kill switch: REFERENCE_CACHE_ENABLED=0 (also false/no/off) turns caching off
entirely -- every get() just runs its loader, exactly as before this cache
existed. Read on every call, so tests can flip it with monkeypatch.setenv.

Callers get a deep copy of the cached value, so mutating a result can never
leak into another request.
"""

from __future__ import annotations

import copy
import logging
import os
import threading
import time
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass
from typing import TypeVar

logger = logging.getLogger("app.reference_cache")

T = TypeVar("T")

DEFAULT_TTL = 60.0
STATIC_TTL = 300.0
# Keys are a fixed set plus one per bingo card and one per map node, so this
# is only a backstop; least-recently-used entries fall out first.
MAX_ENTRIES = 512
# How long a request waits for another request already loading the same key
# before giving up and loading it itself.
_INFLIGHT_WAIT_SECONDS = 10.0

# Keys. One per distinct shared query, so each cached value is exactly what
# that query returned before caching (same columns, same row order).
MAP_NODES = "map_nodes"
MAP_NODES_BY_NAME = "map_nodes:by_name"
BINGO_TILE_LINKS = "bingo_tiles:links"
BINGO_CARDS = "bingo_cards"
MINIGAMES = "minigames"
PUZZLES = "puzzles"
PUZZLE_CHALLENGES = "puzzle_challenges"
SCORING_GAMES = "scoring_games"
GAME_SCORE_EVENTS = "game_score_events"
HUNT_CHARACTERS = "hunt_characters"
HUNT_CHALLENGES = "hunt_challenges"
ANNOUNCEMENTS = "announcements"
ANIMAL_PHOTOS = "animal_photos"
PHOTO_GALLERY = "photo_gallery"
SCANNABLE_CODES = "scannable_codes"
ENCYCLOPEDIA_ENTRIES = "encyclopedia_entries"
ANIMAL_MAP_LOCATIONS = "animal_map_locations"


def bingo_card_tiles_key(card_id: str) -> str:
    return f"bingo_tiles:card:{card_id}"


def node_linked_tiles_key(node_id: str) -> str:
    return f"bingo_tiles:node:{node_id}"


@dataclass
class _Entry:
    value: object
    expires_at: float


_entries: OrderedDict[str, _Entry] = OrderedDict()
_generations: dict[str, int] = {}
_global_generation = 0
_inflight: dict[str, threading.Event] = {}
_stats: dict[str, dict[str, int]] = {}
_lock = threading.Lock()

# Patched by tests to control time without sleeping.
_clock = time.monotonic


def enabled() -> bool:
    return os.environ.get("REFERENCE_CACHE_ENABLED", "1").strip().lower() not in ("0", "false", "no", "off")


def _bump(key: str, field: str) -> None:
    counters = _stats.setdefault(key, {"hits": 0, "misses": 0, "invalidations": 0})
    counters[field] += 1


def _generation(key: str) -> tuple[int, int]:
    return _global_generation, _generations.get(key, 0)


def get(key: str, loader: Callable[[], T], ttl: float = DEFAULT_TTL) -> T:
    """The cached value for `key`, or loader()'s result (stored for `ttl`
    seconds) on a miss. Concurrent misses on the same key share one load.
    A loader that raises stores nothing and the exception propagates."""
    if not enabled():
        return loader()

    while True:
        with _lock:
            entry = _entries.get(key)
            if entry is not None:
                if entry.expires_at > _clock():
                    _entries.move_to_end(key)
                    _bump(key, "hits")
                    logger.debug("reference cache hit: %s", key)
                    return copy.deepcopy(entry.value)
                del _entries[key]
            event = _inflight.get(key)
            if event is None:
                event = threading.Event()
                _inflight[key] = event
                generation = _generation(key)
                _bump(key, "misses")
                break
        # Another request is already loading this key: wait for it, then
        # re-check (its result may not have been stored if an invalidate()
        # landed meanwhile, in which case this request loads it fresh).
        if not event.wait(_INFLIGHT_WAIT_SECONDS):
            with _lock:
                _bump(key, "misses")
            logger.debug("reference cache wait timed out, loading directly: %s", key)
            return loader()

    logger.debug("reference cache miss: %s", key)
    try:
        value = loader()
    except BaseException:
        with _lock:
            if _inflight.get(key) is event:
                del _inflight[key]
        event.set()
        raise

    with _lock:
        if _generation(key) == generation:
            _entries[key] = _Entry(value=copy.deepcopy(value), expires_at=_clock() + ttl)
            _entries.move_to_end(key)
            while len(_entries) > MAX_ENTRIES:
                _entries.popitem(last=False)
        if _inflight.get(key) is event:
            del _inflight[key]
    event.set()
    return value


def invalidate(*keys: str) -> None:
    """Drops `keys` now and stops any load already in flight for them from
    storing its result. Called by every write path, whether or not the
    cache is enabled."""
    with _lock:
        for key in keys:
            _entries.pop(key, None)
            _generations[key] = _generations.get(key, 0) + 1
            # A request arriving after this must not wait on a load that
            # started before the write.
            _inflight.pop(key, None)
            _bump(key, "invalidations")
    logger.debug("reference cache invalidate: %s", ", ".join(keys))


def clear() -> None:
    """Drops every entry (tests, and anything that needs a clean slate)."""
    global _global_generation
    with _lock:
        _entries.clear()
        _inflight.clear()
        _global_generation += 1


def stats() -> dict[str, dict[str, int]]:
    """Per-key hit/miss/invalidation counters since the last reset_stats()."""
    with _lock:
        return {key: dict(counters) for key, counters in _stats.items()}


def reset_stats() -> None:
    with _lock:
        _stats.clear()
