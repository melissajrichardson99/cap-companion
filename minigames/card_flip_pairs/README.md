# Card Flip Pairs

Godot 4.x project (GDScript only). Open `project.godot` in the Godot editor to test and export.

## Gameplay
- 4x4 grid, 16 cards / 8 pairs. Card backs show a procedurally-generated diagonal-stripe pattern (`_make_back_texture`); faces show a distinct procedurally-drawn shape+color icon per pair (`FACE_SHAPES`/`FACE_COLORS`, `_make_face_texture` in `scripts/Main.gd`) — real animal art comes later.
- Tap a face-down card to flip it. With two face-up: match keeps both revealed and permanent; mismatch flips both back down after a short delay (`MismatchTimer`, 0.7s) during which input is blocked (`busy`) so a third card can't be flipped mid-check.
- Round ends when all 8 pairs are found. No move limit or timer.
- "Play Again" on the game-over screen calls `_start_game()` directly (no scene reload), which reshuffles and resets state cleanly.

## Fixed bug: mismatches weren't flipping back
`_on_mismatch_timeout` used to re-render the two revealed cards *before* clearing `revealed`. `_render_card` treats any index still in `revealed` as face-up, so the re-render was a no-op and mismatched cards stayed revealed permanently — regardless of match/mismatch, all flips just accumulated. This was present in the initial commit (not a regression), so the original Playwright pass evidently didn't exercise a mismatch case. Fixed by clearing `revealed` before re-rendering the previously-revealed indices; confirmed visually via Playwright that mismatched cards now actually return to the back-pattern texture after the delay.

## Why shapes/colors instead of animal emoji
First pass set `Button.text` to literal animal emoji characters. Playwright screenshots of the actual Web export showed them rendering as missing-glyph boxes (e.g. a box reading "1F418") instead of pictures — Godot's default font (used by the Web export) has no emoji glyph coverage, and there's no OS font-fallback in an HTML5 export the way there is in the editor on desktop. Bundling an emoji-capable font as a new project asset felt like more than "no real art assets needed yet" was asking for, so faces are instead a distinct procedurally-drawn shape (circle/square/diamond/triangle-up/triangle-down/ring/cross/square-ring) in a distinct color per pair — same "no external asset" approach as the card-back pattern. Revisit if literal animal art (or a bundled emoji font) becomes worth the asset weight.

## What to verify in the editor
- Shuffle (`_shuffle_values`, Fisher-Yates via `randi() % (i + 1)`) produces a fair, uniformly-distributed layout — spot-check that pairs land across different positions run to run, not stuck in fixed slots.
- Mismatch input-lock: rapid tapping during the 0.7s mismatch delay should not reveal a third card, and both cards must actually flip back to the card-back pattern after the delay (not just stay revealed).
- Win triggers at exactly 8/8 pairs, and the exit button (top bar and game-over screen) always closes the round immediately regardless of game state.

## Not yet done (needs the GUI)
- Real art pass — card backs/faces are still procedural placeholders, no illustrated animal art yet.
