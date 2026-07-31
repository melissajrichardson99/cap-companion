extends Node2D

const GRID_WIDTH := 10
const GRID_HEIGHT := 10
const CELL_SIZE := 40
const GRID_ORIGIN := Vector2(0, 60)
const TARGET_LENGTH := 10
const START_LENGTH := 3
const TICK_INTERVAL := 0.2
const SWIPE_MIN_DISTANCE := 24.0

const DIR_UP := Vector2i(0, -1)
const DIR_DOWN := Vector2i(0, 1)
const DIR_LEFT := Vector2i(-1, 0)
const DIR_RIGHT := Vector2i(1, 0)

@onready var tick_timer: Timer = $TickTimer
@onready var score_label: Label = $UI/TopBar/ScoreLabel
@onready var status_label: Label = $UI/TopBar/StatusLabel
@onready var game_over_layer: Control = $UI/GameOverLayer
@onready var result_label: Label = $UI/GameOverLayer/ResultLabel
@onready var score_result_label: Label = $UI/GameOverLayer/ScoreResultLabel
@onready var btn_up: Button = $UI/Controls/DPad/BtnUp
@onready var btn_down: Button = $UI/Controls/DPad/BtnDown
@onready var btn_left: Button = $UI/Controls/DPad/BtnLeft
@onready var btn_right: Button = $UI/Controls/DPad/BtnRight
@onready var restart_button: Button = $UI/GameOverLayer/RestartButton
@onready var top_exit_button: Button = $UI/TopBar/ExitButton
@onready var gameover_exit_button: Button = $UI/GameOverLayer/ExitButton

var snake: Array[Vector2i] = []
var direction: Vector2i = DIR_RIGHT
var queued_direction: Vector2i = DIR_RIGHT
var food: Vector2i
var score: int = 0
var is_running: bool = false

var touch_start: Vector2 = Vector2.ZERO
var touch_active: bool = false

func _ready() -> void:
	randomize()
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

func _start_game() -> void:
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
	_spawn_food()
	_update_labels()
	tick_timer.start()
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
	tick_timer.stop()
	result_label.text = "You Win!" if won else "Game Over"
	score_result_label.text = "Length reached: %d" % snake.size()
	game_over_layer.visible = true
	_notify_host_complete()

func _on_exit_pressed() -> void:
	is_running = false
	tick_timer.stop()
	_notify_host_complete()

func _notify_host_complete() -> void:
	# Lets the React MinigameOverlay know the round is over (win, loss, or a
	# manual exit) so it can close the iframe. No-op outside a web export or
	# when there's no parent frame listening.
	if OS.has_feature("web"):
		JavaScriptBridge.eval("window.parent.postMessage({ type: 'minigame-complete', game: 'mini_snake' }, '*');")

func _update_labels() -> void:
	score_label.text = "Score: %d" % score
	status_label.text = "Length: %d / %d" % [snake.size(), TARGET_LENGTH]

func _draw() -> void:
	draw_rect(Rect2(GRID_ORIGIN, Vector2(GRID_WIDTH * CELL_SIZE, GRID_HEIGHT * CELL_SIZE)), Color(0.12, 0.14, 0.12), true)
	for i in range(snake.size()):
		var is_head := i == 0
		_draw_cell(snake[i], Color(0.25, 0.75, 0.35) if is_head else Color(0.35, 0.85, 0.45))
	_draw_cell(food, Color(0.9, 0.3, 0.25))

func _draw_cell(cell: Vector2i, color: Color) -> void:
	var pos := GRID_ORIGIN + Vector2(cell.x * CELL_SIZE, cell.y * CELL_SIZE)
	draw_rect(Rect2(pos + Vector2(2, 2), Vector2(CELL_SIZE - 4, CELL_SIZE - 4)), color, true)

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
