extends Node2D

const GRID_WIDTH := 10
const GRID_HEIGHT := 10
const CELL_SIZE := 36
const GRID_ORIGIN := Vector2(20, 150)
const TARGET_LENGTH := 10
const START_LENGTH := 3
const TICK_INTERVAL := 0.2
const SWIPE_MIN_DISTANCE := 24.0
const READY_COUNTDOWN := ["Ready?", "3", "2", "1", "Go!"]
const READY_STEP_DURATION := 0.5

const DIR_UP := Vector2i(0, -1)
const DIR_DOWN := Vector2i(0, 1)
const DIR_LEFT := Vector2i(-1, 0)
const DIR_RIGHT := Vector2i(1, 0)

# --- Layout rects (design canvas is 400x660, see project.godot). Purely
# cosmetic - none of this feeds gameplay math, which stays in grid-index
# space via GRID_WIDTH/HEIGHT and only touches pixels through GRID_ORIGIN/
# CELL_SIZE at draw time.
const SIGN_RECT := Rect2(10, 10, 380, 56)
const STATS_RECT := Rect2(10, 74, 380, 54)
const FRAME_RECT := Rect2(10, 140, 380, 380)
const CONTROLS_RECT := Rect2(10, 532, 380, 118)
const SCORE_PILL_RECT := Rect2(20, 84, 175, 34)
const LENGTH_PILL_RECT := Rect2(205, 84, 175, 34)

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
const COLOR_SNAKE_HEAD := Color("#5aab35")
const COLOR_SNAKE_BODY := Color("#3b7801")
const COLOR_APPLE_RED := Color("#d9432e")

@onready var tick_timer: Timer = $TickTimer
@onready var title_label: Label = $UI/SignBar/TitleLabel
@onready var score_caption_label: Label = $UI/StatsBar/ScorePill/CaptionLabel
@onready var score_value_label: Label = $UI/StatsBar/ScorePill/ValueLabel
@onready var length_caption_label: Label = $UI/StatsBar/LengthPill/CaptionLabel
@onready var length_value_label: Label = $UI/StatsBar/LengthPill/ValueLabel
@onready var countdown_label: Label = $UI/CountdownLabel
@onready var game_over_layer: Control = $UI/GameOverLayer
@onready var result_label: Label = $UI/GameOverLayer/ResultLabel
@onready var score_result_label: Label = $UI/GameOverLayer/ScoreResultLabel
@onready var btn_up: Button = $UI/Controls/DPad/BtnUp
@onready var btn_down: Button = $UI/Controls/DPad/BtnDown
@onready var btn_left: Button = $UI/Controls/DPad/BtnLeft
@onready var btn_right: Button = $UI/Controls/DPad/BtnRight
@onready var restart_button: Button = $UI/GameOverLayer/RestartButton
@onready var top_exit_button: Button = $UI/SignBar/ExitButton
@onready var gameover_exit_button: Button = $UI/GameOverLayer/ExitButton

var snake: Array[Vector2i] = []
var direction: Vector2i = DIR_RIGHT
var queued_direction: Vector2i = DIR_RIGHT
var food: Vector2i
var score: int = 0
var is_running: bool = false
var countdown_active: bool = false

var touch_start: Vector2 = Vector2.ZERO
var touch_active: bool = false

# Fixed decorative grass-blade positions, generated once so the ground
# texture doesn't re-randomize (and visibly jitter) on every queue_redraw().
var grass_blades: Array[Vector2] = []

# Bumped each time a new round starts so a stale countdown await from a
# previous round (abandoned via exit/restart) can detect it's outdated and
# bail out instead of starting the tick timer on top of a new round.
var round_token: int = 0

func _ready() -> void:
	randomize()
	_generate_grass_blades()
	_style_ui()
	tick_timer.wait_time = TICK_INTERVAL
	tick_timer.timeout.connect(_on_tick)
	btn_up.pressed.connect(func(): set_direction(DIR_UP))
	btn_down.pressed.connect(func(): set_direction(DIR_DOWN))
	btn_left.pressed.connect(func(): set_direction(DIR_LEFT))
	btn_right.pressed.connect(func(): set_direction(DIR_RIGHT))
	restart_button.pressed.connect(_start_game)
	top_exit_button.pressed.connect(_on_exit_pressed)
	gameover_exit_button.pressed.connect(_on_exit_pressed)
	_start_game()

func _generate_grass_blades() -> void:
	# A sparse scatter of single blade tufts across the field - decorative
	# ground texture only, deliberately not clustered like the corner
	# bush/flower art the reference mockup was trimmed of.
	var rng := RandomNumberGenerator.new()
	rng.seed = 1337
	grass_blades.clear()
	for i in range(14):
		var x := rng.randf_range(0.06, 0.94) * (GRID_WIDTH * CELL_SIZE)
		var y := rng.randf_range(0.06, 0.94) * (GRID_HEIGHT * CELL_SIZE)
		grass_blades.append(GRID_ORIGIN + Vector2(x, y))

func _start_game() -> void:
	round_token += 1
	var token := round_token
	# Centered so the length-3 body (occupying start_x, start_x-1, start_x-2)
	# has 3-4 cells of margin to every wall - as balanced as an odd-length
	# snake gets on an even-sized grid.
	var start_x := GRID_WIDTH / 2
	var start_y := GRID_HEIGHT / 2
	snake.clear()
	for i in range(START_LENGTH):
		snake.append(Vector2i(start_x - i, start_y))
	direction = DIR_RIGHT
	queued_direction = DIR_RIGHT
	score = 0
	is_running = true
	game_over_layer.visible = false
	tick_timer.stop()
	_spawn_food()
	_update_labels()
	queue_redraw()
	await _run_ready_countdown(token)
	if token != round_token or not is_running:
		return
	_update_labels()
	tick_timer.start()

func _run_ready_countdown(token: int) -> void:
	countdown_active = true
	countdown_label.visible = true
	for step_text in READY_COUNTDOWN:
		countdown_label.text = step_text
		queue_redraw()
		await get_tree().create_timer(READY_STEP_DURATION).timeout
		if token != round_token:
			return
	countdown_active = false
	countdown_label.visible = false
	queue_redraw()

func _spawn_food() -> void:
	var empty_cells: Array[Vector2i] = []
	for x in range(GRID_WIDTH):
		for y in range(GRID_HEIGHT):
			var cell := Vector2i(x, y)
			if not snake.has(cell):
				empty_cells.append(cell)
	if empty_cells.is_empty():
		return
	food = empty_cells[randi() % empty_cells.size()]

func _on_tick() -> void:
	if not is_running:
		return
	if _is_valid_turn(queued_direction):
		direction = queued_direction
	var new_head: Vector2i = snake[0] + direction
	var grows := new_head == food
	if _hits_wall(new_head) or _hits_self(new_head, grows):
		_end_game(false)
		return
	snake.insert(0, new_head)
	if grows:
		score += 1
		if snake.size() >= TARGET_LENGTH:
			_update_labels()
			_end_game(true)
			return
		_spawn_food()
	else:
		snake.pop_back()
	_update_labels()
	queue_redraw()

func _is_valid_turn(new_dir: Vector2i) -> bool:
	# A snake longer than one segment can't reverse directly into itself.
	if snake.size() > 1 and new_dir == -direction:
		return false
	return true

func _hits_wall(pos: Vector2i) -> bool:
	return pos.x < 0 or pos.x >= GRID_WIDTH or pos.y < 0 or pos.y >= GRID_HEIGHT

func _hits_self(pos: Vector2i, grows: bool) -> bool:
	# The tail cell is vacated this tick unless the snake is growing into it.
	var body := snake
	if not grows:
		body = snake.slice(0, snake.size() - 1)
	return body.has(pos)

func _end_game(won: bool) -> void:
	is_running = false
	round_token += 1
	tick_timer.stop()
	result_label.text = "You Win!" if won else "Game Over"
	score_result_label.text = "Length reached: %d" % snake.size()
	game_over_layer.visible = true
	_notify_host_complete()

func _on_exit_pressed() -> void:
	is_running = false
	round_token += 1
	tick_timer.stop()
	_notify_host_complete()

func _notify_host_complete() -> void:
	# Lets the React MinigameOverlay know the round is over (win, loss, or a
	# manual exit) so it can close the iframe. No-op outside a web export or
	# when there's no parent frame listening.
	if OS.has_feature("web"):
		JavaScriptBridge.eval("window.parent.postMessage({ type: 'minigame-complete', game: 'mini_snake' }, '*');")

func _update_labels() -> void:
	score_value_label.text = str(score)
	length_value_label.text = str(snake.size())

# ---------------------------------------------------------------------------
# Drawing. Main is a Node2D so everything here renders beneath the $UI
# CanvasLayer's real Label/Button nodes (CanvasLayer always composites above
# the base 2D canvas), the same layering the original flat-rect prototype
# relied on for its grid.
# ---------------------------------------------------------------------------

func _draw() -> void:
	_draw_page_bg()
	_draw_sign_plank()
	_draw_stat_pills()
	_draw_field_frame()
	_draw_field()
	_draw_controls_plate()
	if countdown_active:
		_draw_countdown_backdrop()

func _draw_page_bg() -> void:
	var vp := get_viewport_rect().size
	draw_rect(Rect2(Vector2.ZERO, vp), COLOR_PAGE_BG, true)

func _draw_sign_plank() -> void:
	_draw_wood_panel(SIGN_RECT, 14.0)

func _draw_stat_pills() -> void:
	_draw_parchment_pill(STATS_RECT, 16.0)
	_draw_parchment_pill(SCORE_PILL_RECT)
	_draw_parchment_pill(LENGTH_PILL_RECT)
	_draw_star_icon(SCORE_PILL_RECT.position + Vector2(20, SCORE_PILL_RECT.size.y * 0.5), 9.0)
	_draw_leaf_icon(LENGTH_PILL_RECT.position + Vector2(20, LENGTH_PILL_RECT.size.y * 0.5), 9.0)

func _draw_star_icon(center: Vector2, r: float) -> void:
	var points := PackedVector2Array()
	for i in range(10):
		var ang := -PI / 2 + i * PI / 5
		var rad := r if i % 2 == 0 else r * 0.45
		points.append(center + Vector2(cos(ang), sin(ang)) * rad)
	draw_colored_polygon(points, Color("#f2b705"))

func _draw_leaf_icon(center: Vector2, r: float) -> void:
	draw_circle(center, r, COLOR_GRASS_BLADE)
	draw_line(center + Vector2(-r * 0.6, r * 0.2), center + Vector2(r * 0.6, -r * 0.2), COLOR_HEADER_GREEN, 1.5)

func _draw_field_frame() -> void:
	_draw_wood_panel(FRAME_RECT, 18.0)

func _draw_field() -> void:
	var field_rect := Rect2(GRID_ORIGIN, Vector2(GRID_WIDTH * CELL_SIZE, GRID_HEIGHT * CELL_SIZE))
	draw_rect(field_rect, COLOR_GRASS_DARK, true)
	for x in range(1, GRID_WIDTH):
		var lx := GRID_ORIGIN.x + x * CELL_SIZE
		draw_line(Vector2(lx, GRID_ORIGIN.y), Vector2(lx, GRID_ORIGIN.y + GRID_HEIGHT * CELL_SIZE), COLOR_GRASS_LINE, 1.0)
	for y in range(1, GRID_HEIGHT):
		var ly := GRID_ORIGIN.y + y * CELL_SIZE
		draw_line(Vector2(GRID_ORIGIN.x, ly), Vector2(GRID_ORIGIN.x + GRID_WIDTH * CELL_SIZE, ly), COLOR_GRASS_LINE, 1.0)
	for blade in grass_blades:
		_draw_grass_blade(blade)
	for i in range(snake.size()):
		var is_head := i == 0
		_draw_snake_cell(snake[i], COLOR_SNAKE_HEAD if is_head else COLOR_SNAKE_BODY)
	_draw_apple(food)

func _draw_grass_blade(pos: Vector2) -> void:
	draw_line(pos, pos + Vector2(-4, -10), COLOR_GRASS_BLADE, 2.0)
	draw_line(pos, pos + Vector2(0, -12), COLOR_GRASS_BLADE, 2.0)
	draw_line(pos, pos + Vector2(4, -10), COLOR_GRASS_BLADE, 2.0)

func _draw_snake_cell(cell: Vector2i, color: Color) -> void:
	var pos := GRID_ORIGIN + Vector2(cell.x * CELL_SIZE, cell.y * CELL_SIZE)
	var rect := Rect2(pos + Vector2(2, 2), Vector2(CELL_SIZE - 4, CELL_SIZE - 4))
	var sb := StyleBoxFlat.new()
	sb.bg_color = color
	sb.set_corner_radius_all(8)
	sb.border_width_bottom = 2
	sb.border_color = COLOR_OUTLINE
	draw_style_box(sb, rect)

func _draw_apple(cell: Vector2i) -> void:
	var pos := GRID_ORIGIN + Vector2(cell.x * CELL_SIZE, cell.y * CELL_SIZE) + Vector2(CELL_SIZE, CELL_SIZE) * 0.5
	draw_circle(pos + Vector2(0, 2), CELL_SIZE * 0.34, COLOR_APPLE_RED)
	draw_rect(Rect2(pos + Vector2(-1.5, -CELL_SIZE * 0.34 - 5), Vector2(3, 6)), Color("#6e4523"), true)
	draw_circle(pos + Vector2(-CELL_SIZE * 0.12, -CELL_SIZE * 0.1), CELL_SIZE * 0.08, Color(1, 1, 1, 0.55))

func _draw_controls_plate() -> void:
	_draw_parchment_pill(CONTROLS_RECT, 16.0)

func _draw_countdown_backdrop() -> void:
	var field_rect := Rect2(GRID_ORIGIN, Vector2(GRID_WIDTH * CELL_SIZE, GRID_HEIGHT * CELL_SIZE))
	draw_rect(field_rect, Color(0, 0, 0, 0.45), true)

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
	_style_dpad_button(btn_up)
	_style_dpad_button(btn_down)
	_style_dpad_button(btn_left)
	_style_dpad_button(btn_right)
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

	score_caption_label.add_theme_color_override("font_color", COLOR_INK)
	score_value_label.add_theme_color_override("font_color", COLOR_INK)
	length_caption_label.add_theme_color_override("font_color", COLOR_INK)
	length_value_label.add_theme_color_override("font_color", COLOR_INK)
	countdown_label.add_theme_color_override("font_color", Color(1, 1, 1))
	countdown_label.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.6))
	countdown_label.add_theme_constant_override("shadow_offset_x", 2)
	countdown_label.add_theme_constant_override("shadow_offset_y", 2)
	countdown_label.add_theme_font_size_override("font_size", 40)

	result_label.add_theme_color_override("font_color", COLOR_INK)
	score_result_label.add_theme_color_override("font_color", COLOR_INK)

func _style_dpad_button(btn: Button) -> void:
	_style_round_button(btn, COLOR_HEADER_GREEN, COLOR_WOOD_LIGHT, 10)
	btn.add_theme_font_size_override("font_size", 24)

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

func set_direction(new_dir: Vector2i) -> void:
	queued_direction = new_dir

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

func _handle_swipe(delta: Vector2) -> void:
	if delta.length() < SWIPE_MIN_DISTANCE:
		return
	if abs(delta.x) > abs(delta.y):
		set_direction(DIR_RIGHT if delta.x > 0 else DIR_LEFT)
	else:
		set_direction(DIR_DOWN if delta.y > 0 else DIR_UP)
