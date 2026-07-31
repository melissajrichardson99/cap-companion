# Whack-a-Capybara

Godot 4.x project (GDScript only). Open `project.godot` in the Godot editor to test and export.

## Gameplay
- 3x3 grid of holes. Capybaras pop up at random from empty holes on a randomized cooldown (`SPAWN_INTERVAL_MIN`/`MAX` in `scripts/Main.gd`) and stay up for a short, randomized window (`SHOW_DURATION_MIN`/`MAX`) before disappearing if untapped.
- Tap a hole while a capybara is up to score. `DECOY_CHANCE` (default 25%) of spawns are a decoy instead — tapping a decoy never scores, whether tapped or left alone.
- Round is a fixed 30-second timer (`ROUND_DURATION`), no endless mode.
- "Play Again" on the game-over screen calls `_start_game()` directly (no scene reload), so state resets cleanly.

## What to verify in the editor
- Capybara spawns are drawn from the pool of currently-empty holes only (never targets an occupied hole) using the same `randi() % array.size()` uniform-draw pattern as Mini Snake's food spawn — spot-check that spawns land across all 9 holes over a long session, not clustered.
- Decoys never award points, whether tapped or ignored.
- Round ends at exactly 0:00, and the exit button (top bar and game-over screen) always closes the round immediately regardless of timer state.

## Not yet done (needs the GUI)
- Art/theme pass — holes/capybara/decoy currently render as color-tinted buttons with text labels, no textures yet.
