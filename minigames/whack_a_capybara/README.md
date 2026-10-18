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

## Art
- Critters are textures: `assets/capybara_face.png` (226x222) and `assets/porcupine_face.png` (298x260). Holes, the dirt lip and the wood/parchment chrome are drawn with `_draw()`. The nine hole Buttons are transparent hit-boxes (100x100 each); the art is painted underneath them and never changes the hit area.
- `capybara_face.png` has its body cut off flat at the image's right and bottom edges. Shown as-is, that reads as a squared-off neck. The PNG is not edited: at load, `_crop_to_ellipse()` trims it to a rounded head-and-shoulders shape (`CAPY_CROP_*` constants) with a 3px outline along the cut to match the art. In each hole the capybara is fit to the cell with an 8px side margin, anchored bottom-centre, and a dirt lip (`_draw_hole_lip()`) is drawn in front so the lower body reads as still in the hole.
- `porcupine_face.png` has the same kind of flat cut on its left and bottom edges. It is drawn unchanged (centred, 90% of the cell) behind the same dirt lip.
- Critters appear and disappear instantly; there is no pop-up or whack animation.
