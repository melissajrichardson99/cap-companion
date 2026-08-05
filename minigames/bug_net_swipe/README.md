# Bug Net Swipe

Godot 4.x project (GDScript only). Open `project.godot` in the Godot editor to test and export.

## Gameplay
- Bugs spawn from a random edge (left, right, or top) and fly across/down the play area on a curved path: a straight base velocity with a sine-wave oscillation superimposed perpendicular to that direction (`pos = spawn_pos + vel * elapsed + perp * amplitude * sin(elapsed * freq)`), plus per-bug entry angle and speed variance, so paths feel varied rather than uniform. Bugs that exit the play bounds uncaught are simply pruned from the array — no penalty, no unbounded growth.
- Bugs are plain data (`bugs: Array` of `{spawn_pos, pos, vel, perp, amplitude, freq, elapsed, radius, caught, flash_timer, wing_phase}` dicts) drawn every frame via `_draw()`, not scene-tree physics nodes — same "data array + custom draw" convention as Obstacle Dodge/Mini Snake. Each bug renders as a procedurally drawn oval body + a small head dot + two diamond "wing" shapes oriented along its direction of travel — no emoji text (Godot's Web export has no emoji glyph fallback, confirmed gotcha from an earlier minigame in this repo).
- **Core mechanic — swipe-catch, not tap-catch**: pointer state (`InputEventScreenTouch`/`InputEventScreenDrag` for touch, `InputEventMouseButton`/`InputEventMouseMotion` with the left button held for mouse) is tracked in `_unhandled_input`. On every motion event while the pointer is down, the line segment from the last recorded pointer position to the new one is tested against every active (uncaught) bug's collision circle via a segment-vs-circle distance test (`_segment_intersects_circle`). Any bug whose circle the segment crosses is caught immediately — this is a continuous gesture-vs-moving-target intersection test, not a discrete click/tap on a bug's current position.
- A caught bug gets a brief scale-pop + color flash (`FLASH_DURATION = 0.18s`) before being removed from the array, giving visible feedback that the swipe connected.
- Round state: `TIME_LIMIT = 30.0`, `TARGET_CATCHES = 8`. Win: reach 8 catches before time runs out — the round ends immediately on the catch that reaches the target, it does not wait out the clock. Lose: time reaches 0 before 8 catches.
- Round opens with the same "Ready? 3 2 1 Go!" countdown as every other minigame here, guarded by the `round_token` pattern so an abandoned countdown can't start spawning bugs on top of a new round.
- "Play Again" on the game-over screen calls `_start_game()` directly (no scene reload). Win, lose, and the top-bar "X" exit button all call `_notify_host_complete()`.

## Tuning landed on
- `BUG_RADIUS = 20.0`, `BUG_SPEED_MIN/MAX = 95.0/155.0`, `SPAWN_INTERVAL_MIN/MAX = 0.55/0.95`, `AMPLITUDE_MIN/MAX = 14.0/42.0`, `FREQ_MIN/MAX = 1.2/2.6` (radians/sec of oscillation).
- Verified via Playwright: an aggressive, continuously-swiping "mow the lawn" zigzag bot reaches 8/8 catches in roughly 8-12 seconds of round time (well inside the 30s budget), which gives real, less-than-optimal players (reacting to bug positions rather than sweeping the whole board nonstop) headroom to still finish before time runs out without it being a first-swipe gimme. If real playtesting shows casual players regularly timing out, first lever to pull is `SPAWN_INTERVAL_MIN/MAX` (spawn more often) before touching bug speed or radius.

## What to verify (per this project's testing standard — code read-through isn't sufficient for gesture/timing mechanics)
- The segment-vs-circle intersection math is correct at the boundary (a swipe that only grazes a bug's edge should still catch it; a swipe that passes near but outside the radius should not). Verified deterministically with a throwaway debug build (a single stationary bug hardcoded at a known screen position, in a scratch copy of the project only — not the shipped script) swept by a scripted mouse path; catch count went from 0/8 to 1/8 exactly on the swipe that crossed the bug's position.
- Bug paths are visibly varied (different entry edges, angles, and oscillation) rather than uniform straight lines — confirmed via screenshots showing simultaneously-visible bugs with different orientations/curvature.
- Win path: reaching 8/8 ends the round immediately (screenshot confirmed the game-over layer appearing with `Time:` still well above 0) and shows "Caught 'em All!" + "Bugs caught: 8/8".
- Lose path: leaving the pointer untouched for the full round shows "Time's Up!" + "Bugs caught: 0/8" at `Time: 0`.
- All three exit paths (top-bar "X", win screen, lose screen) and "Play Again" (which resets labels/countdown in place, no reload) fire the `minigame-complete` postMessage — confirmed by capturing `window.addEventListener('message', ...)` in the page during Playwright runs.
- No emoji/tofu glyphs anywhere — bugs and UI use only procedural shapes and plain Latin-alphabet label text.

## Not yet done
- Art/theme pass — bugs currently render as flat-colored polygons (oval body + wing diamonds + head dot) via `_draw()`, no textures/sprites yet, consistent with every other minigame's current state in this repo.
- No sound effects on catch (visual flash/pop only).
