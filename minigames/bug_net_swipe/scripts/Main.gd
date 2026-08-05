extends Node2D

const VIEWPORT_WIDTH := 400.0
const VIEWPORT_HEIGHT := 600.0
const PLAY_TOP := 64.0
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

@onready var spawn_timer: Timer = $SpawnTimer
@onready var time_label: Label = $UI/TopBar/TimeLabel
@onready var catch_label: Label = $UI/TopBar/CatchLabel
@onready var status_label: Label = $UI/TopBar/StatusLabel
@onready var game_over_layer: Control = $UI/GameOverLayer
@onready var result_label: Label = $UI/GameOverLayer/ResultLabel
@onready var score_result_label: Label = $UI/GameOverLayer/ScoreResultLabel
@onready var restart_button: Button = $UI/GameOverLayer/RestartButton
@onready var top_exit_button: Button = $UI/TopBar/ExitButton
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
	time_label.text = "Time: %d" % ceili(max(0.0, TIME_LIMIT - elapsed_time))
	catch_label.text = "Caught: %d/%d" % [catch_count, TARGET_CATCHES]

func _draw() -> void:
	draw_rect(Rect2(Vector2(0, PLAY_TOP), Vector2(VIEWPORT_WIDTH, PLAY_BOTTOM - PLAY_TOP)), BACKGROUND_COLOR, true)
	for bug in bugs:
		_draw_bug(bug)

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
