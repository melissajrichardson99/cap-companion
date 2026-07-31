# Mini Snake

Godot 4.x project (GDScript only). Open `project.godot` in the Godot editor to test and export.

## Gameplay
- 10x10 grid, grid-based movement on a tick timer (`TICK_INTERVAL` in `scripts/Main.gd`, default 0.2s).
- Snake starts at length 3, centered on the board (`start_x/start_y = GRID_WIDTH/HEIGHT / 2`), giving 3-4 cells of margin to every wall. Each round opens with a short "Ready? 3 2 1 Go!" countdown (`READY_COUNTDOWN`/`READY_STEP_DURATION`) before the tick timer starts, so the player gets a moment to orient before the snake begins moving.
- Snake starts at length 3; round ends in a **win** at length 10 (`TARGET_LENGTH`), or a **loss** on wall/self collision. No endless mode.
- Controls: on-screen D-pad buttons, or swipe/drag anywhere on the board (mouse drag also works when testing in the editor).
- "Play Again" on the game-over screen calls `_start_game()` directly (no scene reload), so state resets cleanly.

## What to verify in the editor (per the tech spec's known pitfalls)
- Wall collision at all four edges.
- Self-collision, including the edge case where the snake moves into the cell its own tail is currently vacating (handled in `_hits_self` by excluding the tail unless growing that tick).
- Growth-on-eat and the win trigger at exactly length 10.
- Round pacing — at the default 0.2s tick, tune `TICK_INTERVAL` if a typical round runs much longer/shorter than ~30s.

## Not yet done (needs the GUI)
- Web export (renderer is pre-set to GL Compatibility for export reliability, per `project.godot`).
- Art/theme pass — snake/food/board currently render as flat-colored rectangles via `_draw()`, no textures yet.
