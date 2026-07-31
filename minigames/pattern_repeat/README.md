# Pattern Repeat

Godot 4.x project (GDScript only). Open `project.godot` in the Godot editor to test and export.

## Gameplay
- Simon-style memory game, farm animal theme: 4 buttons (COW/PIG/HEN/EWE), each with a distinct idle/lit color.
- Round 1 shows a `START_LENGTH` (2) step sequence; each successful round appends `GROWTH_PER_ROUND` (2) more random steps (`randi() % 4`, uniform per step) — so lengths go 2, 4, 6, 8, 10.
- Player taps the sequence back in order. Round ends immediately on the first wrong tap (loss), or on completing a round at `TARGET_LENGTH` (10) steps (win) — no endless mode.
- "Play Again" on the game-over screen calls `_start_game()` directly (no scene reload), so state resets cleanly.

## Pacing choice: why target length 10, not 8
The original version grew by 1 starting at length 1, up to a target of 8 (8 rounds total) — timed out, that's ~45s+ of playback/gap time alone before factoring in tap time, well over the ~30s-per-minigame target below, which is what "too slow/easy" was about: a gentle, grindy ramp.

Doubling the growth rate to +2 while keeping the old target of 8 would only take 4 rounds (2, 4, 6, 8) to win — a full playthrough in well under 15s, tripping the opposite failure mode this task explicitly warned against ("without being trivially short").

Target length 10 (5 rounds: 2, 4, 6, 8, 10) is the middle path: sequence-display + round-gap time alone comes to ~35s (close to the ~30s/minigame budget from `CAP_Companion_App_Plan.md`), it's a real step up in peak difficulty from the old length-8 ceiling, and 5 rounds is enough that a win still feels earned rather than instant. Revisit `TARGET_LENGTH`/`GROWTH_PER_ROUND` together if playtesting says otherwise.

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
