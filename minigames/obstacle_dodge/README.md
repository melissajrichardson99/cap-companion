# Obstacle Dodge

Godot 4.x project (GDScript only). Open `project.godot` in the Godot editor to test and export.

## Gameplay
- Alpaca-themed 3-lane auto-scroll dodge. Obstacles spawn at the top of a random lane (occasionally two lanes at once, never all three, so a safe lane always exists) and scroll down at a constant speed; the player slides between lanes to avoid them.
- Controls: on-screen ◀/▶ buttons, swipe left/right anywhere on the board, or arrow keys in the editor. Lane switching is a smooth slide (`move_toward` on a continuous `player_x`, not an instant teleport) toward the target lane's center.
- Collision is continuous-position `Rect2.intersects()` overlap between the player's rect and each obstacle's rect, checked every physics frame — genuinely different from Phase 1's grid/tile-index collision (Mini Snake's cell-equality checks, Mini Maze's wall-bitmask checks), since obstacles and the player both move in continuous float coordinates rather than snapping to a grid.
- Obstacles and the player are plain data (`obstacles: Array` of `{lane, y}` dicts) drawn every frame via `_draw()`, not scene-tree physics nodes — same "data array + custom draw" convention as Mini Snake/Mini Maze, just with continuous `y` instead of grid cells.
- Win: survive the full `ROUND_DURATION` (28s + countdown, ~30s total). Lose: any obstacle overlaps the player. No true endless mode, per the tech spec's per-round design.
- Round opens with the same "Ready? 3 2 1 Go!" countdown as the other games, guarded by the `round_token` pattern so an abandoned countdown can't start spawning on top of a new round.
- "Play Again" on the game-over screen calls `_start_game()` directly (no scene reload).

## What to verify in the editor (per the tech spec's known pitfalls)
- An obstacle in the player's current lane is always avoidable — confirm the two-lane spawn (`TWO_LANE_SPAWN_CHANCE`) never blocks all three lanes at once, and that spawn-to-player travel time (obstacle spawns at `PLAY_TOP`, player sits at `PLAYER_Y`, speed `OBSTACLE_SPEED`) leaves enough reaction time after a lane switch.
- Collision actually fires exactly once per obstacle overlap (no double-trigger, no obstacles that visually overlap the player but don't end the round, and no obstacles that phase through without ever intersecting due to a large per-frame `y` step at low frame rates).
- Dodged obstacles are correctly pruned from `obstacles` once they pass `PLAY_BOTTOM` (no unbounded array growth over a 28s round).
- Round pacing — confirm a typical round (a player who dodges reasonably) actually runs close to the ~30s target, not just the nominal `ROUND_DURATION` constant.

## Not yet done (needs the GUI)
- Web export (renderer is pre-set to GL Compatibility for export reliability, per `project.godot`).
- Art/theme pass — lanes, obstacles, and the player currently render as flat-colored rectangles via `_draw()`, no textures yet.
