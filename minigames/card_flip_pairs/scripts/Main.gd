extends Node2D

const PAIR_COUNT := 8
const CARD_COUNT := 16

const BACK_COLOR := Color(0.3, 0.32, 0.4)
const BACK_ACCENT_COLOR := Color(0.38, 0.4, 0.5)
const BACK_STRIPE_PERIOD := 16
const ICON_SIZE := 80

# Godot's default font (used by the Web export) has no glyphs for emoji
# codepoints - verified via Playwright screenshot, where Button.text set to
# an animal emoji rendered as a "U+1F418"-style missing-glyph box, not a
# picture. Rather than bundle an emoji-capable font as a new asset, each
# park-animal "face" is a distinct procedurally-drawn shape+color icon
# (matches the 8-pair spec in CAP_Companion_App_TechSpec.md; still a
# placeholder pending real animal art).
const FACE_SHAPES := ["circle", "square", "diamond", "tri_up", "tri_down", "ring", "cross", "square_ring"]
const FACE_COLORS := [
	Color(0.85, 0.35, 0.35),
	Color(0.35, 0.65, 0.85),
	Color(0.4, 0.75, 0.45),
	Color(0.9, 0.7, 0.3),
	Color(0.65, 0.45, 0.85),
	Color(0.9, 0.5, 0.7),
	Color(0.45, 0.8, 0.8),
	Color(0.75, 0.55, 0.35),
]

@onready var pairs_label: Label = $UI/TopBar/PairsLabel
@onready var card_grid: GridContainer = $UI/CardGrid
@onready var mismatch_timer: Timer = $MismatchTimer
@onready var game_over_layer: Control = $UI/GameOverLayer
@onready var result_label: Label = $UI/GameOverLayer/ResultLabel
@onready var score_result_label: Label = $UI/GameOverLayer/ScoreResultLabel
@onready var restart_button: Button = $UI/GameOverLayer/RestartButton
@onready var top_exit_button: Button = $UI/TopBar/ExitButton
@onready var gameover_exit_button: Button = $UI/GameOverLayer/ExitButton

var cards: Array[Button] = []
var values: Array[int] = []
var matched: Array[bool] = []
var revealed: Array[int] = []

var pairs_found: int = 0
var is_running: bool = false
var busy: bool = false
var back_texture: ImageTexture
var face_textures: Array[ImageTexture] = []

func _ready() -> void:
	randomize()
	back_texture = _make_back_texture()
	face_textures.clear()
	for i in range(FACE_SHAPES.size()):
		face_textures.append(_make_face_texture(FACE_SHAPES[i], FACE_COLORS[i]))
	cards.assign(card_grid.get_children())
	for i in range(cards.size()):
		var idx := i
		cards[i].pressed.connect(func(): _on_card_pressed(idx))
		cards[i].expand_icon = true
	mismatch_timer.timeout.connect(_on_mismatch_timeout)
	restart_button.pressed.connect(_start_game)
	top_exit_button.pressed.connect(_on_exit_pressed)
	gameover_exit_button.pressed.connect(_on_exit_pressed)
	_start_game()

func _make_back_texture() -> ImageTexture:
	# Simple diagonal-stripe pattern so the card backs read as a designed
	# back rather than a bare color rect. No external art asset needed.
	var image := Image.create(ICON_SIZE, ICON_SIZE, false, Image.FORMAT_RGBA8)
	for y in range(ICON_SIZE):
		for x in range(ICON_SIZE):
			var on_stripe := (x + y) % BACK_STRIPE_PERIOD < BACK_STRIPE_PERIOD / 2
			image.set_pixel(x, y, BACK_ACCENT_COLOR if on_stripe else BACK_COLOR)
	return ImageTexture.create_from_image(image)

func _make_face_texture(shape: String, color: Color) -> ImageTexture:
	var image := Image.create(ICON_SIZE, ICON_SIZE, false, Image.FORMAT_RGBA8)
	var cx := ICON_SIZE / 2.0
	var cy := ICON_SIZE / 2.0
	var r := ICON_SIZE / 2.0 - ICON_SIZE * 0.14
	for y in range(ICON_SIZE):
		for x in range(ICON_SIZE):
			var px := x + 0.5
			var py := y + 0.5
			if _shape_contains(shape, px, py, cx, cy, r):
				image.set_pixel(x, y, color)
			else:
				image.set_pixel(x, y, Color(0, 0, 0, 0))
	return ImageTexture.create_from_image(image)

func _shape_contains(shape: String, px: float, py: float, cx: float, cy: float, r: float) -> bool:
	var dx := px - cx
	var dy := py - cy
	match shape:
		"circle":
			return dx * dx + dy * dy <= r * r
		"square":
			return abs(dx) <= r * 0.85 and abs(dy) <= r * 0.85
		"diamond":
			return abs(dx) + abs(dy) <= r
		"tri_up":
			return _point_in_triangle(px, py, cx, cy - r, cx - r, cy + r * 0.8, cx + r, cy + r * 0.8)
		"tri_down":
			return _point_in_triangle(px, py, cx, cy + r, cx - r, cy - r * 0.8, cx + r, cy - r * 0.8)
		"ring":
			var dist_sq := dx * dx + dy * dy
			return dist_sq <= r * r and dist_sq >= (r * 0.55) * (r * 0.55)
		"cross":
			return abs(dx) <= r * 0.3 or abs(dy) <= r * 0.3
		"square_ring":
			return (abs(dx) <= r * 0.85 and abs(dy) <= r * 0.85) and not (abs(dx) <= r * 0.45 and abs(dy) <= r * 0.45)
		_:
			return false

func _point_in_triangle(px: float, py: float, ax: float, ay: float, bx: float, by: float, cx2: float, cy2: float) -> bool:
	var d1 := _triangle_sign(px, py, ax, ay, bx, by)
	var d2 := _triangle_sign(px, py, bx, by, cx2, cy2)
	var d3 := _triangle_sign(px, py, cx2, cy2, ax, ay)
	var has_neg := d1 < 0 or d2 < 0 or d3 < 0
	var has_pos := d1 > 0 or d2 > 0 or d3 > 0
	return not (has_neg and has_pos)

func _triangle_sign(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
	return (px - bx) * (ay - by) - (ax - bx) * (py - by)

func _start_game() -> void:
	pairs_found = 0
	busy = false
	is_running = true
	game_over_layer.visible = false
	mismatch_timer.stop()
	revealed.clear()
	matched.clear()
	matched.resize(CARD_COUNT)
	matched.fill(false)
	_shuffle_values()
	for i in range(cards.size()):
		_render_card(i)
	_update_labels()

func _shuffle_values() -> void:
	values.clear()
	for pair_index in range(PAIR_COUNT):
		values.append(pair_index)
		values.append(pair_index)
	# Fisher-Yates, matching the uniform-draw approach used elsewhere in this repo.
	for i in range(values.size() - 1, 0, -1):
		var j := randi() % (i + 1)
		var tmp: int = values[i]
		values[i] = values[j]
		values[j] = tmp

func _on_card_pressed(index: int) -> void:
	if not is_running or busy:
		return
	if matched[index] or revealed.has(index):
		return
	if revealed.size() >= 2:
		return
	revealed.append(index)
	_render_card(index)
	if revealed.size() == 2:
		if values[revealed[0]] == values[revealed[1]]:
			matched[revealed[0]] = true
			matched[revealed[1]] = true
			pairs_found += 1
			revealed.clear()
			_update_labels()
			if pairs_found >= PAIR_COUNT:
				_end_game()
		else:
			busy = true
			mismatch_timer.start()

func _on_mismatch_timeout() -> void:
	# revealed must be cleared BEFORE re-rendering: _render_card treats any
	# index still in `revealed` as face-up, so rendering first and clearing
	# after (the previous order here) left mismatched cards stuck revealed.
	var to_hide := revealed.duplicate()
	revealed.clear()
	for index in to_hide:
		_render_card(index)
	busy = false

func _render_card(index: int) -> void:
	var button := cards[index]
	button.modulate = Color(1, 1, 1)
	if matched[index] or revealed.has(index):
		button.icon = face_textures[values[index]]
	else:
		button.icon = back_texture

func _end_game() -> void:
	is_running = false
	result_label.text = "You Win!"
	score_result_label.text = "All %d pairs found!" % PAIR_COUNT
	game_over_layer.visible = true
	_notify_host_complete()

func _on_exit_pressed() -> void:
	is_running = false
	mismatch_timer.stop()
	_notify_host_complete()

func _notify_host_complete() -> void:
	# Lets the React MinigameOverlay know the round is over (all pairs found or
	# a manual exit) so it can close the iframe. No-op outside a web export or
	# when there's no parent frame listening.
	if OS.has_feature("web"):
		JavaScriptBridge.eval("window.parent.postMessage({ type: 'minigame-complete', game: 'card_flip_pairs' }, '*');")

func _update_labels() -> void:
	pairs_label.text = "Pairs: %d / %d" % [pairs_found, PAIR_COUNT]
