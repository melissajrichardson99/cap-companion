# Pattern Repeat

Godot 4.x project (GDScript only). Open `project.godot` in the Godot editor to test and export.

## Gameplay
- Simon-style memory game, farm animal theme: 4 buttons (COW/PIG/HEN/EWE), each with a distinct idle/lit color.
- Round 1 shows a 1-step sequence; each successful round appends one more random step (`randi() % 4`, uniform per step).
- Player taps the sequence back in order. Round ends immediately on the first wrong tap (loss), or on completing a round at `TARGET_LENGTH` (8) steps (win) — no endless mode.
- "Play Again" on the game-over screen calls `_start_game()` directly (no scene reload), so state resets cleanly.

## Implementation notes
- Playback and round-gap pacing use `await get_tree().create_timer(...).timeout` rather than a dedicated `Timer` node.
- `round_token` guards those awaits: exiting or restarting mid-playback bumps the token, so a stale await wakes up, sees its token is outdated, and returns without touching state for the new round.

## What to verify in the editor
- Sequence playback highlights the correct buttons in the correct order at each length.
- A wrong tap always ends the round immediately, even mid-sequence.
- Exiting (top-bar X or game-over Exit) while a sequence is mid-playback doesn't throw and doesn't resume into a broken state.
- Round pacing — at the default timings, tune `SHOW_DURATION`/`GAP_DURATION`/`ROUND_GAP` if a typical playthrough runs much longer/shorter than the ~30s target.

## Not yet done (needs the GUI)
- Web export (renderer is pre-set to GL Compatibility for export reliability, per `project.godot`).
- Art/theme pass — animals currently render as flat-colored, text-labeled buttons, no textures/sounds yet.
