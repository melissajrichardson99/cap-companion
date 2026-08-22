extends Node2D

const VIEWPORT_WIDTH := 400.0
const VIEWPORT_HEIGHT := 600.0
const PLAY_TOP := 170.0
const PLAY_BOTTOM := 596.0

const TIME_LIMIT := 30.0
const TARGET_CATCHES := 8

const BUG_RADIUS := 20.0
const BUG_SPEED_MIN := 95.0
const BUG_SPEED_MAX := 155.0
const SPAWN_INTERVAL_MIN := 0.55
const SPAWN_INTERVAL_MAX := 0.95
const AMPLITUDE_MIN := 14.0
const AMPLITUDE_MAX := 42.0
const FREQ_MIN := 1.2
const FREQ_MAX := 2.6
const EDGE_ENTRY_SPREAD_DEG := 35.0
const TOP_ENTRY_SPREAD_DEG := 40.0
# Off-screen margin bugs must clear before they're pruned as "escaped" —
# generous enough that the sine-wave perpendicular offset never causes a
# bug still visually on-board to be culled early.
const OFF_SCREEN_MARGIN := 70.0

const FLASH_DURATION := 0.18

const READY_COUNTDOWN := ["Ready?", "3", "2", "1", "Go!"]
const READY_STEP_DURATION := 0.5

const BUG_BODY_COLOR := Color(0.62, 0.78, 0.22)
const BUG_HEAD_COLOR := Color(0.14, 0.14, 0.1)
const WING_COLOR := Color(0.85, 0.92, 0.75, 0.75)
const FLASH_COLOR := Color(1.0, 0.95, 0.4)
const BACKGROUND_COLOR := Color(0.11, 0.16, 0.1)

# --- Layout rects (design canvas is 400x600, see project.godot). Purely
# cosmetic - mirrors card_flip_pairs/mini_snake's SIGN_RECT-style layout
# consts. PLAY_TOP above is anchored to clear this SignBar+StatsBar+status
# chrome stack (0..PLAY_TOP), not just a single TopBar strip anymore.
const SIGN_RECT := Rect2(4, 4, 392, 56)
const STATS_RECT := Rect2(4, 68, 392, 54)
const TIME_PILL_RECT := Rect2(14, 78, 181, 34)
const CAUGHT_PILL_RECT := Rect2(205, 78, 181, 34)
const GAMEOVER_OUTER_RECT := Rect2(30, 195, 340, 250)
const GAMEOVER_INNER_RECT := Rect2(44, 209, 312, 222)

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

@onready var spawn_timer: Timer = $SpawnTimer
@onready var title_label: Label = $UI/SignBar/TitleLabel
@onready var time_label: Label = $UI/StatsBar/TimePill/ValueLabel
@onready var catch_label: Label = $UI/StatsBar/CaughtPill/ValueLabel
@onready var time_caption_label: Label = $UI/StatsBar/TimePill/CaptionLabel
@onready var catch_caption_label: Label = $UI/StatsBar/CaughtPill/CaptionLabel
@onready var status_label: Label = $UI/StatusLabel
@onready var game_over_layer: Control = $UI/GameOverLayer
@onready var result_label: Label = $UI/GameOverLayer/ResultLabel
@onready var score_result_label: Label = $UI/GameOverLayer/ScoreResultLabel
@onready var restart_button: Button = $UI/GameOverLayer/RestartButton
@onready var top_exit_button: Button = $UI/SignBar/ExitButton
@onready var gameover_exit_button: Button = $UI/GameOverLayer/ExitButton

# Each entry is a Dictionary: {spawn_pos, pos, vel, perp, amplitude, freq,
# elapsed, radius, caught, flash_timer, wing_phase}. Bugs are plain data
# drawn every frame via _draw(), same "data array + custom draw" convention
# as Obstacle Dodge/Mini Snake — no per-bug scene nodes.
var bugs: Array = []

var elapsed_time: float = 0.0
var catch_count: int = 0
var is_running: bool = false

var pointer_active: bool = false
var last_pointer_pos: Vector2 = Vector2.ZERO

# Bumped each round start/end so a stale ready-countdown await from an
# abandoned round can't start spawning on top of a new round. Same pattern
# used across every minigame in this repo (Mini Snake, Obstacle Dodge, ...).
var round_token: int = 0

func _ready() -> void:
	randomize()
	_style_ui()
	spawn_timer.timeout.connect(_on_spawn_timer_timeout)
	restart_button.pressed.connect(_start_game)
	top_exit_button.pressed.connect(_on_exit_pressed)
	gameover_exit_button.pressed.connect(_on_exit_pressed)
	_start_game()

func _start_game() -> void:
	round_token += 1
	var token := round_token
	is_running = false
	spawn_timer.stop()
	bugs.clear()
	elapsed_time = 0.0
	catch_count = 0
	pointer_active = false
	game_over_layer.visible = false
	_update_labels()
	queue_redraw()
	await _run_ready_countdown(token)
	if token != round_token:
		return
	is_running = true
	status_label.text = "Swipe!"
	_schedule_next_spawn()

func _run_ready_countdown(token: int) -> void:
	for step_text in READY_COUNTDOWN:
		status_label.text = step_text
		await get_tree().create_timer(READY_STEP_DURATION).timeout
		if token != round_token:
			return

func _schedule_next_spawn() -> void:
	spawn_timer.wait_time = randf_range(SPAWN_INTERVAL_MIN, SPAWN_INTERVAL_MAX)
	spawn_timer.start()

func _on_spawn_timer_timeout() -> void:
	if not is_running:
		return
	_spawn_bug()
	_schedule_next_spawn()

func _spawn_bug() -> void:
	var edge: int = randi() % 3  # 0 = left, 1 = right, 2 = top
	var speed: float = randf_range(BUG_SPEED_MIN, BUG_SPEED_MAX)
	var spawn_pos: Vector2
	var dir: Vector2
	match edge:
		0:
			spawn_pos = Vector2(-BUG_RADIUS - 10.0, randf_range(PLAY_TOP + 50.0, PLAY_BOTTOM - 50.0))
			dir = Vector2(1.0, 0.0).rotated(deg_to_rad(randf_range(-EDGE_ENTRY_SPREAD_DEG, EDGE_ENTRY_SPREAD_DEG)))
		1:
			spawn_pos = Vector2(VIEWPORT_WIDTH + BUG_RADIUS + 10.0, randf_range(PLAY_TOP + 50.0, PLAY_BOTTOM - 50.0))
			dir = Vector2(-1.0, 0.0).rotated(deg_to_rad(randf_range(-EDGE_ENTRY_SPREAD_DEG, EDGE_ENTRY_SPREAD_DEG)))
		_:
			spawn_pos = Vector2(randf_range(50.0, VIEWPORT_WIDTH - 50.0), PLAY_TOP - BUG_RADIUS - 10.0)
			dir = Vector2(0.0, 1.0).rotated(deg_to_rad(randf_range(-TOP_ENTRY_SPREAD_DEG, TOP_ENTRY_SPREAD_DEG)))

	var vel: Vector2 = dir.normalized() * speed
	var perp: Vector2 = vel.normalized().rotated(PI / 2.0)
	bugs.append({
		"spawn_pos": spawn_pos,
		"pos": spawn_pos,
		"vel": vel,
		"perp": perp,
		"amplitude": randf_range(AMPLITUDE_MIN, AMPLITUDE_MAX),
		"freq": randf_range(FREQ_MIN, FREQ_MAX),
		"elapsed": 0.0,
		"radius": BUG_RADIUS,
		"caught": false,
		"flash_timer": -1.0,
		"wing_phase": randf_range(0.0, TAU),
	})

func _process(delta: float) -> void:
	if not is_running:
		return
	elapsed_time += delta

	for i in range(bugs.size() - 1, -1, -1):
		var bug: Dictionary = bugs[i]
		if bug["caught"]:
			bug["flash_timer"] -= delta
			if bug["flash_timer"] <= 0.0:
				bugs.remove_at(i)
				continue
			bugs[i] = bug
			continue

		bug["elapsed"] += delta
		var base_pos: Vector2 = bug["spawn_pos"] + bug["vel"] * bug["elapsed"]
		bug["pos"] = base_pos + bug["perp"] * bug["amplitude"] * sin(bug["elapsed"] * bug["freq"])
		bugs[i] = bug

		var pos: Vector2 = bug["pos"]
		if pos.x < -OFF_SCREEN_MARGIN or pos.x > VIEWPORT_WIDTH + OFF_SCREEN_MARGIN \
				or pos.y < PLAY_TOP - OFF_SCREEN_MARGIN or pos.y > PLAY_BOTTOM + OFF_SCREEN_MARGIN:
			bugs.remove_at(i)

	_update_labels()
	queue_redraw()

	if elapsed_time >= TIME_LIMIT and catch_count < TARGET_CATCHES:
		_end_game(false)

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventScreenTouch:
		if event.pressed:
			pointer_active = true
			last_pointer_pos = event.position
		else:
			pointer_active = false
	elif event is InputEventScreenDrag:
		if pointer_active:
			_handle_pointer_move(event.position)
	elif event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		if event.pressed:
			pointer_active = true
			last_pointer_pos = event.position
		else:
			pointer_active = false
	elif event is InputEventMouseMotion:
		if pointer_active and (event.button_mask & MOUSE_BUTTON_MASK_LEFT) != 0:
			_handle_pointer_move(event.position)

func _handle_pointer_move(new_pos: Vector2) -> void:
	if not is_running:
		last_pointer_pos = new_pos
		return
	_check_swipe_catches(last_pointer_pos, new_pos)
	last_pointer_pos = new_pos

func _check_swipe_catches(from: Vector2, to: Vector2) -> void:
	for i in range(bugs.size()):
		var bug: Dictionary = bugs[i]
		if bug["caught"]:
			continue
		if _segment_intersects_circle(from, to, bug["pos"], bug["radius"]):
			bug["caught"] = true
			bug["flash_timer"] = FLASH_DURATION
			bugs[i] = bug
			catch_count += 1
	if catch_count >= TARGET_CATCHES:
		_end_game(true)

func _segment_intersects_circle(a: Vector2, b: Vector2, center: Vector2, radius: float) -> bool:
	var ab: Vector2 = b - a
	var len_sq: float = ab.length_squared()
	var t: float = 0.0
	if len_sq > 0.0001:
		t = clampf((center - a).dot(ab) / len_sq, 0.0, 1.0)
	var closest: Vector2 = a + ab * t
	return closest.distance_to(center) <= radius

func _end_game(won: bool) -> void:
	if not is_running:
		return
	is_running = false
	round_token += 1
	spawn_timer.stop()
	pointer_active = false
	if won:
		result_label.text = "Caught 'em All!"
	else:
		result_label.text = "Time's Up!"
	score_result_label.text = "Bugs caught: %d/%d" % [catch_count, TARGET_CATCHES]
	game_over_layer.visible = true
	# _end_game can be reached either from _process (which already queues a
	# redraw most frames) or directly from swipe input handling, which never
	# touches queue_redraw itself - force one here so the game-over wood
	# panel/parchment pill (painted in _draw, gated on game_over_layer.visible)
	# actually appears the moment the round ends either way.
	queue_redraw()
	_notify_host_complete()

func _on_exit_pressed() -> void:
	is_running = false
	round_token += 1
	spawn_timer.stop()
	pointer_active = false
	_notify_host_complete()

func _notify_host_complete() -> void:
	# Lets the React MinigameOverlay know the round is over (win, loss, or a
	# manual exit) so it can close the iframe. No-op outside a web export or
	# when there's no parent frame listening.
	if OS.has_feature("web"):
		JavaScriptBridge.eval("window.parent.postMessage({ type: 'minigame-complete', game: 'bug_net_swipe' }, '*');")

func _update_labels() -> void:
	time_label.text = "%d" % ceili(max(0.0, TIME_LIMIT - elapsed_time))
	catch_label.text = "%d / %d" % [catch_count, TARGET_CATCHES]

func _draw() -> void:
	_draw_page_bg()
	draw_rect(Rect2(Vector2(0, PLAY_TOP), Vector2(VIEWPORT_WIDTH, PLAY_BOTTOM - PLAY_TOP)), BACKGROUND_COLOR, true)
	for bug in bugs:
		_draw_bug(bug)
	_draw_sign_plank()
	_draw_stats_bar()
	if game_over_layer.visible:
		_draw_game_over_panel()

func _draw_page_bg() -> void:
	var vp := get_viewport_rect().size
	draw_rect(Rect2(Vector2.ZERO, vp), COLOR_PAGE_BG, true)

func _draw_sign_plank() -> void:
	_draw_wood_panel(SIGN_RECT, 12.0)

func _draw_stats_bar() -> void:
	_draw_parchment_pill(STATS_RECT, 16.0)
	_draw_parchment_pill(TIME_PILL_RECT, 10.0)
	_draw_parchment_pill(CAUGHT_PILL_RECT, 10.0)

func _draw_game_over_panel() -> void:
	_draw_wood_panel(GAMEOVER_OUTER_RECT, 18.0)
	_draw_parchment_pill(GAMEOVER_INNER_RECT, 14.0)

# --- Shared panel drawing helpers (verbatim from card_flip_pairs/Main.gd's
# convention, adjusted only in the rects passed to them). -------------------

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

	time_label.add_theme_color_override("font_color", COLOR_INK)
	catch_label.add_theme_color_override("font_color", COLOR_INK)
	time_caption_label.add_theme_color_override("font_color", COLOR_INK)
	catch_caption_label.add_theme_color_override("font_color", COLOR_INK)
	status_label.add_theme_color_override("font_color", Color(1, 1, 1))
	status_label.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.5))
	status_label.add_theme_constant_override("shadow_offset_x", 1)
	status_label.add_theme_constant_override("shadow_offset_y", 1)

	result_label.add_theme_color_override("font_color", COLOR_INK)
	score_result_label.add_theme_color_override("font_color", COLOR_INK)

func _style_round_button(btn: Button, bg: Color, border: Color, radius: int) -> void:
	var normal := StyleBoxFlat.new()
	normal.bg_color = bg
	normal.set_corner_radius_all(radius)
	normal.set_border_width_all(2)
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

func _draw_bug(bug: Dictionary) -> void:
	var pos: Vector2 = bug["pos"]
	var radius: float = bug["radius"]
	var scale_factor: float = 1.0
	var body_color: Color = BUG_BODY_COLOR

	if bug["caught"]:
		var t: float = clampf(bug["flash_timer"] / FLASH_DURATION, 0.0, 1.0)
		# t runs 1 -> 0 over the flash; pop bigger and fade toward the flash
		# color as the bug is removed, per the "brief flash/scale-pop" spec.
		scale_factor = 1.0 + (1.0 - t) * 0.7
		body_color = FLASH_COLOR.lerp(BUG_BODY_COLOR, t)

	var r: float = radius * scale_factor
	var vel: Vector2 = bug["vel"]
	var move_dir: Vector2 = vel.normalized() if vel.length() > 0.01 else Vector2.RIGHT
	var perp: Vector2 = move_dir.rotated(PI / 2.0)
	var wing_flap: float = sin(bug["elapsed"] * 14.0 + bug["wing_phase"]) * 0.3 + 0.7

	# Wings (drawn behind the body), a small diamond on each side.
	for side in [-1.0, 1.0]:
		var wing_center: Vector2 = pos + perp * side * (r * 0.55) - move_dir * (r * 0.15)
		var half_len: float = r * 0.6
		var half_wid: float = r * 0.32 * wing_flap
		var along: Vector2 = move_dir * half_len
		var across: Vector2 = perp * half_wid
		var wing_points := PackedVector2Array([
			wing_center - along,
			wing_center + across,
			wing_center + along,
			wing_center - across,
		])
		draw_colored_polygon(wing_points, WING_COLOR)

	# Body: an oval approximated by a scaled polygon ring, oriented along
	# the bug's direction of travel.
	var segments := 16
	var body_points := PackedVector2Array()
	for i in range(segments):
		var a: float = TAU * i / segments
		var local_pt := Vector2(cos(a) * r, sin(a) * r * 0.68)
		body_points.append(pos + local_pt.rotated(move_dir.angle()))
	draw_colored_polygon(body_points, body_color)

	# Head dot toward the direction of travel.
	draw_circle(pos + move_dir * r * 0.7, r * 0.28, BUG_HEAD_COLOR)
