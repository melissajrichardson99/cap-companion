extends Node2D

const PAIR_COUNT := 8
const CARD_COUNT := 16
const ICON_SIZE := 80

# --- Layout rects (design canvas is 400x600, see project.godot). Purely
# cosmetic - mirrors mini_snake's SIGN_RECT/STATS_RECT-style layout consts.
const SIGN_RECT := Rect2(10, 10, 380, 56)
const INSTRUCTION_RECT := Rect2(10, 74, 380, 92)
const STAT_BOX_RECT := Rect2(206, 82, 164, 76)
const GRID_FRAME_RECT := Rect2(10, 174, 380, 364)
const TIP_RECT := Rect2(10, 546, 380, 50)

# --- Brand palette. Mirrors frontend/src/index.css's --cap-* tokens so this
# game's chrome reads as the same parchment/wood UI system as the rest of
# the app instead of a one-off style.
const COLOR_OUTLINE := Color("#14181a")
const COLOR_PARCHMENT := Color("#f0decc")
const COLOR_PAGE_BG := Color("#e8d9bb")
const COLOR_WOOD_LIGHT := Color("#a9773f")
const COLOR_WOOD_MID := Color("#8a5a2f")
const COLOR_WOOD_DARK := Color("#6e4523")
const COLOR_INK := Color("#1e2b2e")
const COLOR_HEADER_GREEN := Color("#144f05")
const COLOR_ADVENTURE_GREEN := Color("#3b7801")
const COLOR_SUNSET_ORANGE := Color("#f38630")
const COLOR_SUNSET_ORANGE_DEEP := Color("#bc6825")

# Real photo-style textures for each animal "face", matching the confirmed
# 8-pair park roster. Replaces the earlier procedurally-drawn silhouette
# placeholder art pass now that real cropped assets are staged in
# res://assets/.
const ANIMAL_NAMES := ["capybara", "kangaroo", "chicken", "porcupine", "alpaca", "sheep", "pig", "emu"]
const ANIMAL_TEXTURES := {
	"capybara": preload("res://assets/capybara.png"),
	"kangaroo": preload("res://assets/kangaroo.png"),
	"alpaca": preload("res://assets/alpaca.png"),
	"sheep": preload("res://assets/sheep.png"),
	"pig": preload("res://assets/pig.png"),
	"emu": preload("res://assets/emu.png"),
	"chicken": preload("res://assets/chicken.png"),
	"porcupine": preload("res://assets/porcupine.png"),
}

@onready var title_label: Label = $UI/SignBar/TitleLabel
@onready var instruction_label: Label = $UI/InstructionBar/InstructionLabel
@onready var stat_caption_label: Label = $UI/InstructionBar/StatBox/CaptionLabel
@onready var stat_value_label: Label = $UI/InstructionBar/StatBox/ValueLabel
@onready var tip_label: Label = $UI/TipBar/TipLabel
@onready var card_grid: GridContainer = $UI/CardGrid
@onready var mismatch_timer: Timer = $MismatchTimer
@onready var game_over_layer: Control = $UI/GameOverLayer
@onready var result_label: Label = $UI/GameOverLayer/ResultLabel
@onready var score_result_label: Label = $UI/GameOverLayer/ScoreResultLabel
@onready var restart_button: Button = $UI/GameOverLayer/RestartButton
@onready var top_exit_button: Button = $UI/SignBar/ExitButton
@onready var gameover_exit_button: Button = $UI/GameOverLayer/ExitButton

var cards: Array[Button] = []
var values: Array[int] = []
var matched: Array[bool] = []
var revealed: Array[int] = []

var pairs_found: int = 0
var is_running: bool = false
var busy: bool = false
var back_texture: ImageTexture
var face_textures: Array[Texture2D] = []

func _ready() -> void:
	randomize()
	back_texture = _make_back_texture()
	face_textures.clear()
	for i in range(ANIMAL_NAMES.size()):
		face_textures.append(ANIMAL_TEXTURES[ANIMAL_NAMES[i]])
	cards.assign(card_grid.get_children())
	for i in range(cards.size()):
		var idx := i
		cards[i].pressed.connect(func(): _on_card_pressed(idx))
		cards[i].expand_icon = true
	_style_ui()
	mismatch_timer.timeout.connect(_on_mismatch_timeout)
	restart_button.pressed.connect(_start_game)
	top_exit_button.pressed.connect(_on_exit_pressed)
	gameover_exit_button.pressed.connect(_on_exit_pressed)
	_start_game()

# ---------------------------------------------------------------------------
# Card back texture generation. The back is still a procedurally-drawn paw
# print built pixel-by-pixel into an Image/ImageTexture - unchanged. Card
# faces are now real photo PNGs loaded via ANIMAL_TEXTURES above instead of
# the earlier procedural silhouette generation.
# ---------------------------------------------------------------------------

func _make_back_texture() -> ImageTexture:
	# Wood-frame park badge: a circular wood-plank ring (outlined, banded
	# light/dark like _draw_wood_panel's fake grain highlight) around a
	# parchment-filled center, with a small leaf-sprig + paw-print crest in
	# adventure green. Built the same way as the previous flat paw-print
	# back - pixel-by-pixel circle/ellipse math into an Image - just with
	# more rings and a richer crest. Outside the badge stays transparent so
	# the button's own parchment/outline card style (see _style_ui) still
	# reads as the card's edge.
	var image := Image.create(ICON_SIZE, ICON_SIZE, false, Image.FORMAT_RGBA8)
	image.fill(Color(0, 0, 0, 0))
	var cx := ICON_SIZE / 2.0
	var cy := ICON_SIZE / 2.0

	var r_outer := ICON_SIZE * 0.48
	var r_wood_outer := r_outer - 2.0
	var r_wood_inner := r_wood_outer - 8.0
	var r_parchment := r_wood_inner - 2.0

	var crest_leaf_center := Vector2(cx, cy - r_parchment * 0.32)
	var crest_leaf_r := r_parchment * 0.62
	var crest_paw_center := Vector2(cx, cy + r_parchment * 0.3)
	var crest_paw_r := r_parchment * 0.5

	for y in range(ICON_SIZE):
		for x in range(ICON_SIZE):
			var px := x + 0.5
			var py := y + 0.5
			var d := Vector2(px - cx, py - cy).length()
			if d > r_outer:
				continue
			elif d > r_wood_outer:
				image.set_pixel(x, y, COLOR_OUTLINE)
			elif d > r_wood_inner:
				image.set_pixel(x, y, _wood_ring_color(px, py, cx, cy, r_outer))
			elif d > r_parchment:
				image.set_pixel(x, y, COLOR_OUTLINE)
			elif _leaf_contains(px, py, crest_leaf_center.x, crest_leaf_center.y, crest_leaf_r) \
					or _paw_print_contains(px, py, crest_paw_center.x, crest_paw_center.y, crest_paw_r):
				image.set_pixel(x, y, COLOR_ADVENTURE_GREEN)
			else:
				image.set_pixel(x, y, COLOR_PARCHMENT)
	return ImageTexture.create_from_image(image)

func _wood_ring_color(px: float, py: float, cx: float, cy: float, r_outer: float) -> Color:
	# Faint angular "grain" banding plus a light-from-above tint (mirrors
	# _draw_wood_panel's top-highlight trick) so the ring doesn't read as a
	# single flat band of color.
	var angle := atan2(py - cy, px - cx)
	var grain: float = 0.5 + 0.5 * sin(angle * 10.0)
	var color := COLOR_WOOD_MID.lerp(COLOR_WOOD_LIGHT, grain * 0.35)
	if py < cy:
		color = color.lerp(COLOR_WOOD_LIGHT, clampf((cy - py) / (r_outer * 1.4), 0.0, 0.4))
	return color

func _leaf_contains(px: float, py: float, cx: float, cy: float, r: float) -> bool:
	# Organic leaf sprig: one elongated main lobe plus two smaller angled
	# side lobes, approximating the 3-leaf foliage-accent silhouette used
	# elsewhere in the frontend (see MapScreen.css's inline leaf-cluster SVG
	# path data - one larger leaf plus two smaller flanking leaves).
	if _ellipse_contains(px, py, cx, cy - 0.08 * r, r * 0.32, r * 0.58):
		return true
	var side_offsets := [Vector2(-0.4, 0.32), Vector2(0.4, 0.3)]
	for off in side_offsets:
		if _ellipse_contains(px, py, cx + off.x * r, cy + off.y * r, r * 0.26, r * 0.4):
			return true
	return false

func _ellipse_contains(px: float, py: float, ecx: float, ecy: float, rx: float, ry: float) -> bool:
	var dx := (px - ecx) / rx
	var dy := (py - ecy) / ry
	return dx * dx + dy * dy <= 1.0

func _paw_print_contains(px: float, py: float, cx: float, cy: float, r: float) -> bool:
	if _circle_contains(px, py, cx, cy + 0.28 * r, 0.6 * r):
		return true
	var toe_offsets := [Vector2(-0.5, -0.62), Vector2(-0.18, -0.82), Vector2(0.18, -0.82), Vector2(0.5, -0.62)]
	for off in toe_offsets:
		if _circle_contains(px, py, cx + off.x * r, cy + off.y * r, 0.24 * r):
			return true
	return false

func _circle_contains(px: float, py: float, ccx: float, ccy: float, rad: float) -> bool:
	var dx := px - ccx
	var dy := py - ccy
	return dx * dx + dy * dy <= rad * rad

# ---------------------------------------------------------------------------
# Game logic - unchanged from the pre-art-pass version.
# ---------------------------------------------------------------------------

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
	stat_value_label.text = "%d / %d" % [pairs_found, PAIR_COUNT]

# ---------------------------------------------------------------------------
# Drawing. Main is a Node2D so everything here renders beneath the $UI
# CanvasLayer's real Label/Button nodes (CanvasLayer always composites above
# the base 2D canvas).
# ---------------------------------------------------------------------------

func _draw() -> void:
	_draw_page_bg()
	_draw_sign_plank()
	_draw_instruction_panel()
	_draw_grid_frame()
	_draw_tip_bar()

func _draw_page_bg() -> void:
	var vp := get_viewport_rect().size
	draw_rect(Rect2(Vector2.ZERO, vp), COLOR_PAGE_BG, true)

func _draw_sign_plank() -> void:
	_draw_wood_panel(SIGN_RECT, 14.0)
	var cx := SIGN_RECT.position.x + 30
	var cy := SIGN_RECT.position.y + SIGN_RECT.size.y * 0.5
	_draw_paw_icon(Vector2(cx, cy), 13.0, COLOR_PARCHMENT)

func _draw_instruction_panel() -> void:
	_draw_parchment_pill(INSTRUCTION_RECT, 16.0)
	var icon_center := INSTRUCTION_RECT.position + Vector2(40, INSTRUCTION_RECT.size.y * 0.5)
	_draw_card_paw_icon(icon_center, 20.0)
	_draw_stat_box(STAT_BOX_RECT, 14.0)

func _draw_grid_frame() -> void:
	_draw_wood_panel(GRID_FRAME_RECT, 18.0)

func _draw_tip_bar() -> void:
	_draw_parchment_pill(TIP_RECT, 14.0)
	var icon_center := TIP_RECT.position + Vector2(30, TIP_RECT.size.y * 0.5)
	_draw_lightbulb_icon(icon_center, 16.0)

# --- Small procedural icons --------------------------------------------------

func _draw_paw_icon(center: Vector2, r: float, color: Color) -> void:
	draw_circle(center + Vector2(0, r * 0.28), r * 0.6, color)
	var toe_offsets := [Vector2(-0.5, -0.62), Vector2(-0.18, -0.82), Vector2(0.18, -0.82), Vector2(0.5, -0.62)]
	for off in toe_offsets:
		draw_circle(center + off * r, r * 0.24, color)

func _draw_card_paw_icon(center: Vector2, r: float) -> void:
	var card_rect := Rect2(center - Vector2(r * 0.68, r * 0.85), Vector2(r * 1.36, r * 1.7))
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(1, 1, 1, 0.9)
	sb.set_corner_radius_all(int(r * 0.28))
	sb.set_border_width_all(2)
	sb.border_color = COLOR_OUTLINE
	draw_style_box(sb, card_rect)
	_draw_paw_icon(center, r * 0.6, COLOR_ADVENTURE_GREEN)

func _draw_lightbulb_icon(center: Vector2, r: float) -> void:
	draw_circle(center + Vector2(0, -r * 0.15), r * 0.62, Color("#f2b705"))
	var base_rect := Rect2(center + Vector2(-r * 0.28, r * 0.35), Vector2(r * 0.56, r * 0.35))
	var sb := StyleBoxFlat.new()
	sb.bg_color = COLOR_WOOD_MID
	sb.set_corner_radius_all(int(r * 0.12))
	draw_style_box(sb, base_rect)
	draw_line(center + Vector2(-r * 0.18, r * 0.7), center + Vector2(r * 0.18, r * 0.7), COLOR_OUTLINE, 1.5)

# --- Shared panel drawing helpers -------------------------------------------

func _draw_wood_panel(rect: Rect2, radius: float) -> void:
	var sb := StyleBoxFlat.new()
	sb.bg_color = COLOR_WOOD_MID
	sb.set_corner_radius_all(int(radius))
	sb.border_width_top = 3
	sb.border_width_bottom = 3
	sb.border_width_left = 3
	sb.border_width_right = 3
	sb.border_color = COLOR_OUTLINE
	# Hard "pop" shadow (no blur), matching --cap-shadow-pop's flat offset.
	var shadow_sb := StyleBoxFlat.new()
	shadow_sb.bg_color = COLOR_OUTLINE
	shadow_sb.set_corner_radius_all(int(radius))
	draw_style_box(shadow_sb, Rect2(rect.position + Vector2(3, 3), rect.size))
	draw_style_box(sb, rect)
	# Faint top highlight band to fake the light-to-dark wood gradient
	# without needing a texture resource.
	var highlight := Rect2(rect.position + Vector2(4, 4), Vector2(rect.size.x - 8, rect.size.y * 0.4))
	var hl_sb := StyleBoxFlat.new()
	hl_sb.bg_color = Color(COLOR_WOOD_LIGHT.r, COLOR_WOOD_LIGHT.g, COLOR_WOOD_LIGHT.b, 0.5)
	hl_sb.corner_radius_top_left = int(radius) - 2
	hl_sb.corner_radius_top_right = int(radius) - 2
	draw_style_box(hl_sb, highlight)

func _draw_parchment_pill(rect: Rect2, radius: float = 12.0) -> void:
	var shadow_sb := StyleBoxFlat.new()
	shadow_sb.bg_color = COLOR_OUTLINE
	shadow_sb.set_corner_radius_all(int(radius))
	draw_style_box(shadow_sb, Rect2(rect.position + Vector2(2, 2), rect.size))
	var sb := StyleBoxFlat.new()
	sb.bg_color = COLOR_PARCHMENT
	sb.set_corner_radius_all(int(radius))
	sb.border_width_top = 2
	sb.border_width_bottom = 2
	sb.border_width_left = 2
	sb.border_width_right = 2
	sb.border_color = COLOR_OUTLINE
	draw_style_box(sb, rect)

func _draw_stat_box(rect: Rect2, radius: float) -> void:
	var shadow_sb := StyleBoxFlat.new()
	shadow_sb.bg_color = COLOR_OUTLINE
	shadow_sb.set_corner_radius_all(int(radius))
	draw_style_box(shadow_sb, Rect2(rect.position + Vector2(2, 2), rect.size))
	var sb := StyleBoxFlat.new()
	sb.bg_color = COLOR_HEADER_GREEN
	sb.set_corner_radius_all(int(radius))
	sb.border_width_top = 2
	sb.border_width_bottom = 2
	sb.border_width_left = 2
	sb.border_width_right = 2
	sb.border_color = COLOR_OUTLINE
	draw_style_box(sb, rect)

# ---------------------------------------------------------------------------
# UI node styling - applied once in _ready() to real Control/Button nodes
# (which need to stay real nodes for input + text layout) rather than
# folded into _draw().
# ---------------------------------------------------------------------------

func _style_ui() -> void:
	for card in cards:
		_style_round_button(card, COLOR_PARCHMENT, COLOR_OUTLINE, 12)
	_style_round_button(top_exit_button, COLOR_SUNSET_ORANGE, COLOR_SUNSET_ORANGE_DEEP, 10)
	_style_round_button(restart_button, COLOR_HEADER_GREEN, COLOR_OUTLINE, 10)
	_style_round_button(gameover_exit_button, COLOR_PARCHMENT, COLOR_OUTLINE, 10)
	gameover_exit_button.add_theme_color_override("font_color", COLOR_INK)
	gameover_exit_button.add_theme_color_override("font_hover_color", COLOR_INK)
	gameover_exit_button.add_theme_color_override("font_pressed_color", COLOR_INK)

	title_label.add_theme_color_override("font_color", Color(1, 1, 1))
	title_label.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.5))
	title_label.add_theme_constant_override("shadow_offset_x", 1)
	title_label.add_theme_constant_override("shadow_offset_y", 1)

	instruction_label.add_theme_color_override("font_color", COLOR_INK)
	stat_caption_label.add_theme_color_override("font_color", Color(1, 1, 1))
	stat_value_label.add_theme_color_override("font_color", Color(1, 1, 1))
	tip_label.add_theme_color_override("font_color", COLOR_INK)

	result_label.add_theme_color_override("font_color", COLOR_INK)
	score_result_label.add_theme_color_override("font_color", COLOR_INK)

func _style_round_button(btn: Button, bg: Color, border: Color, radius: int) -> void:
	var normal := StyleBoxFlat.new()
	normal.bg_color = bg
	normal.set_corner_radius_all(radius)
	normal.set_border_width_all(2)
	normal.border_color = border
	var hover := normal.duplicate()
	hover.bg_color = bg.lightened(0.1)
	var pressed := normal.duplicate()
	pressed.bg_color = bg.darkened(0.15)
	btn.add_theme_stylebox_override("normal", normal)
	btn.add_theme_stylebox_override("hover", hover)
	btn.add_theme_stylebox_override("pressed", pressed)
	btn.add_theme_stylebox_override("focus", normal)
	btn.add_theme_color_override("font_color", Color(1, 1, 1))
	btn.add_theme_color_override("font_hover_color", Color(1, 1, 1))
	btn.add_theme_color_override("font_pressed_color", Color(1, 1, 1))
