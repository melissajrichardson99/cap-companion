extends Node2D

enum Critter { NONE, CAPYBARA, DECOY }

const ROUND_DURATION := 30.0
const SPAWN_INTERVAL_MIN := 0.45
const SPAWN_INTERVAL_MAX := 0.95
const SHOW_DURATION_MIN := 0.65
const SHOW_DURATION_MAX := 1.05
const DECOY_CHANCE := 0.25

const IDLE_COLOR := Color(0.4, 0.32, 0.22)
const CAPYBARA_COLOR := Color(0.78, 0.58, 0.32)
const DECOY_COLOR := Color(0.75, 0.25, 0.55)

@onready var score_label: Label = $UI/TopBar/ScoreLabel
@onready var time_label: Label = $UI/TopBar/TimeLabel
@onready var hole_grid: GridContainer = $UI/HoleGrid
@onready var game_over_layer: Control = $UI/GameOverLayer
@onready var result_label: Label = $UI/GameOverLayer/ResultLabel
@onready var score_result_label: Label = $UI/GameOverLayer/ScoreResultLabel
@onready var restart_button: Button = $UI/GameOverLayer/RestartButton
@onready var top_exit_button: Button = $UI/TopBar/ExitButton
@onready var gameover_exit_button: Button = $UI/GameOverLayer/ExitButton

var holes: Array[Button] = []
var hole_state: Array[Critter] = []
var hole_hide_at: Array[float] = []

var score: int = 0
var is_running: bool = false
var time_left: float = ROUND_DURATION
var spawn_cooldown: float = 0.0
var game_clock: float = 0.0

func _ready() -> void:
	randomize()
	holes.assign(hole_grid.get_children())
	for i in range(holes.size()):
		hole_state.append(Critter.NONE)
		hole_hide_at.append(-1.0)
		var idx := i
		holes[i].pressed.connect(func(): _on_hole_pressed(idx))
	restart_button.pressed.connect(_start_game)
	top_exit_button.pressed.connect(_on_exit_pressed)
	gameover_exit_button.pressed.connect(_on_exit_pressed)
	_start_game()

func _start_game() -> void:
	score = 0
	time_left = ROUND_DURATION
	game_clock = 0.0
	spawn_cooldown = randf_range(SPAWN_INTERVAL_MIN, SPAWN_INTERVAL_MAX)
	is_running = true
	game_over_layer.visible = false
	for i in range(holes.size()):
		_set_hole_state(i, Critter.NONE)
	_update_labels()

func _process(delta: float) -> void:
	if not is_running:
		return
	game_clock += delta
	time_left -= delta
	if time_left <= 0.0:
		time_left = 0.0
		_update_labels()
		_end_game()
		return

	for i in range(holes.size()):
		if hole_state[i] != Critter.NONE and hole_hide_at[i] >= 0.0 and game_clock >= hole_hide_at[i]:
			_set_hole_state(i, Critter.NONE)

	spawn_cooldown -= delta
	if spawn_cooldown <= 0.0:
		spawn_cooldown = randf_range(SPAWN_INTERVAL_MIN, SPAWN_INTERVAL_MAX)
		_spawn_critter()

	_update_labels()

func _spawn_critter() -> void:
	var empty_indices: Array[int] = []
	for i in range(holes.size()):
		if hole_state[i] == Critter.NONE:
			empty_indices.append(i)
	if empty_indices.is_empty():
		return
	var chosen: int = empty_indices[randi() % empty_indices.size()]
	var critter: Critter = Critter.DECOY if randf() < DECOY_CHANCE else Critter.CAPYBARA
	_set_hole_state(chosen, critter)
	hole_hide_at[chosen] = game_clock + randf_range(SHOW_DURATION_MIN, SHOW_DURATION_MAX)

func _set_hole_state(index: int, critter: Critter) -> void:
	hole_state[index] = critter
	if critter == Critter.NONE:
		hole_hide_at[index] = -1.0
	var button := holes[index]
	match critter:
		Critter.NONE:
			button.text = ""
			button.modulate = IDLE_COLOR
		Critter.CAPYBARA:
			button.text = "CAPY"
			button.modulate = CAPYBARA_COLOR
		Critter.DECOY:
			button.text = "?!"
			button.modulate = DECOY_COLOR

func _on_hole_pressed(index: int) -> void:
	if not is_running:
		return
	if hole_state[index] == Critter.CAPYBARA:
		score += 1
		_set_hole_state(index, Critter.NONE)
		_update_labels()
	elif hole_state[index] == Critter.DECOY:
		# Decoys never score, whether tapped or left alone.
		_set_hole_state(index, Critter.NONE)

func _end_game() -> void:
	is_running = false
	result_label.text = "Time's Up!"
	score_result_label.text = "Capybaras caught: %d" % score
	game_over_layer.visible = true
	_notify_host_complete()

func _on_exit_pressed() -> void:
	is_running = false
	_notify_host_complete()

func _notify_host_complete() -> void:
	# Lets the React MinigameOverlay know the round is over (finished timer or
	# a manual exit) so it can close the iframe. No-op outside a web export or
	# when there's no parent frame listening.
	if OS.has_feature("web"):
		JavaScriptBridge.eval("window.parent.postMessage({ type: 'minigame-complete', game: 'whack_a_capybara' }, '*');")

func _update_labels() -> void:
	score_label.text = "Score: %d" % score
	time_label.text = "Time: %d" % ceili(time_left)
