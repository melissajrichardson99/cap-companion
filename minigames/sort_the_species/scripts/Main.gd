extends Node2D

# Sort the Species deliberately reuses Obstacle Dodge's "Auto-Scroll" engine
# pattern: continuous float positions + Rect2/threshold checks, a plain
# `Array` of dicts drawn every frame via `_draw()` (no per-item scene nodes),
# and the same LANE_COUNT/LANE_WIDTH/_lane_x lane math. The twist here is that
# falling items are player-draggable in x (not lane-locked like the obstacles)
# while y always advances on its own regardless of drag state.

const LANE_COUNT := 3
const VIEWPORT_WIDTH := 400.0
const VIEWPORT_HEIGHT := 600.0
const LANE_WIDTH := VIEWPORT_WIDTH / LANE_COUNT
const PLAY_TOP := 60.0
const PLAY_BOTTOM := 500.0
const BIN_TOP := PLAY_BOTTOM
const BIN_BOTTOM := VIEWPORT_HEIGHT

const ITEM_RADIUS := 18.0
const BIN_ICON_RADIUS := 24.0
const BIN_ICON_Y := BIN_TOP + 34.0

const FALL_SPEED := 140.0
const SPAWN_INTERVAL := 2.6
const GRAB_RADIUS := 42.0

const TARGET_CORRECT := 8
const MAX_MISSES := 4

const READY_COUNTDOWN := ["Ready?", "3", "2", "1", "Go!"]
const READY_STEP_DURATION := 0.5

# Godot's default font (used by the Web export) has no emoji glyphs -
# confirmed elsewhere in this repo (Card Flip Pairs / project memory) as a
# "tofu" missing-glyph box in the HTML5 export. Every species icon here is a
# procedurally-drawn shape+color silhouette via draw_circle/draw_polygon,
# same convention as Card Flip Pairs and Obstacle Dodge's player sprite.
const SPECIES_POOL := ["Capybara", "Alpaca", "Chicken"]

@onready var spawn_timer: Timer = $SpawnTimer
@onready var correct_label: Label = $UI/TopBar/CorrectLabel
@onready var missed_label: Label = $UI/TopBar/MissedLabel
@onready var status_label: Label = $UI/TopBar/StatusLabel
@onready var top_exit_button: Button = $UI/TopBar/ExitButton
@onready var bin_labels: Array[Label] = [$UI/Bins/BinLabel0, $UI/Bins/BinLabel1, $UI/Bins/BinLabel2]
@onready var game_over_layer: Control = $UI/GameOverLayer
@onready var result_label: Label = $UI/GameOverLayer/ResultLabel
@onready var score_result_label: Label = $UI/GameOverLayer/ScoreResultLabel
@onready var restart_button: Button = $UI/GameOverLayer/RestartButton
@onready var gameover_exit_button: Button = $UI/GameOverLayer/ExitButton

# Each entry: {"lane": int (spawn lane, informational only), "x": float,
# "y": float, "species": String}. Data-driven and drawn via _draw(), same
# convention as Obstacle Dodge's `obstacles` array — no per-item scene nodes.
var items: Array = []

# bin_species[lane] is the species assigned to that lane's bin for the round,
# shuffled once at _start_game() from SPECIES_POOL.
var bin_species: Array = ["", "", ""]

# Index into `items` of the currently-held (dragged) item, or -1 if none.
# Always mutated through _remove_item() below so a mid-frame prune can't
# leave this pointing at the wrong array slot after other items shift down.
var held_index: int = -1

var correct_count: int = 0
var missed_count: int = 0
var is_running: bool = false

# Bumped each round start/end so a stale ready-countdown await from an
# abandoned round can't start spawning on top of a new one. Same pattern as
# every other minigame in this repo (Obstacle Dodge, Mini Platformer, etc).
var round_token: int = 0

func _ready() -> void:
	randomize()
	spawn_timer.wait_time = SPAWN_INTERVAL
	spawn_timer.timeout.connect(_spawn_item)
	restart_button.pressed.connect(_start_game)
	top_exit_button.pressed.connect(_on_exit_pressed)
	gameover_exit_button.pressed.connect(_on_exit_pressed)
	_start_game()

func _lane_x(lane: int) -> float:
	return (lane + 0.5) * LANE_WIDTH

func _lane_from_x(x: float) -> int:
	return clampi(int(x / LANE_WIDTH), 0, LANE_COUNT - 1)

func _start_game() -> void:
	round_token += 1
	var token := round_token
	is_running = false
	spawn_timer.stop()
	items.clear()
	held_index = -1
	correct_count = 0
	missed_count = 0
	game_over_layer.visible = false
	_shuffle_bin_species()
	_update_labels()
	status_label.text = "Ready?"
	queue_redraw()
	await _run_ready_countdown(token)
	if token != round_token:
		return
	is_running = true
	status_label.text = "Sort!"
	spawn_timer.start()

func _run_ready_countdown(token: int) -> void:
	for step_text in READY_COUNTDOWN:
		status_label.text = step_text
		await get_tree().create_timer(READY_STEP_DURATION).timeout
		if token != round_token:
			return

func _shuffle_bin_species() -> void:
	var pool: Array = SPECIES_POOL.duplicate()
	pool.shuffle()
	bin_species = pool
	for lane in range(LANE_COUNT):
		bin_labels[lane].text = bin_species[lane]

func _spawn_item() -> void:
	if not is_running:
		return
	var species: String = SPECIES_POOL[randi() % SPECIES_POOL.size()]
	var x: float = randf_range(ITEM_RADIUS, VIEWPORT_WIDTH - ITEM_RADIUS)
	var spawn_lane: int = _lane_from_x(x)
	items.append({"lane": spawn_lane, "x": x, "y": PLAY_TOP - ITEM_RADIUS, "species": species})

func _physics_process(delta: float) -> void:
	if not is_running:
		return
	for i in range(items.size() - 1, -1, -1):
		var item: Dictionary = items[i]
		item["y"] += FALL_SPEED * delta
		items[i] = item
		if item["y"] - ITEM_RADIUS > PLAY_BOTTOM:
			_evaluate_item(i)
			if not is_running:
				return
	queue_redraw()

func _evaluate_item(i: int) -> void:
	var item: Dictionary = items[i]
	var lane := _lane_from_x(item["x"])
	if bin_species[lane] == item["species"]:
		correct_count += 1
	else:
		missed_count += 1
	_remove_item(i)
	_update_labels()
	if correct_count >= TARGET_CORRECT:
		_end_game(true)
	elif missed_count >= MAX_MISSES:
		_end_game(false)

# Centralizes array removal + held_index bookkeeping. Removing index i shifts
# every later item down by one slot, so held_index must be adjusted the same
# way whenever it points past i — otherwise a drag held on a later item could
# silently start tracking the wrong dictionary after an earlier item is
# pruned out from under it.
func _remove_item(i: int) -> void:
	items.remove_at(i)
	if held_index == i:
		held_index = -1
	elif held_index > i:
		held_index -= 1

func _try_grab(pos: Vector2) -> void:
	if not is_running:
		return
	var best_index := -1
	var best_dist := GRAB_RADIUS
	for i in range(items.size()):
		var item: Dictionary = items[i]
		var d: float = Vector2(item["x"], item["y"]).distance_to(pos)
		if d <= best_dist:
			best_dist = d
			best_index = i
	held_index = best_index

func _drag_held_item(pointer_x: float) -> void:
	if held_index < 0 or held_index >= items.size():
		held_index = -1
		return
	var item: Dictionary = items[held_index]
	item["x"] = clampf(pointer_x, ITEM_RADIUS, VIEWPORT_WIDTH - ITEM_RADIUS)
	items[held_index] = item
	queue_redraw()

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventScreenTouch:
		if event.pressed:
			_try_grab(event.position)
		else:
			held_index = -1
	elif event is InputEventScreenDrag:
		if held_index != -1:
			_drag_held_item(event.position.x)
	elif event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		if event.pressed:
			_try_grab(event.position)
		else:
			held_index = -1
	elif event is InputEventMouseMotion:
		if held_index != -1 and (event.button_mask & MOUSE_BUTTON_MASK_LEFT) != 0:
			_drag_held_item(event.position.x)

func _end_game(won: bool) -> void:
	if not is_running:
		return
	is_running = false
	round_token += 1
	spawn_timer.stop()
	held_index = -1
	if won:
		result_label.text = "Great Sorting!"
	else:
		result_label.text = "Too Many Missed"
	score_result_label.text = "Sorted %d correctly, missed %d" % [correct_count, missed_count]
	game_over_layer.visible = true
	_notify_host_complete()

func _on_exit_pressed() -> void:
	is_running = false
	round_token += 1
	spawn_timer.stop()
	held_index = -1
	_notify_host_complete()

func _notify_host_complete() -> void:
	# Lets the React MinigameOverlay know the round is over (win, loss, or a
	# manual exit) so it can close the iframe. No-op outside a web export or
	# when there's no parent frame listening.
	if OS.has_feature("web"):
		JavaScriptBridge.eval("window.parent.postMessage({ type: 'minigame-complete', game: 'sort_the_species' }, '*');")

func _update_labels() -> void:
	correct_label.text = "Correct: %d" % correct_count
	missed_label.text = "Missed: %d / %d" % [missed_count, MAX_MISSES]

func _draw() -> void:
	draw_rect(Rect2(Vector2(0, PLAY_TOP), Vector2(VIEWPORT_WIDTH, PLAY_BOTTOM - PLAY_TOP)), Color(0.16, 0.14, 0.2), true)
	for lane in range(1, LANE_COUNT):
		var x: float = lane * LANE_WIDTH
		draw_line(Vector2(x, PLAY_TOP), Vector2(x, BIN_BOTTOM), Color(0.4, 0.38, 0.45), 2.0)

	for lane in range(LANE_COUNT):
		var bin_rect := Rect2(Vector2(lane * LANE_WIDTH, BIN_TOP), Vector2(LANE_WIDTH, BIN_BOTTOM - BIN_TOP))
		draw_rect(bin_rect, Color(0.22, 0.22, 0.28), true)
		_draw_species_icon(bin_species[lane], Vector2(_lane_x(lane), BIN_ICON_Y), BIN_ICON_RADIUS)

	for item in items:
		_draw_species_icon(item["species"], Vector2(item["x"], item["y"]), ITEM_RADIUS)

func _draw_species_icon(species: String, pos: Vector2, r: float) -> void:
	match species:
		"Capybara":
			# Round tan blob with two small darker ears.
			draw_circle(pos, r, Color(0.72, 0.58, 0.38))
			draw_circle(pos + Vector2(-r * 0.6, -r * 0.75), r * 0.32, Color(0.55, 0.42, 0.28))
			draw_circle(pos + Vector2(r * 0.6, -r * 0.75), r * 0.32, Color(0.55, 0.42, 0.28))
		"Alpaca":
			# White/cream body with two triangular pointed ears on top.
			draw_circle(pos, r, Color(0.95, 0.93, 0.88))
			var ear_l := PackedVector2Array([pos + Vector2(-r * 0.55, -r * 0.5), pos + Vector2(-r * 0.85, -r * 1.35), pos + Vector2(-r * 0.15, -r * 0.85)])
			var ear_r := PackedVector2Array([pos + Vector2(r * 0.55, -r * 0.5), pos + Vector2(r * 0.85, -r * 1.35), pos + Vector2(r * 0.15, -r * 0.85)])
			draw_polygon(ear_l, PackedColorArray([Color(0.85, 0.8, 0.72)]))
			draw_polygon(ear_r, PackedColorArray([Color(0.85, 0.8, 0.72)]))
		"Chicken":
			# Small orange diamond body with a red comb triangle on top.
			var diamond := PackedVector2Array([pos + Vector2(0, -r), pos + Vector2(r, 0), pos + Vector2(0, r), pos + Vector2(-r, 0)])
			draw_polygon(diamond, PackedColorArray([Color(0.95, 0.55, 0.15)]))
			var comb := PackedVector2Array([pos + Vector2(-r * 0.25, -r), pos + Vector2(r * 0.25, -r), pos + Vector2(0, -r * 1.6)])
			draw_polygon(comb, PackedColorArray([Color(0.85, 0.2, 0.2)]))
		_:
			draw_circle(pos, r, Color(0.6, 0.6, 0.6))
