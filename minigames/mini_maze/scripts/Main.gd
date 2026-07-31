extends Node2D

const GRID_WIDTH := 7
const GRID_HEIGHT := 8
const CELL_SIZE := 40
const GRID_ORIGIN := Vector2(60, 100)
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

const WALL_COLOR := Color(0.9, 0.9, 0.85)
const BOARD_COLOR := Color(0.12, 0.14, 0.18)
const FINISH_COLOR := Color(0.35, 0.8, 0.4)
const PLAYER_COLOR := Color(0.95, 0.7, 0.25)

@onready var time_label: Label = $UI/TopBar/TimeLabel
@onready var moves_label: Label = $UI/TopBar/MovesLabel
@onready var game_over_layer: Control = $UI/GameOverLayer
@onready var result_label: Label = $UI/GameOverLayer/ResultLabel
@onready var score_result_label: Label = $UI/GameOverLayer/ScoreResultLabel
@onready var restart_button: Button = $UI/GameOverLayer/RestartButton
@onready var top_exit_button: Button = $UI/TopBar/ExitButton
@onready var gameover_exit_button: Button = $UI/GameOverLayer/ExitButton
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

func _ready() -> void:
	btn_up.pressed.connect(func(): _try_move(DIR_N))
	btn_down.pressed.connect(func(): _try_move(DIR_S))
	btn_left.pressed.connect(func(): _try_move(DIR_W))
	btn_right.pressed.connect(func(): _try_move(DIR_E))
	restart_button.pressed.connect(_start_game)
	top_exit_button.pressed.connect(_on_exit_pressed)
	gameover_exit_button.pressed.connect(_on_exit_pressed)
	_start_game()

func _start_game() -> void:
	player_cell = START_CELL
	moves = 0
	time_left = ROUND_DURATION
	is_running = true
	game_over_layer.visible = false
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
	if won:
		result_label.text = "You Made It!"
		score_result_label.text = "Solved in %d moves with %0.1fs left" % [moves, time_left]
	else:
		result_label.text = "Time's Up!"
		score_result_label.text = "Didn't reach the finish in time"
	game_over_layer.visible = true
	_notify_host_complete()

func _on_exit_pressed() -> void:
	is_running = false
	_notify_host_complete()

func _notify_host_complete() -> void:
	# Lets the React MinigameOverlay know the round is over (reached the
	# finish, ran out of time, or a manual exit) so it can close the iframe.
	# No-op outside a web export or when there's no parent frame listening.
	if OS.has_feature("web"):
		JavaScriptBridge.eval("window.parent.postMessage({ type: 'minigame-complete', game: 'mini_maze' }, '*');")

func _update_labels() -> void:
	time_label.text = "Time: %d" % ceili(time_left)
	moves_label.text = "Moves: %d" % moves

func _draw() -> void:
	draw_rect(Rect2(GRID_ORIGIN, Vector2(GRID_WIDTH * CELL_SIZE, GRID_HEIGHT * CELL_SIZE)), BOARD_COLOR, true)
	_draw_cell_fill(FINISH_CELL, FINISH_COLOR)
	for y in range(GRID_HEIGHT):
		for x in range(GRID_WIDTH):
			_draw_cell_walls(Vector2i(x, y), MAZE_DATA[y][x])
	_draw_cell_fill(player_cell, PLAYER_COLOR, 0.7)

func _draw_cell_fill(cell: Vector2i, color: Color, inset_ratio: float = 1.0) -> void:
	var top_left := GRID_ORIGIN + Vector2(cell.x * CELL_SIZE, cell.y * CELL_SIZE)
	var inset := CELL_SIZE * (1.0 - inset_ratio) * 0.5
	draw_rect(Rect2(top_left + Vector2(inset, inset), Vector2(CELL_SIZE - inset * 2, CELL_SIZE - inset * 2)), color, true)

func _draw_cell_walls(cell: Vector2i, bits: int) -> void:
	var top_left := GRID_ORIGIN + Vector2(cell.x * CELL_SIZE, cell.y * CELL_SIZE)
	var top_right := top_left + Vector2(CELL_SIZE, 0)
	var bottom_left := top_left + Vector2(0, CELL_SIZE)
	var bottom_right := top_left + Vector2(CELL_SIZE, CELL_SIZE)
	if bits & DIR_N == 0:
		draw_line(top_left, top_right, WALL_COLOR, 2.0)
	if bits & DIR_S == 0:
		draw_line(bottom_left, bottom_right, WALL_COLOR, 2.0)
	if bits & DIR_W == 0:
		draw_line(top_left, bottom_left, WALL_COLOR, 2.0)
	if bits & DIR_E == 0:
		draw_line(top_right, bottom_right, WALL_COLOR, 2.0)

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
