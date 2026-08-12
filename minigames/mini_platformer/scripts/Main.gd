extends Node2D

const GRAVITY := 900.0
const JUMP_VELOCITY := -420.0
const RUN_SPEED := 90.0
const GROUND_Y := 460.0
const LEVEL_WIDTH := 2700.0
const PLAYER_SIZE := Vector2(28, 36)
const FALL_LIMIT_Y := 700.0
const READY_COUNTDOWN := ["Ready?", "3", "2", "1", "Go!"]
const READY_STEP_DURATION := 0.5

# [x, width, y_top] — ground segments, separated by 40px gaps a full jump arc
# clears with margin (see README for the physics math). Segment C is raised
# 70px above the others; the jump's peak height (~98px) clears it.
const PLATFORMS := [
	[0.0, 480.0, 460.0],
	[520.0, 260.0, 460.0],
	[820.0, 200.0, 390.0],
	[1060.0, 900.0, 460.0],
	[2000.0, 700.0, 460.0],
]
const PLATFORM_THICKNESS := 24.0

const HAZARD_XS := [650.0, 1500.0]
const HAZARD_SIZE := Vector2(30, 30)

const GOAL_X := 2650.0
const GOAL_POLE_HEIGHT := 100.0

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

# --- Game-specific palette: outdoor park-trail scene + kangaroo fur tones.
const COLOR_SKY := Color("#8fd3f4")
const COLOR_HILL_FAR := Color("#5f9a48")
const COLOR_GROUND_DIRT := Color("#9c6b3e")
const COLOR_GROUND_DIRT_DARK := Color("#6e4523")
const COLOR_TRAIL_GREEN := Color("#5aab35")
const COLOR_ROCK := Color("#8a8478")
const COLOR_ROCK_DARK := Color("#5c584f")
const COLOR_KANGAROO_FUR := Color("#c07a3e")
const COLOR_KANGAROO_FUR_DARK := Color("#8a5a2f")
const COLOR_KANGAROO_BELLY := Color("#f0decc")

const KANGAROO_TEXTURE := preload("res://assets/kangaroo.png")

@onready var player: CharacterBody2D = $Player
@onready var camera: Camera2D = $Camera2D
@onready var sign_bar: Control = $UI/SignBar
@onready var title_label: Label = $UI/SignBar/TitleLabel
@onready var top_exit_button: Button = $UI/SignBar/ExitButton
@onready var status_pill: Control = $UI/StatusPill
@onready var status_label: Label = $UI/StatusPill/StatusLabel
@onready var play_frame: Control = $UI/PlayFrame
@onready var controls: Control = $UI/Controls
@onready var jump_button: Button = $UI/Controls/JumpButton
@onready var game_over_layer: Control = $UI/GameOverLayer
@onready var gameover_panel: Control = $UI/GameOverLayer/Panel
@onready var result_label: Label = $UI/GameOverLayer/ResultLabel
@onready var score_result_label: Label = $UI/GameOverLayer/ScoreResultLabel
@onready var restart_button: Button = $UI/GameOverLayer/RestartButton
@onready var gameover_exit_button: Button = $UI/GameOverLayer/ExitButton
@onready var goal_area: Area2D = $Goal
@onready var hazard_areas: Array = [$Hazards/Hazard0, $Hazards/Hazard1]

var is_running: bool = false
var elapsed_time: float = 0.0
var player_start_pos: Vector2

# Bumped each time a round starts/ends so a stale ready-countdown await from
# an abandoned round (exit/restart mid-countdown) bails out instead of
# starting the run on top of a new round. Same pattern as Mini Snake.
var round_token: int = 0

func _ready() -> void:
	player_start_pos = player.position
	goal_area.body_entered.connect(_on_goal_entered)
	for hazard in hazard_areas:
		hazard.body_entered.connect(_on_hazard_entered)
	jump_button.pressed.connect(_try_jump)
	restart_button.pressed.connect(_start_game)
	top_exit_button.pressed.connect(_on_exit_pressed)
	gameover_exit_button.pressed.connect(_on_exit_pressed)
	_style_ui()
	_start_game()

func _start_game() -> void:
	round_token += 1
	var token := round_token
	is_running = false
	player.position = player_start_pos
	player.velocity = Vector2.ZERO
	elapsed_time = 0.0
	game_over_layer.visible = false
	_update_camera()
	queue_redraw()
	await _run_ready_countdown(token)
	if token != round_token:
		return
	is_running = true
	status_label.text = "Run and jump to the flag!"

func _run_ready_countdown(token: int) -> void:
	for step_text in READY_COUNTDOWN:
		status_label.text = step_text
		await get_tree().create_timer(READY_STEP_DURATION).timeout
		if token != round_token:
			return

func _physics_process(delta: float) -> void:
	if not is_running:
		return
	elapsed_time += delta
	player.velocity.x = RUN_SPEED
	player.velocity.y += GRAVITY * delta
	player.move_and_slide()
	_update_camera()
	queue_redraw()
	if player.position.y > FALL_LIMIT_Y:
		_end_game(false, "Fell in a pit!")

func _try_jump() -> void:
	if not is_running:
		return
	if player.is_on_floor():
		player.velocity.y = JUMP_VELOCITY

func _unhandled_input(event: InputEvent) -> void:
	if not is_running:
		return
	if event is InputEventScreenTouch and event.pressed:
		_try_jump()
	elif event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		_try_jump()
	elif event is InputEventKey and event.pressed and not event.echo and (event.keycode == KEY_SPACE or event.keycode == KEY_UP):
		_try_jump()

func _on_goal_entered(body: Node) -> void:
	if body == player:
		_end_game(true, "")

func _on_hazard_entered(body: Node) -> void:
	if body == player:
		_end_game(false, "Hit an obstacle!")

func _end_game(won: bool, reason: String) -> void:
	if not is_running:
		return
	is_running = false
	round_token += 1
	if won:
		result_label.text = "You Made It!"
		score_result_label.text = "Finished in %0.1fs" % elapsed_time
	else:
		result_label.text = "Game Over"
		score_result_label.text = reason
	game_over_layer.visible = true
	_notify_host_complete()

func _on_exit_pressed() -> void:
	is_running = false
	round_token += 1
	_notify_host_complete()

func _notify_host_complete() -> void:
	# Lets the React MinigameOverlay know the round is over (win, loss, or a
	# manual exit) so it can close the iframe. No-op outside a web export or
	# when there's no parent frame listening.
	if OS.has_feature("web"):
		JavaScriptBridge.eval("window.parent.postMessage({ type: 'minigame-complete', game: 'mini_platformer' }, '*');")

func _update_camera() -> void:
	var half_w: float = get_viewport_rect().size.x / 2.0
	var cam_x: float = clamp(player.position.x, half_w, LEVEL_WIDTH - half_w)
	camera.position = Vector2(cam_x, 300.0)

# ---------------------------------------------------------------------------
# Drawing. Main is a Node2D whose _draw() is subject to the Camera2D's
# transform (it scrolls with the level), so it's used only for world-space
# content: sky, hills, platforms, hazards, goal, player. Fixed screen-space
# chrome (sign header, stat pill, play-frame border, controls plate,
# game-over panel) lives on the UI CanvasLayer as real Panel nodes instead,
# built in _style_ui() — a CanvasLayer's children ignore the 2D camera
# entirely, which a world-space _draw() rect would not.
# ---------------------------------------------------------------------------

func _draw() -> void:
	_draw_sky()
	_draw_hills()
	for segment in PLATFORMS:
		_draw_platform(segment)
	for hazard_x in HAZARD_XS:
		_draw_hazard(hazard_x)
	_draw_goal()
	_draw_player()

func _draw_sky() -> void:
	# Wide enough to cover every camera position across the whole level
	# (visible world x range is always within [0, LEVEL_WIDTH] because
	# _update_camera clamps cam_x to [half_w, LEVEL_WIDTH - half_w]).
	draw_rect(Rect2(Vector2(-50.0, -50.0), Vector2(LEVEL_WIDTH + 100.0, 700.0)), COLOR_SKY, true)

func _draw_hills() -> void:
	# Gentle wavy hill silhouette well below every platform top (max rise
	# stays under the lowest platform y_top of 390) so it never pokes above
	# ground segments — purely a background landscape band, not foliage.
	var points := PackedVector2Array()
	points.append(Vector2(-50.0, GROUND_Y + 4.0))
	var x := -50.0
	while x <= LEVEL_WIDTH + 50.0:
		var y: float = GROUND_Y - 15.0 - 10.0 * sin(x * 0.006)
		points.append(Vector2(x, y))
		x += 90.0
	points.append(Vector2(LEVEL_WIDTH + 50.0, GROUND_Y + 4.0))
	draw_colored_polygon(points, COLOR_HILL_FAR)

func _draw_platform(segment: Array) -> void:
	var x: float = segment[0]
	var width: float = segment[1]
	var y_top: float = segment[2]
	var rect := Rect2(Vector2(x, y_top), Vector2(width, PLATFORM_THICKNESS))
	draw_rect(rect, COLOR_GROUND_DIRT, true)
	draw_rect(Rect2(Vector2(x, y_top + PLATFORM_THICKNESS - 4.0), Vector2(width, 4.0)), COLOR_GROUND_DIRT_DARK, true)
	draw_rect(Rect2(Vector2(x, y_top), Vector2(width, 5.0)), COLOR_TRAIL_GREEN, true)
	draw_rect(rect, COLOR_OUTLINE, false, 2.0)

func _draw_hazard(hazard_x: float) -> void:
	# Trailside rock/boulder hazard — irregular polygon inscribed in the same
	# HAZARD_SIZE box the Area2D hitbox uses, purely a visual reskin.
	var tl := Vector2(hazard_x - HAZARD_SIZE.x / 2.0, GROUND_Y - HAZARD_SIZE.y)
	var w := HAZARD_SIZE.x
	var h := HAZARD_SIZE.y
	var pts := PackedVector2Array([
		tl + Vector2(w * 0.10, h * 0.55),
		tl + Vector2(w * 0.02, h * 1.0),
		tl + Vector2(w * 0.98, h * 1.0),
		tl + Vector2(w * 0.92, h * 0.5),
		tl + Vector2(w * 0.68, h * 0.05),
		tl + Vector2(w * 0.40, h * 0.15),
		tl + Vector2(w * 0.18, h * 0.35),
	])
	draw_colored_polygon(pts, COLOR_ROCK)
	draw_polyline(pts + PackedVector2Array([pts[0]]), COLOR_OUTLINE, 2.0)
	draw_line(tl + Vector2(w * 0.35, h * 0.35), tl + Vector2(w * 0.5, h * 0.7), COLOR_ROCK_DARK, 2.0)
	draw_line(tl + Vector2(w * 0.6, h * 0.3), tl + Vector2(w * 0.7, h * 0.6), COLOR_ROCK_DARK, 2.0)

func _draw_goal() -> void:
	var pole_top := Vector2(GOAL_X, GROUND_Y - GOAL_POLE_HEIGHT)
	var pole_rect := Rect2(Vector2(GOAL_X - 3.0, pole_top.y), Vector2(6.0, GOAL_POLE_HEIGHT))
	draw_rect(pole_rect, COLOR_WOOD_DARK, true)
	draw_rect(pole_rect, COLOR_OUTLINE, false, 1.5)
	# Checkered finish pennant — reads as "finish line" without any text glyph.
	var flag_w := 34.0
	var flag_h := 24.0
	var flag_origin := pole_top + Vector2(3.0, 2.0)
	var cols := 4
	var rows := 2
	var cw := flag_w / cols
	var ch := flag_h / rows
	for cy in range(rows):
		for cx in range(cols):
			var is_dark := (cx + cy) % 2 == 0
			var c := COLOR_OUTLINE if is_dark else COLOR_PARCHMENT
			draw_rect(Rect2(flag_origin + Vector2(cx * cw, cy * ch), Vector2(cw, ch)), c, true)
	draw_rect(Rect2(flag_origin, Vector2(flag_w, flag_h)), COLOR_OUTLINE, false, 1.5)

func _draw_player() -> void:
	# Photo-style kangaroo texture, contain-fit at a fixed draw height (the
	# source photo has no jump/tuck pose, so unlike the old procedural art
	# this doesn't animate an airborne leg-tuck). `pos` is the collision
	# box's center (CharacterBody2D position), matching the original
	# placeholder's Rect2(pos - PLAYER_SIZE / 2, PLAYER_SIZE) anchoring.
	var pos: Vector2 = player.position
	var airborne := not player.is_on_floor()

	if not airborne:
		var shadow_sb := StyleBoxFlat.new()
		shadow_sb.bg_color = Color(0, 0, 0, 0.22)
		shadow_sb.set_corner_radius_all(4)
		draw_style_box(shadow_sb, Rect2(pos + Vector2(-11.0, 16.0), Vector2(22.0, 5.0)))

	# Contain-fit: height matches the previous art's ear-tip-to-foot span,
	# width derived from the texture's own aspect ratio so it isn't stretched.
	var tex_size := KANGAROO_TEXTURE.get_size()
	var h := 54.0
	var w := h * tex_size.x / tex_size.y
	# Feet land at pos.y + 18 (previous art's ground contact point), horizontally
	# centered on pos.x.
	var draw_origin := pos + Vector2(0.0, 18.0)
	var rect := Rect2(draw_origin + Vector2(-w * 0.5, -h), Vector2(w, h))
	# NOTE: unlike some other games in this art pass, this source photo
	# already faces/leans toward image-right — the same direction this
	# kangaroo always runs (+x) — so no horizontal mirror is needed here.
	# (Verified visually: mirroring it made the kangaroo face backwards.)
	draw_texture_rect(KANGAROO_TEXTURE, rect, false)

# ---------------------------------------------------------------------------
# UI node styling - applied once in _ready() to real Control/Button/Panel
# nodes on the UI CanvasLayer (which need to stay real nodes for input +
# text layout + camera-independence) rather than folded into _draw().
# ---------------------------------------------------------------------------

func _style_ui() -> void:
	_add_panel_chrome(sign_bar, 14, COLOR_WOOD_MID, COLOR_OUTLINE, 3, true, true)
	_add_panel_chrome(status_pill, 14, COLOR_PARCHMENT, COLOR_OUTLINE, 2, true, false)
	_add_panel_chrome(play_frame, 18, Color(0, 0, 0, 0), COLOR_WOOD_DARK, 3, false, false)
	_add_panel_chrome(controls, 16, COLOR_PARCHMENT, COLOR_OUTLINE, 2, true, false)
	_add_panel_chrome(gameover_panel, 16, COLOR_WOOD_MID, COLOR_OUTLINE, 3, true, true)

	_style_round_button(top_exit_button, COLOR_SUNSET_ORANGE, COLOR_SUNSET_ORANGE_DEEP, 10)
	_style_round_button(jump_button, COLOR_HEADER_GREEN, COLOR_OUTLINE, 14)
	jump_button.add_theme_font_size_override("font_size", 22)
	_style_round_button(restart_button, COLOR_HEADER_GREEN, COLOR_OUTLINE, 10)
	_style_round_button(gameover_exit_button, COLOR_PARCHMENT, COLOR_OUTLINE, 10)
	gameover_exit_button.add_theme_color_override("font_color", COLOR_INK)
	gameover_exit_button.add_theme_color_override("font_hover_color", COLOR_INK)
	gameover_exit_button.add_theme_color_override("font_pressed_color", COLOR_INK)

	title_label.add_theme_color_override("font_color", Color(1, 1, 1))
	title_label.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.5))
	title_label.add_theme_constant_override("shadow_offset_x", 1)
	title_label.add_theme_constant_override("shadow_offset_y", 1)

	status_label.add_theme_color_override("font_color", COLOR_INK)

	result_label.add_theme_color_override("font_color", Color(1, 1, 1))
	result_label.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.5))
	result_label.add_theme_constant_override("shadow_offset_x", 1)
	result_label.add_theme_constant_override("shadow_offset_y", 1)
	score_result_label.add_theme_color_override("font_color", COLOR_PARCHMENT)

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

# Builds the shared wood-plank/parchment chrome (hard "pop" shadow + panel +
# faint top highlight band) as real Panel children of `container`, sized to
# exactly cover container.size (its local rect). Used instead of Mini
# Snake's _draw_wood_panel/_draw_parchment_pill draw_style_box calls because
# those live in world-space _draw() here, which the level camera scrolls.
func _add_panel_chrome(container: Control, radius: int, bg: Color, border: Color, border_width: int, with_shadow: bool, with_highlight: bool) -> void:
	var rect := Rect2(Vector2.ZERO, container.size)
	var insert_index := 0
	if with_shadow:
		var shadow := Panel.new()
		var shadow_sb := StyleBoxFlat.new()
		shadow_sb.bg_color = COLOR_OUTLINE
		shadow_sb.set_corner_radius_all(radius)
		shadow.add_theme_stylebox_override("panel", shadow_sb)
		shadow.position = rect.position + Vector2(3, 3)
		shadow.size = rect.size
		shadow.mouse_filter = Control.MOUSE_FILTER_IGNORE
		container.add_child(shadow)
		container.move_child(shadow, insert_index)
		insert_index += 1
	var panel := Panel.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = bg
	sb.set_corner_radius_all(radius)
	sb.set_border_width_all(border_width)
	sb.border_color = border
	panel.add_theme_stylebox_override("panel", sb)
	panel.position = rect.position
	panel.size = rect.size
	panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	container.add_child(panel)
	container.move_child(panel, insert_index)
	insert_index += 1
	if with_highlight:
		var hl := Panel.new()
		var hl_sb := StyleBoxFlat.new()
		hl_sb.bg_color = Color(COLOR_WOOD_LIGHT.r, COLOR_WOOD_LIGHT.g, COLOR_WOOD_LIGHT.b, 0.5)
		hl_sb.corner_radius_top_left = max(radius - 2, 0)
		hl_sb.corner_radius_top_right = max(radius - 2, 0)
		hl.add_theme_stylebox_override("panel", hl_sb)
		hl.position = rect.position + Vector2(4, 4)
		hl.size = Vector2(rect.size.x - 8.0, rect.size.y * 0.4)
		hl.mouse_filter = Control.MOUSE_FILTER_IGNORE
		container.add_child(hl)
		container.move_child(hl, insert_index)
