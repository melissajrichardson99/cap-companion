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
- `capybara_face.png` has its body cut off flat at the image's right and bottom edges. Shown as-is, that reads as a squared-off neck. The PNG is not edited: at load, `_crop_to_ellipse()` trims it to a rounded head-and-shoulders shape (`CAPY_CROP_*` constants) with a 3px outline along the cut to match the art.
- `porcupine_face.png` has the same kind of flat cut along its left edge and its whole bottom edge. It gets the same load-time trim (`PORC_CROP_*`), which also drops a paw fragment that would otherwise poke out past the rim.
- The dark hole is a circle, 64px across (64% of the cell), centred at cell y=62. In each hole the critter is contain-fit into a 64px square (`CRITTER_MAX_SIDE`), centred on the hole, so it never reaches the cell's rounded border (18px clear each side). Its bottom edge sits inside the front rim (`_draw_front_rim()`): a crescent hugging the lower half of the hole, `RIM_THICKNESS` (7px) at the bottom and tapering to nothing at the sides, filled with the mound colour so it reads as the hole's own edge. `CRITTER_LIFT` raises the critter 3px so the porcupine's chin stays visible.
- Critters appear and disappear instantly; there is no pop-up or whack animation.
