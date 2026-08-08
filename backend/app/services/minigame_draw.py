"""Minigame random draw — tech spec section 4.1.

Pure logic: the caller supplies the available pool and an RNG, so the
uniform-distribution property (the other thing that broke in the prior
attempt at this app) is directly unit-testable without a database.
"""

from __future__ import annotations

import random
from typing import Callable, Sequence, TypeVar

T = TypeVar("T")


def draw_one(
    pool: Sequence[T],
    rng: random.Random,
    *,
    avoid_id: object | None = None,
    id_fn: Callable[[T], object] = lambda x: x,
) -> T:
    """Draw one item uniformly at random from pool.

    If the draw matches avoid_id, re-roll exactly once (the "avoid repeating
    the immediately-preceding draw" refinement from 4.1) — a single re-roll,
    not a filtered re-draw loop, so the result stays a near-uniform draw
    rather than being biased away from the avoided item.
    """
    choice = rng.choice(pool)
    if avoid_id is not None and len(pool) > 1 and id_fn(choice) == avoid_id:
        choice = rng.choice(pool)
    return choice


def draw_for_tile_completion(
    pool: Sequence[T],
    rng: random.Random,
    *,
    milestone_triggered: bool,
    last_played_id: object | None = None,
    id_fn: Callable[[T], object] = lambda x: x,
) -> list[T]:
    """Draw the minigame(s) triggered by completing one bingo tile.

    Always 1 draw for the base completion. If the completion also satisfies
    a milestone (4.2), exactly 1 additional independent draw follows — a
    repeat of the base draw is allowed. The frontend plays the base draw
    immediately, then (after the milestone banner) offers the second draw as
    an opt-in "celebrate the milestone" minigame, so a milestone completion
    is 2 total minigames, not 3. Minigame outcome never feeds back into tile
    completion state; that's enforced by callers simply never wiring a
    result back in, not by anything in this function.
    """
    draws: list[T] = [draw_one(pool, rng, avoid_id=last_played_id, id_fn=id_fn)]
    if milestone_triggered:
        draws.append(draw_one(pool, rng, avoid_id=id_fn(draws[-1]), id_fn=id_fn))
    return draws
