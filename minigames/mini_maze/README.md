# Mini Maze

Godot 4.x project (GDScript only). Open `project.godot` in the Godot editor to test and export.

## Gameplay
- 7x8 grid maze, one cell per step. Controls: on-screen D-pad buttons, or swipe/drag anywhere on the board (mouse drag also works when testing in the editor).
- Start at the top-left cell, finish (green) at the bottom-right cell.
- Timed: `ROUND_DURATION` (45s). Reaching the finish before time runs out is a **win**; hitting zero first is a **loss**. No endless/untimed mode.
- "Play Again" on the game-over screen calls `_start_game()` directly (no scene reload), so state resets cleanly.

## Maze data
- `MAZE_DATA` in `scripts/Main.gd` is a hardcoded 7x8 grid of open-direction bitmasks (N=1, E=2, S=4, W=8), generated with a recursive-backtracker maze generator and verified solvable via BFS before being committed — see `CLAUDE.md`'s pitfall about not shipping unverified generated content. A recursive backtracker always yields a spanning tree (exactly one path between any two cells), so the maze is guaranteed solvable and naturally includes dead-end branches.
- Movement is blocked per-cell against this bitmask (`_try_move`), not against a wall-tile grid, so there's no separate collision layer to keep in sync.

## What to verify in the editor
- Every direction press/swipe that isn't open on the current cell is a no-op (no wall clipping).
- Reaching the finish cell always ends the round as a win, even at the last tick before time runs out.
- Timer reaching exactly 0 ends the round as a loss.
- Round pacing — tune `ROUND_DURATION` if a typical playthrough runs much longer/shorter than the ~30s target (45s was chosen over the spec's default since a 19-step shortest path plus dead-end exploration needs more room than a 30s timer gives).

## Not yet done (needs the GUI)
- Web export (renderer is pre-set to GL Compatibility for export reliability, per `project.godot`).
- Art/theme pass — maze board/walls/player/finish currently render as flat shapes via `_draw()`, no textures yet.
