# Digital Ring Toss

Godot 4.x project (GDScript only). Open `project.godot` in the Godot editor to test and export.

## Gameplay
- Aim/power slingshot toss at 3 pegs stacked going up the screen from a fixed throw anchor near the bottom-center of the play area (`ANCHOR_POS = (200, 520)`).
- Controls: press/touch near the anchor and drag away from it — a pull-back line is drawn live from the anchor to the current drag point while held — then release to throw. `throw_vector = ANCHOR_POS - release_pos` (opposite the drag, slingshot-style), same "vector math encodes both power and angle" approach called for in the assignment: `power = clamp(throw_vector.length(), MIN_DRAG, MAX_DRAG)` remaps to a landing distance along the pull direction (`remap()`), and any left/right drift in the pull shows up directly as horizontal miss via `direction = throw_vector.normalized()`.
- Drags shorter than `SWIPE_MIN_DISTANCE` are ignored and don't consume a throw — same guard convention as Obstacle Dodge's `SWIPE_MIN_DISTANCE`/Mini Snake's swipe handling.
- Accuracy varies with angle, not just power: a small random scatter is added to `landing_pos` on release, scaled by `straightness = clampf(-direction.y, 0, 1)` (1.0 for a dead-straight-up pull, since Godot's up is -y). `scatter_magnitude = lerp(SCATTER_MAX, SCATTER_MIN, straightness)` — a straight pull gets tight scatter, an off-angle pull gets noticeably more.
- Pegs (data-driven `PEGS` array, drawn via `_draw()` as filled circles with their point value as a `draw_string()` label, not scene-tree nodes — same "data + custom draw" convention as every other minigame here):
  - Near: distance 150 from anchor, radius 34, value 2 (big/easy/cheap)
  - Mid: distance 230, radius 24, value 3
  - Far: distance 310, radius 16, value 5 (small/hard/rich)
  - Radii were chosen with a real gap between each peg's hit zone (no overlap along the vertical) so a straight-up throw at a given power lands unambiguously in one zone.
- Round = 4 throws (`THROWS_PER_ROUND`). After each valid throw, the ring animates from the anchor to `landing_pos` over `THROW_TRAVEL_DURATION` (a `create_tween().tween_method()`, awaited — this game has no continuous per-frame movement otherwise, so a Tween replaces the timer-based animation loops used elsewhere in this repo), then the landing point is checked against each peg's circle (highest-value peg wins on any overlap) and score/labels update. A short `RESULT_PAUSE_DURATION` lets the player see "Hit! +N" / "Miss" before the next throw is accepted (or the round ends).
- End of round: score >= `WIN_SCORE` (10) shows "Ring Master!"; otherwise "Round Over" — both show the final score. No mid-round loss condition, similar in spirit to Card Flip Pairs ending on completion rather than failure.
- Round opens with the same "Ready? 3 2 1 Go!" countdown as the other games, guarded by the `round_token` pattern (bumped on `_start_game()`/`_end_game()`/exit, captured locally at the start of the countdown and the throw-travel await, rechecked after every `await`) so an abandoned round can't corrupt a new one.
- "Play Again" on the result screen calls `_start_game()` directly (no scene reload).

## What to verify (per the tech spec / assignment)
- Power-to-distance mapping is real: a short/weak drag lands near the near peg's zone; a full-power straight-up drag lands near the far peg's zone.
- Accuracy-by-angle is real, not cosmetic: a drag angled well off vertical produces a visibly worse-scattered landing than a straight-up drag of similar length.
- After exactly 4 throws the round ends and shows a score; the win/round-over framing matches the `WIN_SCORE` threshold.
- The top-bar exit button and the post-round "Play Again"/"Exit" buttons all work, and all three paths (win, round-over, manual exit) fire the `minigame-complete` postMessage.
- Round pacing: this game is player-paced (unlike the auto-scroll/timer games), so total round time depends on how quickly the player aims and releases each throw; only the countdown (~2.5s) and the per-throw travel+result-pause (~0.95s x 4 ≈ 3.8s) are fixed overhead. Confirm that fixed overhead doesn't itself blow past the ~30s target, leaving room for actual aiming time.
- Confirmed via real Playwright mouse-driven runs against the exported Web build (not just an editor/code read-through) — see verification notes reported alongside this game's completion.

## Visuals
Parchment/wood-sign chrome matching the rest of the app (see `frontend/src/index.css`'s `--cap-*` tokens, mirrored as color constants at the top of `scripts/Main.gd`), same system as Mini Snake. Everything is drawn procedurally in `_draw()` (wood header plank with a ring glyph + leaf-vine flourish, parchment Throws/Score stat pills, a wood-framed grass field with corner rock clusters, wood-post pegs colored red/blue/yellow for the 2/3/5 values, and a wood-post throw anchor with a dashed idle guide arrow) plus `StyleBoxFlat` theme overrides in `_style_ui()` for the real Button/Label nodes - no bundled image/font assets. All in-canvas text is plain ASCII (peg values, "X" exit) since the Web-export font has no emoji/geometric-glyph coverage.

Note: `is_accepting_input` gates the idle guide-arrow drawn in `_draw()`, but Godot only re-runs `_draw()` after an explicit `queue_redraw()` - both `_start_game()` (after the ready countdown) and `_do_throw()` (after the result pause, when another throw remains) now call `queue_redraw()` right after flipping that flag to `true`, otherwise the canvas stays on its last-queued frame and the arrow silently never appears.

Web export is already produced under `export_web/` and copied into `frontend/public/games/digital_ring_toss/` per the standard pipeline (renderer pre-set to GL Compatibility for export reliability, per `project.godot`).
