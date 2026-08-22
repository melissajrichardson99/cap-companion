extends Node2D

const VIEWPORT_WIDTH := 400.0
const VIEWPORT_HEIGHT := 600.0

# --- Layout rects (design canvas is 400x600, see project.godot). Purely
# cosmetic - none of this feeds gameplay math, which stays entirely in
# ANCHOR_POS/PEGS pixel-space and never reads these constants.
const SIGN_RECT := Rect2(10, 10, 380, 56)
const STATS_RECT := Rect2(10, 74, 380, 54)
const THROWS_PILL_RECT := Rect2(20, 84, 175, 34)
const SCORE_PILL_RECT := Rect2(205, 84, 175, 34)
const FRAME_RECT := Rect2(10, 136, 380, 454)
const FIELD_RECT := Rect2(22, 148, 356, 430)

# --- Brand palette. Mirrors frontend/src/index.css's --cap-* tokens so this
# game's chrome reads as the same parchment/wood UI system as the rest of
# the app instead of a one-off style.
const COLOR_OUTLINE := Color("#14181a")
const COLOR_PARCHMENT := Color("#f0decc")
const COLOR_PAGE_BG := Color("#e8d9bb")
const COLOR_WOOD_LIGHT := Color("#a9773f")
const COLOR_WOOD_MID := Color("#8a5a2f")
const COLOR_WOOD_DARK := Color("#6e4523")
const COLOR_INK := Color("#1e2b2e")
const COLOR_HEADER_GREEN := Color("#144f05")
const COLOR_ADVENTURE_GREEN := Color("#3b7801")
const COLOR_SUNSET_ORANGE := Color("#f38630")
const COLOR_SUNSET_ORANGE_DEEP := Color("#bc6825")
const COLOR_GRASS_DARK := Color("#243a1c")
const COLOR_GRASS_LINE := Color("#324d27")
const COLOR_GRASS_BLADE := Color("#4c8a2e")
# Peg colors: near/mid/far match the mockup's red/blue/yellow, which also
# happens to line up with this game's real point values (2/3/5).
const COLOR_PEG_RED := Color("#c1443a")
const COLOR_PEG_BLUE := Color("#3f7fb8")
const COLOR_PEG_YELLOW := Color("#e8b23a")
const COLOR_ROCK_GRAY := Color("#8a8a7c")
const COLOR_ROCK_GRAY_DARK := Color("#5f5f56")

# Throw anchor near bottom-center of the play area. The player presses near
# this point, drags away (slingshot pull-back), and releases to throw.
const ANCHOR_POS := Vector2(200.0, 520.0)
# Generous "near the anchor" tolerance so a press doesn't have to land on the
# exact pixel to start a drag - matters for both touch and the Playwright
# mouse-driven verification harness.
const PRESS_ANCHOR_RADIUS := 100.0

const THROWS_PER_ROUND := 4
const WIN_SCORE := 10

# Drags shorter than this are ignored entirely (no throw consumed), same
# convention as Obstacle Dodge / Mini Snake's SWIPE_MIN_DISTANCE guard.
const SWIPE_MIN_DISTANCE := 18.0
# Power is the (clamped) drag length, remapped below to a landing distance.
# Kept small on purpose: the anchor sits close to the bottom of the 600-tall
# viewport (ANCHOR_POS.y = 520), so a real player's straight-down pull-back
# only has ~80px of clearance before running off the edge of the play area.
# MAX_DRAG=220 (the original suggested-shape value) is not physically
# reachable as a mostly-vertical pull at this anchor position/viewport size -
# found via Playwright verification, not from reading the code. Values below
# keep the full drag range comfortably inside that ~80px of headroom.
const MIN_DRAG := 18.0
const MAX_DRAG := 70.0

# Landing distance (from ANCHOR_POS, along the pull direction) that MIN_DRAG
# and MAX_DRAG power remap to. Chosen so a min-power throw lands in the near
# peg's zone and a max-power throw lands in the far peg's zone.
const MIN_LANDING := 150.0
const MAX_LANDING := 310.0

# Scatter added to landing_pos on release. A dead-straight-up pull (the
# accurate case) gets near-zero scatter; an off-angle pull gets a lot more -
# this is the "accuracy varies with angle" mechanic, not just power.
const SCATTER_MAX := 46.0
const SCATTER_MIN := 4.0

const THROW_TRAVEL_DURATION := 0.35
const RESULT_PAUSE_DURATION := 0.6

const READY_COUNTDOWN := ["Ready?", "3", "2", "1", "Go!"]
const READY_STEP_DURATION := 0.5

# Pegs stack going up the screen from the anchor. Distance/radius/value trade
# off against each other: near = big & easy & cheap, far = small & hard & rich.
const PEGS := [
	{"distance": 150.0, "radius": 34.0, "value": 2, "color": COLOR_PEG_RED},
	{"distance": 230.0, "radius": 24.0, "value": 3, "color": COLOR_PEG_BLUE},
	{"distance": 310.0, "radius": 16.0, "value": 5, "color": COLOR_PEG_YELLOW},
]

@onready var title_label: Label = $UI/SignBar/TitleLabel
@onready var throws_caption_label: Label = $UI/StatsBar/ThrowsPill/CaptionLabel
@onready var throws_value_label: Label = $UI/StatsBar/ThrowsPill/ValueLabel
@onready var score_caption_label: Label = $UI/StatsBar/ScorePill/CaptionLabel
@onready var score_value_label: Label = $UI/StatsBar/ScorePill/ValueLabel
@onready var status_label: Label = $UI/StatusLabel
@onready var game_over_layer: Control = $UI/GameOverLayer
@onready var result_label: Label = $UI/GameOverLayer/ResultLabel
@onready var score_result_label: Label = $UI/GameOverLayer/ScoreResultLabel
@onready var restart_button: Button = $UI/GameOverLayer/RestartButton
@onready var top_exit_button: Button = $UI/SignBar/ExitButton
@onready var gameover_exit_button: Button = $UI/GameOverLayer/ExitButton

var throws_remaining: int = THROWS_PER_ROUND
var score: int = 0

# True only while waiting for the player's next drag+release; false during
# the countdown, the throw-travel animation, the result pause, and after the
# round ends.
var is_accepting_input: bool = false

var drag_active: bool = false
var drag_current: Vector2 = ANCHOR_POS

var ring_visible: bool = false
var ring_pos: Vector2 = ANCHOR_POS

# Bumped each _start_game()/_end_game()/exit so a stale await (countdown or
# throw-travel tween) from an abandoned round can't corrupt a new one. Same
# pattern as every other minigame in this repo.
var round_token: int = 0

func _ready() -> void:
	randomize()
	_style_ui()
	restart_button.pressed.connect(_start_game)
	top_exit_button.pressed.connect(_on_exit_pressed)
	gameover_exit_button.pressed.connect(_on_exit_pressed)
	_start_game()

func _start_game() -> void:
	round_token += 1
	var token := round_token
	throws_remaining = THROWS_PER_ROUND
	score = 0
	is_accepting_input = false
	drag_active = false
	ring_visible = false
	game_over_layer.visible = false
	_update_labels()
	queue_redraw()
	await _run_ready_countdown(token)
	if token != round_token:
		return
	is_accepting_input = true
	status_label.text = "Pull back & release!"
	# _draw() gates the idle guide-arrow on is_accepting_input; without this
	# the canvas stays on its last-queued frame (drawn before the countdown
	# finished) and the arrow never appears until some other input redraws it.
	queue_redraw()

func _run_ready_countdown(token: int) -> void:
	for step_text in READY_COUNTDOWN:
		status_label.text = step_text
		await get_tree().create_timer(READY_STEP_DURATION).timeout
		if token != round_token:
			return

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventScreenTouch:
		if event.pressed:
			_try_start_drag(event.position)
		elif drag_active:
			_end_drag(event.position)
	elif event is InputEventScreenDrag:
		if drag_active:
			drag_current = event.position
			queue_redraw()
	elif event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		if event.pressed:
			_try_start_drag(event.position)
		elif drag_active:
			_end_drag(event.position)
	elif event is InputEventMouseMotion:
		if drag_active:
			drag_current = event.position
			queue_redraw()

func _try_start_drag(pos: Vector2) -> void:
	if not is_accepting_input:
		return
	if pos.distance_to(ANCHOR_POS) > PRESS_ANCHOR_RADIUS:
		return
	drag_active = true
	drag_current = pos
	queue_redraw()

func _end_drag(pos: Vector2) -> void:
	drag_active = false
	queue_redraw()
	_attempt_throw(pos)

func _attempt_throw(release_pos: Vector2) -> void:
	if not is_accepting_input or throws_remaining <= 0:
		return
	# Slingshot-style: the throw goes opposite the drag.
	var throw_vector: Vector2 = ANCHOR_POS - release_pos
	if throw_vector.length() < SWIPE_MIN_DISTANCE:
		return
	_do_throw(throw_vector)

func _do_throw(throw_vector: Vector2) -> void:
	is_accepting_input = false
	var power: float = clamp(throw_vector.length(), MIN_DRAG, MAX_DRAG)
	var direction: Vector2 = throw_vector.normalized()
	var landing_distance: float = remap(power, MIN_DRAG, MAX_DRAG, MIN_LANDING, MAX_LANDING)
	var landing_pos: Vector2 = ANCHOR_POS + direction * landing_distance

	# straightness = 1.0 for a dead-straight-up pull (direction.y == -1 in
	# Godot's -y-is-up coordinate space), down to 0.0 for a level/sideways
	# pull. Scatter shrinks as straightness rises.
	var straightness: float = clampf(-direction.y, 0.0, 1.0)
	var scatter_magnitude: float = lerpf(SCATTER_MAX, SCATTER_MIN, straightness)
	landing_pos += Vector2(
		randf_range(-scatter_magnitude, scatter_magnitude),
		randf_range(-scatter_magnitude, scatter_magnitude)
	)

	throws_remaining -= 1
	status_label.text = "Throwing..."
	_update_labels()

	var token := round_token
	ring_visible = true
	ring_pos = ANCHOR_POS
	queue_redraw()
	await _animate_ring(landing_pos)
	if token != round_token:
		return

	_resolve_throw(landing_pos)
	if token != round_token:
		return

	await get_tree().create_timer(RESULT_PAUSE_DURATION).timeout
	if token != round_token:
		return

	ring_visible = false
	queue_redraw()
	if throws_remaining <= 0:
		_end_game()
	else:
		is_accepting_input = true
		status_label.text = "Pull back & release!"
		queue_redraw()

func _animate_ring(target: Vector2) -> void:
	var tween := create_tween()
	tween.tween_method(_set_ring_pos, ANCHOR_POS, target, THROW_TRAVEL_DURATION)
	await tween.finished

func _set_ring_pos(p: Vector2) -> void:
	ring_pos = p
	queue_redraw()

func _resolve_throw(landing_pos: Vector2) -> void:
	var hit_value := 0
	for peg in PEGS:
		var peg_pos: Vector2 = ANCHOR_POS + Vector2(0.0, -1.0) * peg["distance"]
		if landing_pos.distance_to(peg_pos) <= peg["radius"]:
			hit_value = max(hit_value, int(peg["value"]))
	if hit_value > 0:
		score += hit_value
		status_label.text = "Hit! +%d" % hit_value
	else:
		status_label.text = "Miss"
	_update_labels()
	queue_redraw()

func _end_game() -> void:
	is_accepting_input = false
	round_token += 1
	var won: bool = score >= WIN_SCORE
	result_label.text = "Ring Master!" if won else "Round Over"
	score_result_label.text = "Score: %d" % score
	game_over_layer.visible = true
	_notify_host_complete()

func _on_exit_pressed() -> void:
	is_accepting_input = false
	drag_active = false
	round_token += 1
	_notify_host_complete()

func _notify_host_complete() -> void:
	# Lets the React MinigameOverlay know the round is over (win, round-over,
	# or a manual exit) so it can close the iframe. No-op outside a web export
	# or when there's no parent frame listening.
	if OS.has_feature("web"):
		JavaScriptBridge.eval("window.parent.postMessage({ type: 'minigame-complete', game: 'digital_ring_toss' }, '*');")

func _update_labels() -> void:
	throws_value_label.text = str(throws_remaining)
	score_value_label.text = str(score)

func _draw() -> void:
	_draw_page_bg()
	_draw_sign_plank()
	_draw_stat_pills()
	_draw_field_frame()
	_draw_field()
	_draw_pegs()
	_draw_anchor_and_guide()
	_draw_drag_line()
	_draw_ring_in_flight()

func _draw_page_bg() -> void:
	var vp := get_viewport_rect().size
	draw_rect(Rect2(Vector2.ZERO, vp), COLOR_PAGE_BG, true)

func _draw_sign_plank() -> void:
	_draw_wood_panel(SIGN_RECT, 14.0)

func _draw_ring_icon(center: Vector2, r: float, ring_color: Color, hole_color: Color) -> void:
	draw_circle(center, r, ring_color)
	draw_circle(center, r * 0.5, hole_color)
	draw_circle(center, r, Color(0, 0, 0, 0.3), false, 1.5, true)

func _draw_star_icon(center: Vector2, r: float) -> void:
	var points := PackedVector2Array()
	for i in range(10):
		var ang := -PI / 2 + i * PI / 5
		var rad := r if i % 2 == 0 else r * 0.45
		points.append(center + Vector2(cos(ang), sin(ang)) * rad)
	draw_colored_polygon(points, Color("#f2b705"))

func _draw_stat_pills() -> void:
	_draw_parchment_pill(STATS_RECT, 16.0)
	_draw_parchment_pill(THROWS_PILL_RECT)
	_draw_parchment_pill(SCORE_PILL_RECT)
	_draw_ring_icon(THROWS_PILL_RECT.position + Vector2(20, THROWS_PILL_RECT.size.y * 0.5), 9.0, COLOR_SUNSET_ORANGE, COLOR_PARCHMENT)
	_draw_star_icon(SCORE_PILL_RECT.position + Vector2(20, SCORE_PILL_RECT.size.y * 0.5), 9.0)

func _draw_field_frame() -> void:
	_draw_wood_panel(FRAME_RECT, 18.0)

func _draw_field() -> void:
	draw_rect(FIELD_RECT, COLOR_GRASS_DARK, true)
	var lx := FIELD_RECT.position.x
	var rx := FIELD_RECT.position.x + FIELD_RECT.size.x
	for i in range(1, 6):
		var ly := FIELD_RECT.position.y + FIELD_RECT.size.y * (float(i) / 6.0)
		draw_line(Vector2(lx, ly), Vector2(rx, ly), COLOR_GRASS_LINE, 1.0)
	# Decorative rock clusters, one in each corner of the field - ground
	# texture only, no gameplay meaning. Kept clear of the peg column
	# (centered at FIELD_RECT's horizontal midpoint) and the anchor.
	var inset := 30.0
	_draw_rock_cluster(FIELD_RECT.position + Vector2(inset, inset))
	_draw_rock_cluster(Vector2(FIELD_RECT.position.x + FIELD_RECT.size.x - inset, FIELD_RECT.position.y + inset))
	_draw_rock_cluster(Vector2(FIELD_RECT.position.x + inset, FIELD_RECT.position.y + FIELD_RECT.size.y - inset))
	_draw_rock_cluster(FIELD_RECT.position + FIELD_RECT.size - Vector2(inset, inset))

func _draw_rock_cluster(center: Vector2) -> void:
	draw_circle(center + Vector2(-7, 3), 10.0, COLOR_ROCK_GRAY_DARK)
	draw_circle(center + Vector2(6, 4), 8.0, COLOR_ROCK_GRAY_DARK)
	draw_circle(center + Vector2(-6, -2), 9.0, COLOR_ROCK_GRAY)
	draw_circle(center + Vector2(7, -1), 7.0, COLOR_ROCK_GRAY)
	draw_circle(center, 6.0, COLOR_ROCK_GRAY)

func _draw_pegs() -> void:
	var font := ThemeDB.fallback_font
	var font_size := ThemeDB.fallback_font_size
	for peg in PEGS:
		var peg_pos: Vector2 = ANCHOR_POS + Vector2(0.0, -1.0) * float(peg["distance"])
		var radius: float = peg["radius"]
		_draw_peg_post(peg_pos, radius)
		draw_circle(peg_pos, radius, peg["color"])
		draw_circle(peg_pos, radius, COLOR_OUTLINE, false, 2.0, true)
		draw_circle(peg_pos + Vector2(-radius * 0.3, -radius * 0.35), radius * 0.35, Color(1, 1, 1, 0.25))
		var text: String = str(int(peg["value"]))
		var text_size: Vector2 = font.get_string_size(text, HORIZONTAL_ALIGNMENT_CENTER, -1, font_size)
		draw_string(font, peg_pos + Vector2(-text_size.x / 2.0, text_size.y * 0.35), text, HORIZONTAL_ALIGNMENT_CENTER, -1, font_size, Color(1, 1, 1))

func _draw_peg_post(peg_pos: Vector2, radius: float) -> void:
	# Short wood post grounding the peg, from the bottom of its circle down
	# a fixed stub - purely decorative, doesn't affect peg_pos/radius used by
	# _resolve_throw's hit test.
	var post_top := peg_pos.y + radius * 0.4
	var post_rect := Rect2(peg_pos.x - 4.0, post_top, 8.0, 16.0)
	draw_rect(post_rect.grow(1.0), COLOR_OUTLINE, true)
	draw_rect(post_rect, COLOR_WOOD_DARK, true)

func _draw_anchor_and_guide() -> void:
	# Wood post grounding the throw anchor, same visual language as the peg
	# posts below the anchor marker.
	var post_rect := Rect2(ANCHOR_POS.x - 5.0, ANCHOR_POS.y + 6.0, 10.0, 20.0)
	draw_rect(post_rect.grow(1.0), COLOR_OUTLINE, true)
	draw_rect(post_rect, COLOR_WOOD_DARK, true)
	draw_circle(ANCHOR_POS, 9.0, COLOR_SUNSET_ORANGE)
	draw_circle(ANCHOR_POS, 9.0, COLOR_OUTLINE, false, 2.0, true)

	# Dashed guide arrow pointing up from the anchor, shown only while idle
	# (waiting for the next drag) so it reads as a throw hint, not clutter
	# during the drag/travel/result states.
	if is_accepting_input and not drag_active:
		var guide_start := ANCHOR_POS + Vector2(0, -16)
		var guide_end := ANCHOR_POS + Vector2(0, -96)
		draw_dashed_line(guide_start, guide_end, Color(1, 1, 1, 0.55), 2.0, 6.0)
		var tip := PackedVector2Array([
			guide_end + Vector2(0, -10),
			guide_end + Vector2(-7, 6),
			guide_end + Vector2(7, 6),
		])
		draw_colored_polygon(tip, Color(1, 1, 1, 0.65))

func _draw_drag_line() -> void:
	# Slingshot pull-back visual: a line from the anchor to the current drag
	# point, drawn while the drag is held.
	if drag_active:
		draw_line(ANCHOR_POS, drag_current, Color(0.95, 0.95, 0.95), 3.0)
		draw_circle(drag_current, 6.0, Color(0.95, 0.95, 0.95))
		draw_circle(drag_current, 6.0, COLOR_OUTLINE, false, 1.5, true)

func _draw_ring_in_flight() -> void:
	if ring_visible:
		draw_circle(ring_pos, 14.0, COLOR_SUNSET_ORANGE, false, 4.0, true)
		draw_circle(ring_pos, 14.0, Color(1, 1, 1, 0.35), false, 1.5, true)

# --- Shared panel drawing helpers -------------------------------------------

func _draw_wood_panel(rect: Rect2, radius: float) -> void:
	var sb := StyleBoxFlat.new()
	sb.bg_color = COLOR_WOOD_MID
	sb.set_corner_radius_all(int(radius))
	sb.border_width_top = 3
	sb.border_width_bottom = 3
	sb.border_width_left = 3
	sb.border_width_right = 3
	sb.border_color = COLOR_OUTLINE
	# Hard "pop" shadow (no blur), matching --cap-shadow-pop's flat offset.
	var shadow_sb := StyleBoxFlat.new()
	shadow_sb.bg_color = COLOR_OUTLINE
	shadow_sb.set_corner_radius_all(int(radius))
	draw_style_box(shadow_sb, Rect2(rect.position + Vector2(3, 3), rect.size))
	draw_style_box(sb, rect)
	# Faint top highlight band to fake the light-to-dark wood gradient
	# without needing a texture resource.
	var highlight := Rect2(rect.position + Vector2(4, 4), Vector2(rect.size.x - 8, rect.size.y * 0.4))
	var hl_sb := StyleBoxFlat.new()
	hl_sb.bg_color = Color(COLOR_WOOD_LIGHT.r, COLOR_WOOD_LIGHT.g, COLOR_WOOD_LIGHT.b, 0.5)
	hl_sb.corner_radius_top_left = int(radius) - 2
	hl_sb.corner_radius_top_right = int(radius) - 2
	draw_style_box(hl_sb, highlight)

func _draw_parchment_pill(rect: Rect2, radius: float = 12.0) -> void:
	var shadow_sb := StyleBoxFlat.new()
	shadow_sb.bg_color = COLOR_OUTLINE
	shadow_sb.set_corner_radius_all(int(radius))
	draw_style_box(shadow_sb, Rect2(rect.position + Vector2(2, 2), rect.size))
	var sb := StyleBoxFlat.new()
	sb.bg_color = COLOR_PARCHMENT
	sb.set_corner_radius_all(int(radius))
	sb.border_width_top = 2
	sb.border_width_bottom = 2
	sb.border_width_left = 2
	sb.border_width_right = 2
	sb.border_color = COLOR_OUTLINE
	draw_style_box(sb, rect)

# ---------------------------------------------------------------------------
# UI node styling - applied once in _ready() to real Control/Button nodes
# (which need to stay real nodes for input + text layout) rather than
# folded into _draw().
# ---------------------------------------------------------------------------

func _style_ui() -> void:
	_style_round_button(top_exit_button, COLOR_SUNSET_ORANGE, COLOR_SUNSET_ORANGE_DEEP, 10)
	_style_round_button(restart_button, COLOR_HEADER_GREEN, COLOR_OUTLINE, 10)
	_style_round_button(gameover_exit_button, COLOR_PARCHMENT, COLOR_OUTLINE, 10)
	gameover_exit_button.add_theme_color_override("font_color", COLOR_INK)
	gameover_exit_button.add_theme_color_override("font_hover_color", COLOR_INK)
	gameover_exit_button.add_theme_color_override("font_pressed_color", COLOR_INK)

	title_label.add_theme_color_override("font_color", Color(1, 1, 1))
	title_label.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.5))
	title_label.add_theme_constant_override("shadow_offset_x", 1)
	title_label.add_theme_constant_override("shadow_offset_y", 1)

	throws_caption_label.add_theme_color_override("font_color", COLOR_INK)
	throws_value_label.add_theme_color_override("font_color", COLOR_INK)
	score_caption_label.add_theme_color_override("font_color", COLOR_INK)
	score_value_label.add_theme_color_override("font_color", COLOR_INK)

	status_label.add_theme_color_override("font_color", Color(1, 1, 1))
	status_label.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.6))
	status_label.add_theme_constant_override("shadow_offset_x", 2)
	status_label.add_theme_constant_override("shadow_offset_y", 2)

	result_label.add_theme_color_override("font_color", COLOR_INK)
	score_result_label.add_theme_color_override("font_color", COLOR_INK)

func _style_round_button(btn: Button, bg: Color, border: Color, radius: int) -> void:
	var normal := StyleBoxFlat.new()
	normal.bg_color = bg
	normal.set_corner_radius_all(radius)
	normal.set_border_width_all(3)
	normal.border_color = border
	var hover := normal.duplicate()
	hover.bg_color = bg.lightened(0.1)
	var pressed := normal.duplicate()
	pressed.bg_color = bg.darkened(0.15)
	btn.add_theme_stylebox_override("normal", normal)
	btn.add_theme_stylebox_override("hover", hover)
	btn.add_theme_stylebox_override("pressed", pressed)
	btn.add_theme_stylebox_override("focus", normal)
	btn.add_theme_color_override("font_color", Color(1, 1, 1))
	btn.add_theme_color_override("font_hover_color", Color(1, 1, 1))
	btn.add_theme_color_override("font_pressed_color", Color(1, 1, 1))
