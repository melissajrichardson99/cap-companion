# Card Flip Pairs

Godot 4.x project (GDScript only). Open `project.godot` in the Godot editor to test and export.

## Gameplay
- 4x4 grid, 16 cards / 8 pairs. Cards are placeholder color + letter (A-H) combos in `scripts/Main.gd` (`LABELS`/`COLORS`) — real animal art comes later.
- Tap a face-down card to flip it. With two face-up: match keeps both revealed and permanent; mismatch flips both back down after a short delay (`MismatchTimer`, 0.7s) during which input is blocked (`busy`) so a third card can't be flipped mid-check.
- Round ends when all 8 pairs are found. No move limit or timer.
- "Play Again" on the game-over screen calls `_start_game()` directly (no scene reload), which reshuffles and resets state cleanly.

## What to verify in the editor
- Shuffle (`_shuffle_values`, Fisher-Yates via `randi() % (i + 1)`) produces a fair, uniformly-distributed layout — spot-check that pairs land across different positions run to run, not stuck in fixed slots.
- Mismatch input-lock: rapid tapping during the 0.7s mismatch delay should not reveal a third card.
- Win triggers at exactly 8/8 pairs, and the exit button (top bar and game-over screen) always closes the round immediately regardless of game state.

## Not yet done (needs the GUI)
- Art/theme pass — cards currently render as color-tinted buttons with letter labels, no animal art yet.
