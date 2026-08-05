extends Node2D

const VIEWPORT_WIDTH := 400.0
const VIEWPORT_HEIGHT := 600.0
const PLAY_TOP := 60.0

# Throw anchor near bottom-center of the play area. The player presses near
# this point, drags away (slingshot pull-back), and releases to throw.
const ANCHOR_POS := Vector2(200.0, 520.0)
# Generous "near the anchor" tolerance so a press doesn't have to land on the
# exact pixel to start a drag - matters for both touch and the Playwright
# mouse-driven verification harness.
const PRESS_ANCHOR_RADIUS := 100.0

const THROWS_PER_ROUND := 4
const WIN_SCORE := 10

# Drags shorter than this are ignored entirely (no throw consumed), same
# convention as Obstacle Dodge / Mini Snake's SWIPE_MIN_DISTANCE guard.
const SWIPE_MIN_DISTANCE := 18.0
# Power is the (clamped) drag length, remapped below to a landing distance.
# Kept small on purpose: the anchor sits close to the bottom of the 600-tall
# viewport (ANCHOR_POS.y = 520), so a real player's straight-down pull-back
# only has ~80px of clearance before running off the edge of the play area.
# MAX_DRAG=220 (the original suggested-shape value) is not physically
# reachable as a mostly-vertical pull at this anchor position/viewport size -
# found via Playwright verification, not from reading the code. Values below
# keep the full drag range comfortably inside that ~80px of headroom.
const MIN_DRAG := 18.0
const MAX_DRAG := 70.0

# Landing distance (from ANCHOR_POS, along the pull direction) that MIN_DRAG
# and MAX_DRAG power remap to. Chosen so a min-power throw lands in the near
# peg's zone and a max-power throw lands in the far peg's zone.
const MIN_LANDING := 150.0
const MAX_LANDING := 310.0

# Scatter added to landing_pos on release. A dead-straight-up pull (the
# accurate case) gets near-zero scatter; an off-angle pull gets a lot more -
# this is the "accuracy varies with angle" mechanic, not just power.
const SCATTER_MAX := 46.0
const SCATTER_MIN := 4.0

const THROW_TRAVEL_DURATION := 0.35
const RESULT_PAUSE_DURATION := 0.6

const READY_COUNTDOWN := ["Ready?", "3", "2", "1", "Go!"]
const READY_STEP_DURATION := 0.5

# Pegs stack going up the screen from the anchor. Distance/radius/value trade
# off against each other: near = big & easy & cheap, far = small & hard & rich.
const PEGS := [
	{"distance": 150.0, "radius": 34.0, "value": 2, "color": Color(0.75, 0.4, 0.3)},
	{"distance": 230.0, "radius": 24.0, "value": 3, "color": Color(0.3, 0.55, 0.75)},
	{"distance": 310.0, "radius": 16.0, "value": 5, "color": Color(0.85, 0.7, 0.2)},
]

@onready var throws_label: Label = $UI/TopBar/ThrowsLabel
@onready var score_label: Label = $UI/TopBar/ScoreLabel
@onready var status_label: Label = $UI/TopBar/StatusLabel
@onready var game_over_layer: Control = $UI/GameOverLayer
@onready var result_label: Label = $UI/GameOverLayer/ResultLabel
@onready var score_result_label: Label = $UI/GameOverLayer/ScoreResultLabel
@onready var restart_button: Button = $UI/GameOverLayer/RestartButton
@onready var top_exit_button: Button = $UI/TopBar/ExitButton
@onready var gameover_exit_button: Button = $UI/GameOverLayer/ExitButton

var throws_remaining: int = THROWS_PER_ROUND
var score: int = 0

# True only while waiting for the player's next drag+release; false during
# the countdown, the throw-travel animation, the result pause, and after the
# round ends.
var is_accepting_input: bool = false

var drag_active: bool = false
var drag_current: Vector2 = ANCHOR_POS

var ring_visible: bool = false
var ring_pos: Vector2 = ANCHOR_POS

# Bumped each _start_game()/_end_game()/exit so a stale await (countdown or
# throw-travel tween) from an abandoned round can't corrupt a new one. Same
# pattern as every other minigame in this repo.
var round_token: int = 0

func _ready() -> void:
	randomize()
	restart_button.pressed.connect(_start_game)
	top_exit_button.pressed.connect(_on_exit_pressed)
	gameover_exit_button.pressed.connect(_on_exit_pressed)
	_start_game()

func _start_game() -> void:
	round_token += 1
	var token := round_token
	throws_remaining = THROWS_PER_ROUND
	score = 0
	is_accepting_input = false
	drag_active = false
	ring_visible = false
	game_over_layer.visible = false
	_update_labels()
	queue_redraw()
	await _run_ready_countdown(token)
	if token != round_token:
		return
	is_accepting_input = true
	status_label.text = "Pull back & release!"

func _run_ready_countdown(token: int) -> void:
	for step_text in READY_COUNTDOWN:
		status_label.text = step_text
		await get_tree().create_timer(READY_STEP_DURATION).timeout
		if token != round_token:
			return

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventScreenTouch:
		if event.pressed:
			_try_start_drag(event.position)
		elif drag_active:
			_end_drag(event.position)
	elif event is InputEventScreenDrag:
		if drag_active:
			drag_current = event.position
			queue_redraw()
	elif event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		if event.pressed:
			_try_start_drag(event.position)
		elif drag_active:
			_end_drag(event.position)
	elif event is InputEventMouseMotion:
		if drag_active:
			drag_current = event.position
			queue_redraw()

func _try_start_drag(pos: Vector2) -> void:
	if not is_accepting_input:
		return
	if pos.distance_to(ANCHOR_POS) > PRESS_ANCHOR_RADIUS:
		return
	drag_active = true
	drag_current = pos
	queue_redraw()

func _end_drag(pos: Vector2) -> void:
	drag_active = false
	queue_redraw()
	_attempt_throw(pos)

func _attempt_throw(release_pos: Vector2) -> void:
	if not is_accepting_input or throws_remaining <= 0:
		return
	# Slingshot-style: the throw goes opposite the drag.
	var throw_vector: Vector2 = ANCHOR_POS - release_pos
	if throw_vector.length() < SWIPE_MIN_DISTANCE:
		return
	_do_throw(throw_vector)

func _do_throw(throw_vector: Vector2) -> void:
	is_accepting_input = false
	var power: float = clamp(throw_vector.length(), MIN_DRAG, MAX_DRAG)
	var direction: Vector2 = throw_vector.normalized()
	var landing_distance: float = remap(power, MIN_DRAG, MAX_DRAG, MIN_LANDING, MAX_LANDING)
	var landing_pos: Vector2 = ANCHOR_POS + direction * landing_distance

	# straightness = 1.0 for a dead-straight-up pull (direction.y == -1 in
	# Godot's -y-is-up coordinate space), down to 0.0 for a level/sideways
	# pull. Scatter shrinks as straightness rises.
	var straightness: float = clampf(-direction.y, 0.0, 1.0)
	var scatter_magnitude: float = lerpf(SCATTER_MAX, SCATTER_MIN, straightness)
	landing_pos += Vector2(
		randf_range(-scatter_magnitude, scatter_magnitude),
		randf_range(-scatter_magnitude, scatter_magnitude)
	)

	throws_remaining -= 1
	status_label.text = "Throwing..."
	_update_labels()

	var token := round_token
	ring_visible = true
	ring_pos = ANCHOR_POS
	queue_redraw()
	await _animate_ring(landing_pos)
	if token != round_token:
		return

	_resolve_throw(landing_pos)
	if token != round_token:
		return

	await get_tree().create_timer(RESULT_PAUSE_DURATION).timeout
	if token != round_token:
		return

	ring_visible = false
	queue_redraw()
	if throws_remaining <= 0:
		_end_game()
	else:
		is_accepting_input = true
		status_label.text = "Pull back & release!"

func _animate_ring(target: Vector2) -> void:
	var tween := create_tween()
	tween.tween_method(_set_ring_pos, ANCHOR_POS, target, THROW_TRAVEL_DURATION)
	await tween.finished

func _set_ring_pos(p: Vector2) -> void:
	ring_pos = p
	queue_redraw()

func _resolve_throw(landing_pos: Vector2) -> void:
	var hit_value := 0
	for peg in PEGS:
		var peg_pos: Vector2 = ANCHOR_POS + Vector2(0.0, -1.0) * peg["distance"]
		if landing_pos.distance_to(peg_pos) <= peg["radius"]:
			hit_value = max(hit_value, int(peg["value"]))
	if hit_value > 0:
		score += hit_value
		status_label.text = "Hit! +%d" % hit_value
	else:
		status_label.text = "Miss"
	_update_labels()
	queue_redraw()

func _end_game() -> void:
	is_accepting_input = false
	round_token += 1
	var won: bool = score >= WIN_SCORE
	result_label.text = "Ring Master!" if won else "Round Over"
	score_result_label.text = "Score: %d" % score
	game_over_layer.visible = true
	_notify_host_complete()

func _on_exit_pressed() -> void:
	is_accepting_input = false
	drag_active = false
	round_token += 1
	_notify_host_complete()

func _notify_host_complete() -> void:
	# Lets the React MinigameOverlay know the round is over (win, round-over,
	# or a manual exit) so it can close the iframe. No-op outside a web export
	# or when there's no parent frame listening.
	if OS.has_feature("web"):
		JavaScriptBridge.eval("window.parent.postMessage({ type: 'minigame-complete', game: 'digital_ring_toss' }, '*');")

func _update_labels() -> void:
	throws_label.text = "Throws: %d" % throws_remaining
	score_label.text = "Score: %d" % score

func _draw() -> void:
	draw_rect(Rect2(Vector2(0, PLAY_TOP), Vector2(VIEWPORT_WIDTH, VIEWPORT_HEIGHT - PLAY_TOP)), Color(0.14, 0.18, 0.16), true)

	var font := ThemeDB.fallback_font
	var font_size := ThemeDB.fallback_font_size
	for peg in PEGS:
		var peg_pos: Vector2 = ANCHOR_POS + Vector2(0.0, -1.0) * float(peg["distance"])
		var radius: float = peg["radius"]
		draw_circle(peg_pos, radius, peg["color"])
		draw_circle(peg_pos, radius, Color(0, 0, 0, 0.35), false, 2.0, true)
		var text: String = str(int(peg["value"]))
		var text_size: Vector2 = font.get_string_size(text, HORIZONTAL_ALIGNMENT_CENTER, -1, font_size)
		draw_string(font, peg_pos + Vector2(-text_size.x / 2.0, text_size.y * 0.35), text, HORIZONTAL_ALIGNMENT_CENTER, -1, font_size, Color(1, 1, 1))

	# Anchor marker.
	draw_circle(ANCHOR_POS, 8.0, Color(0.85, 0.75, 0.3))

	# Slingshot pull-back visual: a line from the anchor to the current drag
	# point, drawn while the drag is held.
	if drag_active:
		draw_line(ANCHOR_POS, drag_current, Color(0.9, 0.9, 0.9), 3.0)
		draw_circle(drag_current, 6.0, Color(0.9, 0.9, 0.9))

	# The ring in flight, drawn as a simple outlined circle.
	if ring_visible:
		draw_circle(ring_pos, 14.0, Color(0.95, 0.5, 0.15), false, 4.0, true)
