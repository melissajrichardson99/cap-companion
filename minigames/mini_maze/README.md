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

## Art
- The player is a texture, `assets/emu.png` (634x830, a 12px transparent margin on every side). The same file is also used by Card Flip Pairs, so resize the emu here in code (`EMU_VISIBLE_HEIGHT` in `scripts/Main.gd`), never by editing the PNG.
- The emu is drawn centred in its cell at 21px of visible height (about 16px wide), so it fits inside the 29px clear corridor (34px cell minus the 5px wall line, `WALL_THICKNESS`) with space on every side. It is purely visual: movement and wall blocking come from `MAZE_DATA`, and start/finish are cell checks, so none of them depend on the sprite size.
- Board, walls, finish flag and the wood/parchment chrome are drawn with `_draw()`, no other textures.

## Export
- Web export uses the GL Compatibility renderer (set in `project.godot`). Export and copy steps are in `DEPLOYMENT.md` §2.4.
