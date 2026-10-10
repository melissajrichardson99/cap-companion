extends Node2D

const GRID_WIDTH := 7
const GRID_HEIGHT := 8
const CELL_SIZE := 34
const GRID_ORIGIN := Vector2(81, 160)
const ROUND_DURATION := 45.0
const SWIPE_MIN_DISTANCE := 24.0

# Open-direction bitmask per cell (row-major, [y][x]): N=1, E=2, S=4, W=8.
# Generated with a recursive-backtracker maze generator (guarantees exactly
# one path between any two cells, so it's always solvable) and verified with
# a BFS before being hardcoded here — see the pitfall in CLAUDE.md about
# not shipping unverified generated content.
const MAZE_DATA := [
	[2, 10, 10, 12, 6, 10, 8],
	[6, 10, 12, 5, 3, 10, 12],
	[7, 12, 5, 5, 6, 10, 13],
	[5, 5, 5, 3, 9, 6, 9],
	[1, 5, 5, 4, 6, 9, 4],
	[6, 9, 3, 13, 3, 10, 13],
	[7, 10, 12, 1, 6, 12, 5],
	[3, 8, 3, 10, 9, 3, 9],
]

const DIR_N := 1
const DIR_E := 2
const DIR_S := 4
const DIR_W := 8

const START_CELL := Vector2i(0, 0)
const FINISH_CELL := Vector2i(GRID_WIDTH - 1, GRID_HEIGHT - 1)

# --- Layout rects (design canvas is 400x600, see project.godot). Purely
# cosmetic - none of this feeds gameplay math, which stays in grid-index
# space via GRID_WIDTH/HEIGHT and only touches pixels through GRID_ORIGIN/
# CELL_SIZE at draw time.
const SIGN_RECT := Rect2(10, 10, 380, 56)
const STATS_RECT := Rect2(10, 74, 380, 54)
const TIME_PILL_RECT := Rect2(20, 84, 175, 34)
const MOVES_PILL_RECT := Rect2(205, 84, 175, 34)
const FRAME_RECT := Rect2(61, 140, 278, 312)
const CONTROLS_RECT := Rect2(10, 460, 380, 130)

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

# Maze-specific tones.
const COLOR_MAZE_WALL := Color("#4a2f18")
const COLOR_MAZE_WALL_CORE := Color("#7a4f28")
const COLOR_MAZE_FLOOR := Color("#be9d67")
const COLOR_MAZE_PEBBLE := Color("#a9834f")
const COLOR_EXIT_PAD := Color("#3b7801")

const EMU_TEXTURE := preload("res://assets/emu.png")

@onready var time_caption_label: Label = $UI/StatsBar/TimePill/CaptionLabel
@onready var time_value_label: Label = $UI/StatsBar/TimePill/ValueLabel
@onready var moves_caption_label: Label = $UI/StatsBar/MovesPill/CaptionLabel
@onready var moves_value_label: Label = $UI/StatsBar/MovesPill/ValueLabel
@onready var title_label: Label = $UI/SignBar/TitleLabel
@onready var end_card: EndCard = $UI/EndCard
@onready var top_exit_button: Button = $UI/SignBar/ExitButton
@onready var btn_up: Button = $UI/Controls/DPad/BtnUp
@onready var btn_down: Button = $UI/Controls/DPad/BtnDown
@onready var btn_left: Button = $UI/Controls/DPad/BtnLeft
@onready var btn_right: Button = $UI/Controls/DPad/BtnRight

var player_cell: Vector2i = START_CELL
var moves: int = 0
var time_left: float = ROUND_DURATION
var is_running: bool = false

var touch_start: Vector2 = Vector2.ZERO
var touch_active: bool = false

# Fixed decorative pebble positions, generated once so the trail texture
# doesn't re-randomize (and visibly jitter) on every queue_redraw().
var trail_pebbles: Array[Vector2] = []

func _ready() -> void:
	_generate_trail_pebbles()
	_style_ui()
	btn_up.pressed.connect(func(): _try_move(DIR_N))
	btn_down.pressed.connect(func(): _try_move(DIR_S))
	btn_left.pressed.connect(func(): _try_move(DIR_W))
	btn_right.pressed.connect(func(): _try_move(DIR_E))
	end_card.play_again_pressed.connect(_start_game)
	top_exit_button.pressed.connect(_on_exit_pressed)
	end_card.exit_pressed.connect(_on_exit_pressed)
	_start_game()

func _generate_trail_pebbles() -> void:
	# A sparse scatter of small pebble dots across the trail floor -
	# decorative terrain texture only, not gameplay-affecting.
	var rng := RandomNumberGenerator.new()
	rng.seed = 2024
	trail_pebbles.clear()
	for i in range(16):
		var x := rng.randf_range(0.08, 0.92) * (GRID_WIDTH * CELL_SIZE)
		var y := rng.randf_range(0.08, 0.92) * (GRID_HEIGHT * CELL_SIZE)
		trail_pebbles.append(GRID_ORIGIN + Vector2(x, y))

func _start_game() -> void:
	player_cell = START_CELL
	moves = 0
	time_left = ROUND_DURATION
	is_running = true
	end_card.hide_card()
	_update_labels()
	queue_redraw()

func _process(delta: float) -> void:
	if not is_running:
		return
	time_left -= delta
	if time_left <= 0.0:
		time_left = 0.0
		_update_labels()
		_end_game(false)
		return
	_update_labels()

func _try_move(direction: int) -> void:
	if not is_running:
		return
	var bits: int = MAZE_DATA[player_cell.y][player_cell.x]
	if bits & direction == 0:
		return
	match direction:
		DIR_N:
			player_cell.y -= 1
		DIR_S:
			player_cell.y += 1
		DIR_E:
			player_cell.x += 1
		DIR_W:
			player_cell.x -= 1
	moves += 1
	_update_labels()
	queue_redraw()
	if player_cell == FINISH_CELL:
		_end_game(true)

func _end_game(won: bool) -> void:
	is_running = false
	end_card.show_result(
		"You Made It!" if won else "Time's Up!",
		EndCard.OUTCOME_WIN if won else EndCard.OUTCOME_LOSE,
		[EndCard.stat("Time", ceili(time_left)), EndCard.stat("Moves", moves)],
	)

func _on_exit_pressed() -> void:
	is_running = false
	EndCard.notify_host_complete("mini_maze")

func _update_labels() -> void:
	time_value_label.text = str(ceili(time_left))
	moves_value_label.text = str(moves)

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
	_draw_maze_frame()
	_draw_maze_field()
	_draw_controls_plate()

func _draw_page_bg() -> void:
	var vp := get_viewport_rect().size
	draw_rect(Rect2(Vector2.ZERO, vp), COLOR_PAGE_BG, true)

func _draw_sign_plank() -> void:
	_draw_wood_panel(SIGN_RECT, 14.0)

func _draw_stat_pills() -> void:
	_draw_parchment_pill(STATS_RECT, 16.0)
	_draw_parchment_pill(TIME_PILL_RECT)
	_draw_parchment_pill(MOVES_PILL_RECT)
	_draw_clock_icon(TIME_PILL_RECT.position + Vector2(20, TIME_PILL_RECT.size.y * 0.5), 9.0)
	_draw_footprint_icon(MOVES_PILL_RECT.position + Vector2(20, MOVES_PILL_RECT.size.y * 0.5), 9.0)

func _draw_clock_icon(center: Vector2, r: float) -> void:
	draw_circle(center, r, COLOR_SUNSET_ORANGE_DEEP)
	draw_circle(center, r * 0.8, COLOR_PARCHMENT)
	draw_line(center, center + Vector2(0, -r * 0.5), COLOR_INK, 1.5)
	draw_line(center, center + Vector2(r * 0.35, r * 0.15), COLOR_INK, 1.5)

func _draw_footprint_icon(center: Vector2, r: float) -> void:
	draw_circle(center + Vector2(-r * 0.15, r * 0.25), r * 0.55, COLOR_ADVENTURE_GREEN)
	draw_circle(center + Vector2(r * 0.25, -r * 0.35), r * 0.4, COLOR_ADVENTURE_GREEN)

func _draw_maze_frame() -> void:
	_draw_wood_panel(FRAME_RECT, 18.0)

func _draw_maze_field() -> void:
	var field_rect := Rect2(GRID_ORIGIN, Vector2(GRID_WIDTH * CELL_SIZE, GRID_HEIGHT * CELL_SIZE))
	draw_rect(field_rect, COLOR_MAZE_FLOOR, true)
	for pebble in trail_pebbles:
		draw_circle(pebble, 1.6, COLOR_MAZE_PEBBLE)
	_draw_exit_marker(FINISH_CELL)
	for y in range(GRID_HEIGHT):
		for x in range(GRID_WIDTH):
			_draw_cell_walls(Vector2i(x, y), MAZE_DATA[y][x])
	_draw_emu(player_cell)

func _draw_exit_marker(cell: Vector2i) -> void:
	var top_left := GRID_ORIGIN + Vector2(cell.x * CELL_SIZE, cell.y * CELL_SIZE)
	var pad_rect := Rect2(top_left + Vector2(2, 2), Vector2(CELL_SIZE - 4, CELL_SIZE - 4))
	var sb := StyleBoxFlat.new()
	sb.bg_color = COLOR_EXIT_PAD
	sb.set_corner_radius_all(6)
	sb.border_width_bottom = 2
	sb.border_color = COLOR_OUTLINE
	draw_style_box(sb, pad_rect)
	var base := top_left + Vector2(CELL_SIZE * 0.32, CELL_SIZE * 0.82)
	var pole_top := base + Vector2(0, -CELL_SIZE * 0.6)
	draw_line(base, pole_top, COLOR_OUTLINE, 2.5)
	var flag_points := PackedVector2Array([
		pole_top,
		pole_top + Vector2(CELL_SIZE * 0.32, CELL_SIZE * 0.1),
		pole_top + Vector2(0, CELL_SIZE * 0.2),
	])
	draw_colored_polygon(flag_points, COLOR_SUNSET_ORANGE)

func _draw_cell_walls(cell: Vector2i, bits: int) -> void:
	var top_left := GRID_ORIGIN + Vector2(cell.x * CELL_SIZE, cell.y * CELL_SIZE)
	var top_right := top_left + Vector2(CELL_SIZE, 0)
	var bottom_left := top_left + Vector2(0, CELL_SIZE)
	var bottom_right := top_left + Vector2(CELL_SIZE, CELL_SIZE)
	if bits & DIR_N == 0:
		_draw_wall_segment(top_left, top_right)
	if bits & DIR_S == 0:
		_draw_wall_segment(bottom_left, bottom_right)
	if bits & DIR_W == 0:
		_draw_wall_segment(top_left, bottom_left)
	if bits & DIR_E == 0:
		_draw_wall_segment(top_right, bottom_right)

func _draw_wall_segment(a: Vector2, b: Vector2) -> void:
	# Double-line "plank" wall: a thick dark outline with a lighter wood
	# core drawn on top, echoing the wood-panel chrome used elsewhere.
	draw_line(a, b, COLOR_MAZE_WALL, 5.0)
	draw_line(a, b, COLOR_MAZE_WALL_CORE, 2.0)

func _draw_emu(cell: Vector2i) -> void:
	# Contain-fit the emu texture into a token slightly taller than one maze
	# cell (deliberately overflowing above the cell for visibility), anchored
	# so its feet sit near the cell's bottom edge.
	var cell_center := GRID_ORIGIN + Vector2(cell.x * CELL_SIZE, cell.y * CELL_SIZE) + Vector2(CELL_SIZE, CELL_SIZE) * 0.5
	var tex_size := EMU_TEXTURE.get_size()
	var h := CELL_SIZE * 1.5
	var w := h * tex_size.x / tex_size.y
	var rect := Rect2(cell_center - Vector2(w * 0.5, h * 0.62), Vector2(w, h))
	draw_texture_rect(EMU_TEXTURE, rect, false)

func _draw_controls_plate() -> void:
	_draw_parchment_pill(CONTROLS_RECT, 16.0)

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

	title_label.add_theme_color_override("font_color", Color(1, 1, 1))
	title_label.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.5))
	title_label.add_theme_constant_override("shadow_offset_x", 1)
	title_label.add_theme_constant_override("shadow_offset_y", 1)

	time_caption_label.add_theme_color_override("font_color", COLOR_INK)
	time_value_label.add_theme_color_override("font_color", COLOR_INK)
	moves_caption_label.add_theme_color_override("font_color", COLOR_INK)
	moves_value_label.add_theme_color_override("font_color", COLOR_INK)

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
		_try_move(DIR_E if delta.x > 0 else DIR_W)
	else:
		_try_move(DIR_S if delta.y > 0 else DIR_N)
