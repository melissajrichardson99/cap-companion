# Mini Platformer

Godot 4.x project (GDScript only). Open `project.godot` in the Godot editor to test and export.

## Gameplay
- Kangaroo-themed run/jump side-scroller. The player auto-runs right at a constant speed (`RUN_SPEED`); the only input is a single jump (on-floor only, no double-jump), via the on-screen JUMP button, a tap/click anywhere, or Space/Up in the editor.
- Real physics: `CharacterBody2D` player + `StaticBody2D` ground segments (`move_and_slide`, gravity, `is_on_floor()`), not hand-rolled AABB checks. Hazards and the goal are `Area2D`s using `body_entered`.
- Level is 5 ground segments (`PLATFORMS` in `scripts/Main.gd`) separated by 40px gaps and one 70px-raised segment, plus two ground hazards that must be jumped over. `Camera2D` follows the player horizontally, clamped to the level bounds.
- Win: touch the flag (`Goal` Area2D) at the end of the level. Lose: touch a hazard, or fall through a gap past `FALL_LIMIT_Y`. No endless mode.
- Round opens with the same "Ready? 3 2 1 Go!" countdown used in the other games, guarded by the `round_token` pattern so an abandoned countdown (exit/restart mid-count) can't start the run on top of a new one.
- "Play Again" on the game-over screen calls `_start_game()` directly (no scene reload).

## Physics tuning (why the numbers are what they are)
With `GRAVITY = 900`, `JUMP_VELOCITY = -420`, `RUN_SPEED = 90`:
- Jump airtime ≈ 0.933s → horizontal travel during a full jump arc ≈ 84px, vs. 40px gaps — roughly 44px of timing slack in either direction, well outside normal human reaction error at this run speed.
- Jump peak height ≈ 98px, vs. the one raised segment's 70px rise — clears with margin.
- Level is 2700px wide at 90px/s ≈ 30s of run time, matching the tech spec's ~30s-per-round target (plus the countdown).

## What to verify in the editor
- Both gaps are actually clearable and both are missable if you don't jump (walking off an edge with no floor underneath should start a fall, not get suspended).
- The raised segment is reachable but the game doesn't let you jump through its underside (hence `CollisionShape2D` on the segment, not a one-way platform).
- Hazard collision and goal collision both fire exactly once (no double-trigger from re-entering `_end_game` after `is_running` is already false).
- Falling into a gap eventually triggers a loss via `FALL_LIMIT_Y`, not an infinite fall.

## Not yet done (needs the GUI)
- Web export (renderer is pre-set to GL Compatibility for export reliability, per `project.godot`).
- Art/theme pass — level and player currently render as flat-colored rectangles via `_draw()`, no textures yet.
