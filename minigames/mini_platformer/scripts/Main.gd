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

@onready var player: CharacterBody2D = $Player
@onready var camera: Camera2D = $Camera2D
@onready var status_label: Label = $UI/TopBar/StatusLabel
@onready var jump_button: Button = $UI/Controls/JumpButton
@onready var game_over_layer: Control = $UI/GameOverLayer
@onready var result_label: Label = $UI/GameOverLayer/ResultLabel
@onready var score_result_label: Label = $UI/GameOverLayer/ScoreResultLabel
@onready var restart_button: Button = $UI/GameOverLayer/RestartButton
@onready var top_exit_button: Button = $UI/TopBar/ExitButton
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

func _draw() -> void:
	for segment in PLATFORMS:
		var x: float = segment[0]
		var width: float = segment[1]
		var y_top: float = segment[2]
		draw_rect(Rect2(Vector2(x, y_top), Vector2(width, PLATFORM_THICKNESS)), Color(0.55, 0.4, 0.25), true)
		draw_rect(Rect2(Vector2(x, y_top), Vector2(width, 4.0)), Color(0.45, 0.75, 0.35), true)
	for hazard_x in HAZARD_XS:
		draw_rect(Rect2(Vector2(hazard_x - HAZARD_SIZE.x / 2.0, GROUND_Y - HAZARD_SIZE.y), HAZARD_SIZE), Color(0.5, 0.2, 0.15), true)
	draw_rect(Rect2(Vector2(GOAL_X - 4.0, GROUND_Y - GOAL_POLE_HEIGHT), Vector2(8.0, GOAL_POLE_HEIGHT)), Color(0.85, 0.85, 0.8), true)
	draw_rect(Rect2(Vector2(GOAL_X + 4.0, GROUND_Y - GOAL_POLE_HEIGHT), Vector2(38.0, 26.0)), Color(0.95, 0.75, 0.2), true)
	_draw_player()

func _draw_player() -> void:
	var pos: Vector2 = player.position
	draw_rect(Rect2(pos + Vector2(-18.0, -2.0), Vector2(10.0, 6.0)), Color(0.8, 0.5, 0.2), true)
	draw_rect(Rect2(pos - PLAYER_SIZE / 2.0, PLAYER_SIZE), Color(0.85, 0.55, 0.25), true)
	draw_rect(Rect2(pos + Vector2(-10.0, -26.0), Vector2(6.0, 10.0)), Color(0.85, 0.55, 0.25), true)
	draw_rect(Rect2(pos + Vector2(4.0, -26.0), Vector2(6.0, 10.0)), Color(0.85, 0.55, 0.25), true)
