extends Node2D

const TARGET_LENGTH := 8
const PRE_DELAY := 0.6
const SHOW_DURATION := 0.55
const GAP_DURATION := 0.25
const ROUND_GAP := 0.9
const TAP_FLASH_DURATION := 0.15

const ANIMAL_NAMES := ["COW", "PIG", "HEN", "EWE"]
const IDLE_COLORS := [
	Color(0.55, 0.55, 0.5),
	Color(0.55, 0.35, 0.4),
	Color(0.55, 0.45, 0.25),
	Color(0.5, 0.5, 0.58),
]
const LIT_COLORS := [
	Color(0.95, 0.95, 0.88),
	Color(0.95, 0.55, 0.65),
	Color(0.95, 0.78, 0.3),
	Color(0.82, 0.85, 0.98),
]

@onready var score_label: Label = $UI/TopBar/ScoreLabel
@onready var status_label: Label = $UI/TopBar/StatusLabel
@onready var animal_buttons: Array = [
	$UI/AnimalGrid/BtnCow,
	$UI/AnimalGrid/BtnPig,
	$UI/AnimalGrid/BtnHen,
	$UI/AnimalGrid/BtnEwe,
]
@onready var game_over_layer: Control = $UI/GameOverLayer
@onready var result_label: Label = $UI/GameOverLayer/ResultLabel
@onready var score_result_label: Label = $UI/GameOverLayer/ScoreResultLabel
@onready var restart_button: Button = $UI/GameOverLayer/RestartButton
@onready var top_exit_button: Button = $UI/TopBar/ExitButton
@onready var gameover_exit_button: Button = $UI/GameOverLayer/ExitButton

var sequence: Array[int] = []
var player_step: int = 0
var is_running: bool = false
var is_input_enabled: bool = false
# Bumped each time a new round starts so stale awaits from a previous
# round (or a round abandoned via exit/restart) can detect they're outdated
# and bail out instead of resuming stale playback/input state.
var round_token: int = 0

func _ready() -> void:
	randomize()
	for i in range(animal_buttons.size()):
		var idx := i
		var button: Button = animal_buttons[i]
		button.text = ANIMAL_NAMES[i]
		button.pressed.connect(func(): _on_animal_pressed(idx))
	restart_button.pressed.connect(_start_game)
	top_exit_button.pressed.connect(_on_exit_pressed)
	gameover_exit_button.pressed.connect(_on_exit_pressed)
	_start_game()

func _start_game() -> void:
	round_token += 1
	sequence.clear()
	player_step = 0
	is_running = true
	is_input_enabled = false
	game_over_layer.visible = false
	for i in range(animal_buttons.size()):
		_set_button_lit(i, false)
	sequence.append(randi() % ANIMAL_NAMES.size())
	_update_labels()
	_play_sequence(round_token)

func _play_sequence(token: int) -> void:
	is_input_enabled = false
	status_label.text = "Watch..."
	await get_tree().create_timer(PRE_DELAY).timeout
	if token != round_token or not is_running:
		return
	for step in sequence:
		_set_button_lit(step, true)
		await get_tree().create_timer(SHOW_DURATION).timeout
		if token != round_token or not is_running:
			return
		_set_button_lit(step, false)
		await get_tree().create_timer(GAP_DURATION).timeout
		if token != round_token or not is_running:
			return
	player_step = 0
	is_input_enabled = true
	status_label.text = "Your turn!"

func _on_animal_pressed(index: int) -> void:
	if not is_running or not is_input_enabled:
		return
	if index != sequence[player_step]:
		is_input_enabled = false
		_end_game(false)
		return
	is_input_enabled = false
	_set_button_lit(index, true)
	var token := round_token
	await get_tree().create_timer(TAP_FLASH_DURATION).timeout
	if token != round_token or not is_running:
		return
	_set_button_lit(index, false)
	player_step += 1
	if player_step < sequence.size():
		is_input_enabled = true
		return
	if sequence.size() >= TARGET_LENGTH:
		_end_game(true)
		return
	_update_labels()
	status_label.text = "Nice!"
	await get_tree().create_timer(ROUND_GAP).timeout
	if token != round_token or not is_running:
		return
	sequence.append(randi() % ANIMAL_NAMES.size())
	_play_sequence(token)

func _set_button_lit(index: int, lit: bool) -> void:
	var button: Button = animal_buttons[index]
	button.modulate = LIT_COLORS[index] if lit else IDLE_COLORS[index]

func _end_game(won: bool) -> void:
	is_running = false
	is_input_enabled = false
	round_token += 1
	result_label.text = "You Win!" if won else "Game Over"
	score_result_label.text = "Sequence reached: %d" % sequence.size()
	game_over_layer.visible = true
	_notify_host_complete()

func _on_exit_pressed() -> void:
	is_running = false
	is_input_enabled = false
	round_token += 1
	_notify_host_complete()

func _notify_host_complete() -> void:
	# Lets the React MinigameOverlay know the round is over (win, loss, or a
	# manual exit) so it can close the iframe. No-op outside a web export or
	# when there's no parent frame listening.
	if OS.has_feature("web"):
		JavaScriptBridge.eval("window.parent.postMessage({ type: 'minigame-complete', game: 'pattern_repeat' }, '*');")

func _update_labels() -> void:
	score_label.text = "Round: %d" % sequence.size()
