extends Node2D

const LANE_COUNT := 3
const VIEWPORT_WIDTH := 400.0
const LANE_WIDTH := VIEWPORT_WIDTH / LANE_COUNT
const PLAY_TOP := 162.0
const PLAY_BOTTOM := 500.0
const PLAYER_Y := 460.0
const PLAYER_SIZE := Vector2(70, 46)
const OBSTACLE_SIZE := Vector2(60, 46)
const OBSTACLE_SPEED := 260.0
const LANE_MOVE_SPEED := 900.0
const ROUND_DURATION := 28.0
const SWIPE_MIN_DISTANCE := 24.0
const TWO_LANE_SPAWN_CHANCE := 0.35
const READY_COUNTDOWN := ["Ready?", "3", "2", "1", "Go!"]
const READY_STEP_DURATION := 0.5

# --- Layout rects (design canvas is 400x600, see project.godot). Purely
# cosmetic - none of this feeds gameplay math, which stays anchored to
# PLAY_TOP/PLAY_BOTTOM/PLAYER_Y/LANE_WIDTH and only touches pixels at draw
# time. See mini_snake/scripts/Main.gd for the pattern this mirrors.
const SIGN_RECT := Rect2(4, 4, 392, 48)
const STATS_RECT := Rect2(4, 60, 392, 54)
const TIME_PILL_RECT := Rect2(14, 70, 181, 34)
const DODGED_PILL_RECT := Rect2(205, 70, 181, 34)
const FRAME_RECT := Rect2(2, 158, 396, 344)
const CONTROLS_RECT := Rect2(4, 506, 392, 90)

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

# --- Game-specific palette: dirt trail, rock obstacles, alpaca fur.
const COLOR_TRAIL_BG := Color("#7a5c3a")
const COLOR_TRAIL_BG_DARK := Color("#5f4429")
const COLOR_LANE_DIVIDER := Color("#e8d9bb")
const COLOR_ROCK_BASE := Color("#8d8577")
const COLOR_ROCK_DARK := Color("#655f54")
const COLOR_ROCK_HIGHLIGHT := Color("#b7b0a2")
const COLOR_ALPACA_FUR := Color("#f3e6c9")
const COLOR_ALPACA_FUR_SHADE := Color("#d8bd85")
const COLOR_ALPACA_FACE := Color("#9c6b3c")
const COLOR_ALPACA_LEG := Color("#6e4523")
const COLOR_ALPACA_EAR_INNER := Color("#bc6825")

const ALPACA_TEXTURE := preload("res://assets/alpaca.png")

@onready var spawn_timer: Timer = $SpawnTimer
@onready var title_label: Label = $UI/SignBar/TitleLabel
@onready var time_label: Label = $UI/StatsBar/TimePill/ValueLabel
@onready var dodged_label: Label = $UI/StatsBar/DodgedPill/ValueLabel
@onready var time_caption_label: Label = $UI/StatsBar/TimePill/CaptionLabel
@onready var dodged_caption_label: Label = $UI/StatsBar/DodgedPill/CaptionLabel
@onready var status_label: Label = $UI/StatusLabel
@onready var game_over_layer: Control = $UI/GameOverLayer
@onready var result_label: Label = $UI/GameOverLayer/ResultLabel
@onready var score_result_label: Label = $UI/GameOverLayer/ScoreResultLabel
@onready var restart_button: Button = $UI/GameOverLayer/RestartButton
@onready var top_exit_button: Button = $UI/SignBar/ExitButton
@onready var gameover_exit_button: Button = $UI/GameOverLayer/ExitButton
@onready var btn_left: Button = $UI/Controls/BtnLeft
@onready var btn_right: Button = $UI/Controls/BtnRight

# Each entry: {"lane": int, "y": float}. Data-driven and drawn via _draw(),
# same convention as the grid games — no per-obstacle scene nodes.
var obstacles: Array = []

var player_lane: int = 1
var player_x: float = 0.0
# Tracks which way the alpaca last actively moved so _draw_player can mirror
# the sprite to face its direction of travel. Only updated while player_x is
# still catching up to the target lane's x (see _physics_process) - holds its
# last value once movement completes so the sprite doesn't flip back to a
# "default" facing and look like idle jitter while stationary.
var facing_dir: int = 1
var elapsed_time: float = 0.0
var dodged_count: int = 0
var is_running: bool = false

var touch_start: Vector2 = Vector2.ZERO
var touch_active: bool = false

# Bumped each round start/end so a stale ready-countdown await from an
# abandoned round can't start spawning on top of a new one. Same pattern as
# Mini Snake / Mini Platformer.
var round_token: int = 0

func _ready() -> void:
	_style_ui()
	spawn_timer.timeout.connect(_spawn_wave)
	btn_left.pressed.connect(func(): _try_switch_lane(-1))
	btn_right.pressed.connect(func(): _try_switch_lane(1))
	restart_button.pressed.connect(_start_game)
	top_exit_button.pressed.connect(_on_exit_pressed)
	gameover_exit_button.pressed.connect(_on_exit_pressed)
	_start_game()

func _lane_x(lane: int) -> float:
	return (lane + 0.5) * LANE_WIDTH

func _start_game() -> void:
	round_token += 1
	var token := round_token
	is_running = false
	spawn_timer.stop()
	obstacles.clear()
	player_lane = 1
	player_x = _lane_x(player_lane)
	elapsed_time = 0.0
	dodged_count = 0
	game_over_layer.visible = false
	_update_labels()
	queue_redraw()
	await _run_ready_countdown(token)
	if token != round_token:
		return
	is_running = true
	status_label.text = "Dodge!"
	spawn_timer.start()

func _run_ready_countdown(token: int) -> void:
	for step_text in READY_COUNTDOWN:
		status_label.text = step_text
		await get_tree().create_timer(READY_STEP_DURATION).timeout
		if token != round_token:
			return

func _spawn_wave() -> void:
	if not is_running:
		return
	var lanes: Array = [0, 1, 2]
	lanes.shuffle()
	var count: int = 2 if randf() < TWO_LANE_SPAWN_CHANCE else 1
	for i in range(count):
		obstacles.append({"lane": lanes[i], "y": PLAY_TOP - OBSTACLE_SIZE.y})

func _physics_process(delta: float) -> void:
	if not is_running:
		return
	elapsed_time += delta
	var target_x: float = _lane_x(player_lane)
	if not is_equal_approx(player_x, target_x):
		facing_dir = 1 if target_x > player_x else -1
	player_x = move_toward(player_x, target_x, LANE_MOVE_SPEED * delta)

	var player_rect := Rect2(Vector2(player_x - PLAYER_SIZE.x / 2.0, PLAYER_Y - PLAYER_SIZE.y / 2.0), PLAYER_SIZE)
	for i in range(obstacles.size() - 1, -1, -1):
		var obstacle: Dictionary = obstacles[i]
		obstacle["y"] += OBSTACLE_SPEED * delta
		obstacles[i] = obstacle
		var obstacle_rect := Rect2(Vector2(_lane_x(obstacle["lane"]) - OBSTACLE_SIZE.x / 2.0, obstacle["y"] - OBSTACLE_SIZE.y / 2.0), OBSTACLE_SIZE)
		if player_rect.intersects(obstacle_rect):
			_end_game(false)
			return
		if obstacle["y"] - OBSTACLE_SIZE.y / 2.0 > PLAY_BOTTOM:
			obstacles.remove_at(i)
			dodged_count += 1

	_update_labels()
	queue_redraw()
	if elapsed_time >= ROUND_DURATION:
		_end_game(true)

func _try_switch_lane(delta_lane: int) -> void:
	if not is_running:
		return
	player_lane = clampi(player_lane + delta_lane, 0, LANE_COUNT - 1)

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventScreenTouch:
		if event.pressed:
			touch_start = event.position
			touch_active = true
		elif touch_active:
			_handle_swipe(event.position - touch_start)
			touch_active = false
	elif event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		if event.pressed:
			touch_start = event.position
			touch_active = true
		elif touch_active:
			_handle_swipe(event.position - touch_start)
			touch_active = false
	elif event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_LEFT:
			_try_switch_lane(-1)
		elif event.keycode == KEY_RIGHT:
			_try_switch_lane(1)

func _handle_swipe(delta: Vector2) -> void:
	if abs(delta.x) < SWIPE_MIN_DISTANCE:
		return
	_try_switch_lane(1 if delta.x > 0 else -1)

func _end_game(won: bool) -> void:
	if not is_running:
		return
	is_running = false
	round_token += 1
	spawn_timer.stop()
	if won:
		result_label.text = "You Survived!"
		score_result_label.text = "Dodged %d obstacles" % dodged_count
	else:
		result_label.text = "Game Over"
		score_result_label.text = "Dodged %d obstacles" % dodged_count
	game_over_layer.visible = true
	_notify_host_complete()

func _on_exit_pressed() -> void:
	is_running = false
	round_token += 1
	spawn_timer.stop()
	_notify_host_complete()

func _notify_host_complete() -> void:
	# Lets the React MinigameOverlay know the round is over (win, loss, or a
	# manual exit) so it can close the iframe. No-op outside a web export or
	# when there's no parent frame listening.
	if OS.has_feature("web"):
		JavaScriptBridge.eval("window.parent.postMessage({ type: 'minigame-complete', game: 'obstacle_dodge' }, '*');")

func _update_labels() -> void:
	time_label.text = "%d" % ceili(max(0.0, ROUND_DURATION - elapsed_time))
	dodged_label.text = "%d" % dodged_count

# ---------------------------------------------------------------------------
# Drawing. Main is a Node2D so everything here renders beneath the $UI
# CanvasLayer's real Label/Button nodes (CanvasLayer always composites above
# the base 2D canvas), the same layering the other redesigned games rely on.
# ---------------------------------------------------------------------------

func _draw() -> void:
	_draw_page_bg()
	_draw_sign_plank()
	_draw_stats_bar()
	_draw_trail()
	for obstacle in obstacles:
		_draw_rock(Vector2(_lane_x(obstacle["lane"]), obstacle["y"]))
	_draw_player()
	_draw_controls_plate()

func _draw_page_bg() -> void:
	var vp := get_viewport_rect().size
	draw_rect(Rect2(Vector2.ZERO, vp), COLOR_PAGE_BG, true)

func _draw_sign_plank() -> void:
	_draw_wood_panel(SIGN_RECT, 14.0)

func _draw_stats_bar() -> void:
	_draw_parchment_pill(STATS_RECT, 16.0)
	_draw_parchment_pill(TIME_PILL_RECT, 10.0)
	_draw_parchment_pill(DODGED_PILL_RECT, 10.0)
	_draw_hourglass_icon(TIME_PILL_RECT.position + Vector2(18, TIME_PILL_RECT.size.y * 0.5), 8.0)
	_draw_pawprint_icon(DODGED_PILL_RECT.position + Vector2(18, DODGED_PILL_RECT.size.y * 0.5), 8.0)

func _draw_hourglass_icon(center: Vector2, r: float) -> void:
	var top_tri := PackedVector2Array([center + Vector2(-r, -r), center + Vector2(r, -r), center + Vector2(0, 0)])
	var bottom_tri := PackedVector2Array([center + Vector2(-r, r), center + Vector2(r, r), center + Vector2(0, 0)])
	draw_colored_polygon(top_tri, COLOR_SUNSET_ORANGE)
	draw_colored_polygon(bottom_tri, COLOR_SUNSET_ORANGE_DEEP)
	draw_line(center + Vector2(-r, -r), center + Vector2(r, -r), COLOR_OUTLINE, 1.5)
	draw_line(center + Vector2(-r, r), center + Vector2(r, r), COLOR_OUTLINE, 1.5)

func _draw_pawprint_icon(center: Vector2, r: float) -> void:
	# Asymmetric hoofprint (not a radially-symmetric clover/flower shape):
	# one larger oval pad plus two smaller offset toe pads.
	draw_circle(center + Vector2(0, r * 0.4), r * 0.58, COLOR_ALPACA_LEG)
	draw_circle(center + Vector2(-r * 0.42, -r * 0.3), r * 0.26, COLOR_ALPACA_LEG)
	draw_circle(center + Vector2(r * 0.34, -r * 0.42), r * 0.24, COLOR_ALPACA_LEG)

func _draw_trail() -> void:
	_draw_wood_panel(FRAME_RECT, 16.0)
	# Fill matches PLAY_TOP/PLAY_BOTTOM/VIEWPORT_WIDTH exactly - this is the
	# same rect the original flat-color prototype drew, just recolored, so
	# it stays pixel-aligned with the gameplay bounds those constants define.
	var fill_rect := Rect2(Vector2(0, PLAY_TOP), Vector2(VIEWPORT_WIDTH, PLAY_BOTTOM - PLAY_TOP))
	draw_rect(fill_rect, COLOR_TRAIL_BG, true)
	for lane in range(LANE_COUNT):
		if lane % 2 == 1:
			var lane_rect := Rect2(Vector2(lane * LANE_WIDTH, PLAY_TOP), Vector2(LANE_WIDTH, PLAY_BOTTOM - PLAY_TOP))
			draw_rect(lane_rect, COLOR_TRAIL_BG_DARK, true)
	for lane in range(1, LANE_COUNT):
		var x: float = lane * LANE_WIDTH
		_draw_dashed_vline(x, PLAY_TOP, PLAY_BOTTOM, COLOR_LANE_DIVIDER)

func _draw_dashed_vline(x: float, y0: float, y1: float, color: Color) -> void:
	var dash := 14.0
	var gap := 10.0
	var y := y0
	while y < y1:
		var seg_end: float = min(y + dash, y1)
		draw_line(Vector2(x, y), Vector2(x, seg_end), color, 2.0)
		y += dash + gap

func _draw_rock(pos: Vector2) -> void:
	var box := Rect2(pos - OBSTACLE_SIZE / 2.0, OBSTACLE_SIZE)
	# Soft contact shadow grounds the rock on the trail without extending
	# the visible silhouette meaningfully past the actual collision box.
	draw_circle(Vector2(pos.x, box.position.y + box.size.y - 2.0), box.size.x * 0.3, Color(0, 0, 0, 0.18))
	draw_circle(pos + Vector2(-box.size.x * 0.18, box.size.y * 0.08), box.size.y * 0.46, COLOR_ROCK_DARK)
	draw_circle(pos + Vector2(box.size.x * 0.16, box.size.y * 0.02), box.size.y * 0.5, COLOR_ROCK_BASE)
	draw_circle(pos + Vector2(0, -box.size.y * 0.22), box.size.y * 0.3, COLOR_ROCK_HIGHLIGHT)
	draw_arc(pos, box.size.y * 0.5, 0, TAU, 24, COLOR_OUTLINE, 2.0)

func _draw_controls_plate() -> void:
	_draw_parchment_pill(CONTROLS_RECT, 16.0)

# ---------------------------------------------------------------------------
# Player - a procedural alpaca silhouette. The visible body sits inside the
# exact Rect2(pos - PLAYER_SIZE / 2, PLAYER_SIZE) box used for collision;
# neck/head/legs are purely decorative extensions above/below that box, the
# same trick the previous placeholder shape used for its ears.
# ---------------------------------------------------------------------------

func _draw_player() -> void:
	var pos := Vector2(player_x, PLAYER_Y)
	var box := Rect2(pos - PLAYER_SIZE / 2.0, PLAYER_SIZE)
	var body_center := box.position + box.size / 2.0

	# Contain-fit photo-style alpaca texture, sized/anchored to roughly match
	# the visual reach of the old procedural art: draw height a bit taller
	# than the collision box (to preserve the old long-neck overshoot above
	# and leg overshoot below), width follows from the source image's own
	# aspect ratio so it's never stretched. Feet anchored near the box
	# bottom, same as where the old legs ended. Same contain-fit pattern as
	# mini_maze's Main.gd _draw_emu/_draw_emu_glyph.
	var tex_size := ALPACA_TEXTURE.get_size()
	var h := box.size.y + 46.0
	var w := h * tex_size.x / tex_size.y
	var rect := Rect2(Vector2(body_center.x - w / 2.0, box.position.y + box.size.y - h), Vector2(w, h))
	# ALPACA_TEXTURE's native art faces LEFT (verified against a real render
	# of the raw PNG: front legs/chest sit left-of-center, the fluffy rump +
	# back legs trail off to the right) - so the unflipped draw already
	# matches leftward travel, and only rightward travel needs the mirror.
	if facing_dir > 0:
		# Mirror via a canvas transform around the sprite's own horizontal
		# center, not a negative-size Rect2 - verified against real
		# screenshots that neither a negative-width *destination* rect passed
		# to draw_texture_rect nor a negative-width *source* rect passed to
		# draw_texture_rect_region actually renders a flipped (or any) image
		# in this Web export; draw_set_transform with scale.x = -1 does.
		draw_set_transform(Vector2(body_center.x, 0.0), 0.0, Vector2(-1.0, 1.0))
		var local_rect := Rect2(Vector2(rect.position.x - body_center.x, rect.position.y), rect.size)
		draw_texture_rect(ALPACA_TEXTURE, local_rect, false)
		draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	else:
		draw_texture_rect(ALPACA_TEXTURE, rect, false)

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
	_style_round_button(btn_left, COLOR_HEADER_GREEN, COLOR_WOOD_LIGHT, 10)
	_style_round_button(btn_right, COLOR_HEADER_GREEN, COLOR_WOOD_LIGHT, 10)
	btn_left.add_theme_font_size_override("font_size", 24)
	btn_right.add_theme_font_size_override("font_size", 24)
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
	dodged_label.add_theme_color_override("font_color", COLOR_INK)
	time_caption_label.add_theme_color_override("font_color", COLOR_INK)
	dodged_caption_label.add_theme_color_override("font_color", COLOR_INK)
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
