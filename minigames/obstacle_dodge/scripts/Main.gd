extends Node2D

const LANE_COUNT := 3
const VIEWPORT_WIDTH := 400.0
const LANE_WIDTH := VIEWPORT_WIDTH / LANE_COUNT
const PLAY_TOP := 60.0
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

@onready var spawn_timer: Timer = $SpawnTimer
@onready var time_label: Label = $UI/TopBar/TimeLabel
@onready var dodged_label: Label = $UI/TopBar/DodgedLabel
@onready var status_label: Label = $UI/TopBar/StatusLabel
@onready var game_over_layer: Control = $UI/GameOverLayer
@onready var result_label: Label = $UI/GameOverLayer/ResultLabel
@onready var score_result_label: Label = $UI/GameOverLayer/ScoreResultLabel
@onready var restart_button: Button = $UI/GameOverLayer/RestartButton
@onready var top_exit_button: Button = $UI/TopBar/ExitButton
@onready var gameover_exit_button: Button = $UI/GameOverLayer/ExitButton
@onready var btn_left: Button = $UI/Controls/BtnLeft
@onready var btn_right: Button = $UI/Controls/BtnRight

# Each entry: {"lane": int, "y": float}. Data-driven and drawn via _draw(),
# same convention as the grid games — no per-obstacle scene nodes.
var obstacles: Array = []

var player_lane: int = 1
var player_x: float = 0.0
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
	time_label.text = "Time: %d" % ceili(max(0.0, ROUND_DURATION - elapsed_time))
	dodged_label.text = "Dodged: %d" % dodged_count

func _draw() -> void:
	draw_rect(Rect2(Vector2(0, PLAY_TOP), Vector2(VIEWPORT_WIDTH, PLAY_BOTTOM - PLAY_TOP)), Color(0.16, 0.14, 0.2), true)
	for lane in range(1, LANE_COUNT):
		var x: float = lane * LANE_WIDTH
		draw_line(Vector2(x, PLAY_TOP), Vector2(x, PLAY_BOTTOM), Color(0.4, 0.38, 0.45), 2.0)
	for obstacle in obstacles:
		var pos := Vector2(_lane_x(obstacle["lane"]), obstacle["y"])
		draw_rect(Rect2(pos - OBSTACLE_SIZE / 2.0, OBSTACLE_SIZE), Color(0.55, 0.32, 0.2), true)
	_draw_player()

func _draw_player() -> void:
	var pos := Vector2(player_x, PLAYER_Y)
	draw_rect(Rect2(pos - PLAYER_SIZE / 2.0, PLAYER_SIZE), Color(0.92, 0.88, 0.8), true)
	draw_rect(Rect2(pos + Vector2(-14.0, -PLAYER_SIZE.y / 2.0 - 16.0), Vector2(28.0, 20.0)), Color(0.92, 0.88, 0.8), true)
	draw_rect(Rect2(pos + Vector2(-10.0, -PLAYER_SIZE.y / 2.0 - 24.0), Vector2(6.0, 10.0)), Color(0.92, 0.88, 0.8), true)
	draw_rect(Rect2(pos + Vector2(4.0, -PLAYER_SIZE.y / 2.0 - 24.0), Vector2(6.0, 10.0)), Color(0.92, 0.88, 0.8), true)
