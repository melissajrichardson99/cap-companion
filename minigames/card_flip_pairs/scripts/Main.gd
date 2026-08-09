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

# Per-animal silhouette colors. Distinct hues so each icon is tell-apart-able
# by color alone, on top of already being a distinct silhouette shape.
const COLOR_ANIMAL_CAPYBARA := Color("#9c7a4d")
const COLOR_ANIMAL_KANGAROO := Color("#c17a4a")
const COLOR_ANIMAL_WALLAROO := Color("#7a4a2e")
const COLOR_ANIMAL_GOAT := Color("#a89570")
const COLOR_ANIMAL_ALPACA := Color("#d9b98a")
const COLOR_ANIMAL_SHEEP := Color("#f2ede0")
const COLOR_ANIMAL_PIG := Color("#e8a0ac")
const COLOR_ANIMAL_EMU := Color("#46543f")

# Godot's default font (used by the Web export) has no glyphs for emoji
# codepoints - verified via Playwright screenshot, where Button.text set to
# an animal emoji rendered as a "U+1F418"-style missing-glyph box, not a
# picture. Every animal "face" is therefore a procedurally-drawn silhouette
# icon (simple blob-body + one distinguishing feature per animal), matching
# the confirmed 8-pair roster in CAP_Companion_App_TechSpec.md. This is a
# placeholder art pass (like Mini Snake's apple/snake glyphs), not
# photorealistic art.
const ANIMAL_NAMES := ["capybara", "kangaroo", "wallaroo", "goat", "alpaca", "sheep", "pig", "emu"]
const ANIMAL_COLORS := [
	COLOR_ANIMAL_CAPYBARA,
	COLOR_ANIMAL_KANGAROO,
	COLOR_ANIMAL_WALLAROO,
	COLOR_ANIMAL_GOAT,
	COLOR_ANIMAL_ALPACA,
	COLOR_ANIMAL_SHEEP,
	COLOR_ANIMAL_PIG,
	COLOR_ANIMAL_EMU,
]

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
var face_textures: Array[ImageTexture] = []

func _ready() -> void:
	randomize()
	back_texture = _make_back_texture()
	face_textures.clear()
	for i in range(ANIMAL_NAMES.size()):
		face_textures.append(_make_face_texture(ANIMAL_NAMES[i], ANIMAL_COLORS[i]))
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
# Texture generation. Card backs and animal faces are both built pixel-by-
# pixel into an Image/ImageTexture (no bundled image assets exist anywhere in
# this repo - deliberate), the same technique the previous abstract-shape
# placeholder used, just with real silhouette hit-tests instead of
# circle/square/diamond primitives.
# ---------------------------------------------------------------------------

func _make_back_texture() -> ImageTexture:
	# Cream card back with a centered green paw print, matching the park's
	# paw-print motif used for the "Adventure" trail markers elsewhere.
	var image := Image.create(ICON_SIZE, ICON_SIZE, false, Image.FORMAT_RGBA8)
	image.fill(COLOR_PARCHMENT)
	var cx := ICON_SIZE / 2.0
	var cy := ICON_SIZE / 2.0
	var r := ICON_SIZE * 0.42
	for y in range(ICON_SIZE):
		for x in range(ICON_SIZE):
			var px := x + 0.5
			var py := y + 0.5
			if _paw_print_contains(px, py, cx, cy, r):
				image.set_pixel(x, y, COLOR_ADVENTURE_GREEN)
	return ImageTexture.create_from_image(image)

func _paw_print_contains(px: float, py: float, cx: float, cy: float, r: float) -> bool:
	if _circle_contains(px, py, cx, cy + 0.28 * r, 0.6 * r):
		return true
	var toe_offsets := [Vector2(-0.5, -0.62), Vector2(-0.18, -0.82), Vector2(0.18, -0.82), Vector2(0.5, -0.62)]
	for off in toe_offsets:
		if _circle_contains(px, py, cx + off.x * r, cy + off.y * r, 0.24 * r):
			return true
	return false

func _make_face_texture(animal: String, color: Color) -> ImageTexture:
	var image := Image.create(ICON_SIZE, ICON_SIZE, false, Image.FORMAT_RGBA8)
	var cx := ICON_SIZE / 2.0
	var cy := ICON_SIZE / 2.0
	var r := ICON_SIZE / 2.0 - ICON_SIZE * 0.14
	var accent := color.darkened(0.32)
	for y in range(ICON_SIZE):
		for x in range(ICON_SIZE):
			var px := x + 0.5
			var py := y + 0.5
			var part := _animal_part(animal, px, py, cx, cy, r)
			if part == 1:
				image.set_pixel(x, y, color)
			elif part == 2:
				image.set_pixel(x, y, accent)
			else:
				image.set_pixel(x, y, Color(0, 0, 0, 0))
	return ImageTexture.create_from_image(image)

# Returns 0 (transparent), 1 (primary silhouette color) or 2 (darker accent
# color, used for a small distinguishing feature like a snout or horns).
func _animal_part(animal: String, px: float, py: float, cx: float, cy: float, r: float) -> int:
	match animal:
		"capybara":
			return _capybara_part(px, py, cx, cy, r)
		"kangaroo":
			return _kangaroo_part(px, py, cx, cy, r, 1.0)
		"wallaroo":
			# Same body plan as kangaroo but smaller and a different color -
			# these two real park animals are easy to mix up, so they're
			# distinguished by size and hue rather than a wholly different
			# silhouette, per the spec.
			return _kangaroo_part(px, py, cx, cy, r, 0.8)
		"goat":
			return _goat_part(px, py, cx, cy, r)
		"alpaca":
			return _alpaca_part(px, py, cx, cy, r)
		"sheep":
			return _sheep_part(px, py, cx, cy, r)
		"pig":
			return _pig_part(px, py, cx, cy, r)
		"emu":
			return _emu_part(px, py, cx, cy, r)
		_:
			return 0

func _capybara_part(px: float, py: float, cx: float, cy: float, r: float) -> int:
	# Low, wide rounded body with small ears and a dark nose.
	if _circle_contains(px, py, cx + 0.95 * r, cy + 0.05 * r, 0.22 * r):
		return 2
	if _ellipse_contains(px, py, cx, cy + 0.15 * r, 1.05 * r, 0.62 * r):
		return 1
	if _circle_contains(px, py, cx - 0.55 * r, cy - 0.55 * r, 0.18 * r):
		return 1
	if _circle_contains(px, py, cx + 0.55 * r, cy - 0.55 * r, 0.18 * r):
		return 1
	return 0

func _kangaroo_part(px: float, py: float, cx: float, cy: float, r: float, scale: float) -> int:
	# Upright body, round head with tall ears, and a thick tail.
	var r2 := r * scale
	if _circle_contains(px, py, cx, cy - 0.68 * r2, 0.12 * r2):
		return 2
	if _ellipse_contains(px, py, cx, cy + 0.15 * r2, 0.5 * r2, 0.85 * r2):
		return 1
	if _circle_contains(px, py, cx, cy - 0.75 * r2, 0.32 * r2):
		return 1
	if _circle_contains(px, py, cx - 0.18 * r2, cy - 1.05 * r2, 0.14 * r2):
		return 1
	if _circle_contains(px, py, cx + 0.18 * r2, cy - 1.05 * r2, 0.14 * r2):
		return 1
	if _point_in_triangle(px, py, cx + 0.3 * r2, cy + 0.65 * r2, cx + 0.85 * r2, cy + 1.0 * r2, cx + 0.55 * r2, cy + 1.05 * r2):
		return 1
	return 0

func _goat_part(px: float, py: float, cx: float, cy: float, r: float) -> int:
	# Rounded body and head, curved horns, small beard.
	if _point_in_triangle(px, py, cx - 0.15 * r, cy - 0.55 * r, cx - 0.42 * r, cy - 1.0 * r, cx - 0.02 * r, cy - 0.6 * r):
		return 2
	if _point_in_triangle(px, py, cx + 0.15 * r, cy - 0.55 * r, cx + 0.42 * r, cy - 1.0 * r, cx + 0.02 * r, cy - 0.6 * r):
		return 2
	if _point_in_triangle(px, py, cx - 0.1 * r, cy - 0.05 * r, cx + 0.1 * r, cy - 0.05 * r, cx, cy + 0.18 * r):
		return 2
	if _ellipse_contains(px, py, cx, cy + 0.25 * r, 0.6 * r, 0.5 * r):
		return 1
	if _circle_contains(px, py, cx, cy - 0.35 * r, 0.32 * r):
		return 1
	if _circle_contains(px, py, cx - 0.32 * r, cy - 0.35 * r, 0.14 * r):
		return 1
	if _circle_contains(px, py, cx + 0.32 * r, cy - 0.35 * r, 0.14 * r):
		return 1
	return 0

func _alpaca_part(px: float, py: float, cx: float, cy: float, r: float) -> int:
	# Long neck, small head, fluffy body low down.
	if _circle_contains(px, py, cx, cy - 0.55 * r, 0.12 * r):
		return 2
	if _ellipse_contains(px, py, cx, cy + 0.65 * r, 0.55 * r, 0.4 * r):
		return 1
	if _ellipse_contains(px, py, cx, cy + 0.05 * r, 0.24 * r, 0.55 * r):
		return 1
	if _circle_contains(px, py, cx, cy - 0.6 * r, 0.26 * r):
		return 1
	if _circle_contains(px, py, cx - 0.15 * r, cy - 0.85 * r, 0.1 * r):
		return 1
	if _circle_contains(px, py, cx + 0.15 * r, cy - 0.85 * r, 0.1 * r):
		return 1
	return 0

func _sheep_part(px: float, py: float, cx: float, cy: float, r: float) -> int:
	# Fluffy cloud-cluster body with a small dark face peeking out the side.
	if _circle_contains(px, py, cx - 0.68 * r, cy - 0.05 * r, 0.22 * r):
		return 2
	if _circle_contains(px, py, cx - 0.55 * r, cy - 0.3 * r, 0.12 * r):
		return 2
	if _circle_contains(px, py, cx, cy + 0.05 * r, 0.62 * r):
		return 1
	var angles := [0.0, 72.0, 144.0, 216.0, 288.0]
	for ang in angles:
		var rad := deg_to_rad(ang)
		var ox := cos(rad) * 0.4 * r
		var oy := sin(rad) * 0.4 * r
		if _circle_contains(px, py, cx + ox, cy + 0.05 * r + oy, 0.32 * r):
			return 1
	return 0

func _pig_part(px: float, py: float, cx: float, cy: float, r: float) -> int:
	# Round body, round protruding snout, small triangular ears, curly tail.
	if _circle_contains(px, py, cx + 0.55 * r, cy + 0.05 * r, 0.24 * r):
		return 2
	if _circle_contains(px, py, cx - 0.7 * r, cy + 0.35 * r, 0.1 * r):
		return 2
	if _ellipse_contains(px, py, cx, cy + 0.1 * r, 0.58 * r, 0.5 * r):
		return 1
	if _point_in_triangle(px, py, cx - 0.35 * r, cy - 0.4 * r, cx - 0.55 * r, cy - 0.75 * r, cx - 0.1 * r, cy - 0.45 * r):
		return 1
	if _point_in_triangle(px, py, cx + 0.35 * r, cy - 0.4 * r, cx + 0.55 * r, cy - 0.75 * r, cx + 0.1 * r, cy - 0.45 * r):
		return 1
	return 0

func _emu_part(px: float, py: float, cx: float, cy: float, r: float) -> int:
	# Long-neck bird silhouette: round body, tall thin neck, small head, beak.
	if _point_in_triangle(px, py, cx + 0.12 * r, cy - 0.85 * r, cx + 0.4 * r, cy - 0.8 * r, cx + 0.12 * r, cy - 0.75 * r):
		return 2
	if _ellipse_contains(px, py, cx, cy + 0.55 * r, 0.45 * r, 0.4 * r):
		return 1
	if _ellipse_contains(px, py, cx, cy - 0.15 * r, 0.16 * r, 0.65 * r):
		return 1
	if _circle_contains(px, py, cx, cy - 0.85 * r, 0.16 * r):
		return 1
	return 0

func _circle_contains(px: float, py: float, ccx: float, ccy: float, rad: float) -> bool:
	var dx := px - ccx
	var dy := py - ccy
	return dx * dx + dy * dy <= rad * rad

func _ellipse_contains(px: float, py: float, ecx: float, ecy: float, rx: float, ry: float) -> bool:
	var dx := (px - ecx) / rx
	var dy := (py - ecy) / ry
	return dx * dx + dy * dy <= 1.0

func _point_in_triangle(px: float, py: float, ax: float, ay: float, bx: float, by: float, cx2: float, cy2: float) -> bool:
	var d1 := _triangle_sign(px, py, ax, ay, bx, by)
	var d2 := _triangle_sign(px, py, bx, by, cx2, cy2)
	var d3 := _triangle_sign(px, py, cx2, cy2, ax, ay)
	var has_neg := d1 < 0 or d2 < 0 or d3 < 0
	var has_pos := d1 > 0 or d2 > 0 or d3 > 0
	return not (has_neg and has_pos)

func _triangle_sign(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
	return (px - bx) * (ay - by) - (ax - bx) * (py - by)

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
