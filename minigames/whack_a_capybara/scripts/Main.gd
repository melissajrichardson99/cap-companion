extends Node2D

enum Critter { NONE, CAPYBARA, DECOY }

const ROUND_DURATION := 30.0
const SPAWN_INTERVAL_MIN := 0.45
const SPAWN_INTERVAL_MAX := 0.95
const SHOW_DURATION_MIN := 0.65
const SHOW_DURATION_MAX := 1.05
const DECOY_CHANCE := 0.25

# --- Layout rects (design canvas is 400x600, see project.godot). Purely
# cosmetic - none of this feeds gameplay math, which stays entirely in
# hole-index space (0..8) via HOLE_COLS/HOLE_ORIGIN/HOLE_CELL/HOLE_GAP.
const SIGN_RECT := Rect2(10, 10, 380, 56)
const STATS_RECT := Rect2(10, 74, 380, 54)
const SCORE_PILL_RECT := Rect2(20, 79, 175, 44)
const TIME_PILL_RECT := Rect2(205, 79, 175, 44)
const FRAME_RECT := Rect2(10, 140, 380, 380)
const LEGEND_RECT := Rect2(10, 530, 380, 60)
const CAPY_LEGEND_PILL_RECT := Rect2(20, 536, 175, 48)
const PORC_LEGEND_PILL_RECT := Rect2(205, 536, 175, 48)

const HOLE_COLS := 3
const HOLE_CELL := 100
const HOLE_GAP := 12
const HOLE_ORIGIN := Vector2(38, 168)

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

# Game-specific: dirt mound the critters pop out of. Capybara/porcupine art
# is real photo-crop textures (see below), contain-fit into each hole rect.
const COLOR_DIRT_LIGHT := Color("#8a6a45")
const COLOR_DIRT_DARK := Color("#5c4326")
const COLOR_HOLE_SHADOW := Color("#241a10")

const CAPYBARA_TEXTURE := preload("res://assets/capybara_face.png")
const PORCUPINE_TEXTURE := preload("res://assets/porcupine_face.png")

# capybara_face.png's body runs straight off the image's right and bottom
# edges (a hard crop baked into the art), which reads as a squared-off neck.
# These describe an ellipse in the PNG's pixel space around the head; pixels
# outside it are cut away at load time so only a rounded head-and-shoulders
# shape is drawn. The PNG itself is untouched.
const CAPY_CROP_CENTER := Vector2(110, 105)
const CAPY_CROP_RADII := Vector2(112, 120)
const CAPY_CROP_STROKE := 3.0
const CAPY_OUTLINE := Color("#26110c")
# porcupine_face.png has the same kind of hard crop, along its left edge and
# its whole bottom edge; the same load-time trim rounds it off (and drops a
# paw fragment that would otherwise poke out past the hole's front rim).
const PORC_CROP_CENTER := Vector2(160, 128)
const PORC_CROP_RADII := Vector2(160, 128)

# Critters are contain-fit into a square no wider than the hole opening
# (64% of the cell), centred on the hole, with their bottom edge tucked just
# behind the hole's front rim.
const CRITTER_MAX_SIDE := 64.0
const CRITTER_LIFT := 3.0
const RIM_THICKNESS := 7.0

@onready var score_caption_label: Label = $UI/StatsBar/ScorePill/CaptionLabel
@onready var score_value_label: Label = $UI/StatsBar/ScorePill/ValueLabel
@onready var time_caption_label: Label = $UI/StatsBar/TimePill/CaptionLabel
@onready var time_value_label: Label = $UI/StatsBar/TimePill/ValueLabel
@onready var title_label: Label = $UI/SignBar/TitleLabel
@onready var hole_grid: GridContainer = $UI/HoleGrid
@onready var capy_legend_label: Label = $UI/LegendCapy/Label
@onready var porc_legend_label: Label = $UI/LegendPorc/Label
@onready var end_card: EndCard = $UI/EndCard
@onready var top_exit_button: Button = $UI/SignBar/ExitButton

var holes: Array[Button] = []
var hole_state: Array[Critter] = []
var hole_hide_at: Array[float] = []

var score: int = 0
var is_running: bool = false
var time_left: float = ROUND_DURATION
var spawn_cooldown: float = 0.0
var game_clock: float = 0.0

var capybara_texture: Texture2D = CAPYBARA_TEXTURE
var porcupine_texture: Texture2D = PORCUPINE_TEXTURE

func _ready() -> void:
	randomize()
	capybara_texture = _crop_to_ellipse(CAPYBARA_TEXTURE, CAPY_CROP_CENTER, CAPY_CROP_RADII, CAPY_CROP_STROKE)
	porcupine_texture = _crop_to_ellipse(PORCUPINE_TEXTURE, PORC_CROP_CENTER, PORC_CROP_RADII, CAPY_CROP_STROKE)
	_style_ui()
	holes.assign(hole_grid.get_children())
	for i in range(holes.size()):
		hole_state.append(Critter.NONE)
		hole_hide_at.append(-1.0)
		var idx := i
		holes[i].pressed.connect(func(): _on_hole_pressed(idx))
	end_card.play_again_pressed.connect(_start_game)
	top_exit_button.pressed.connect(_on_exit_pressed)
	end_card.exit_pressed.connect(_on_exit_pressed)
	_start_game()

func _start_game() -> void:
	score = 0
	time_left = ROUND_DURATION
	game_clock = 0.0
	spawn_cooldown = randf_range(SPAWN_INTERVAL_MIN, SPAWN_INTERVAL_MAX)
	is_running = true
	end_card.hide_card()
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
	# The hole's Button is a transparent hit-box (see _style_hole_button) -
	# all visible mound/critter art is painted by _draw() from hole_state, so
	# every mutation of that array must be followed by a redraw or the new
	# critter (or its disappearance) silently never shows up.
	queue_redraw()

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
	# Score attack: no win or loss, so the outcome is timeup.
	end_card.show_result("Time's Up!", EndCard.OUTCOME_TIMEUP, [EndCard.stat("Score", score)])

func _on_exit_pressed() -> void:
	is_running = false
	EndCard.notify_host_complete("whack_a_capybara")

func _update_labels() -> void:
	score_value_label.text = str(score)
	time_value_label.text = str(ceili(time_left))

# ---------------------------------------------------------------------------
# Drawing. Main is a Node2D so everything here renders beneath the $UI
# CanvasLayer's real Label/Button nodes (CanvasLayer always composites above
# the base 2D canvas). The nine hole Buttons are transparent hit-boxes
# (StyleBoxEmpty on every state) - their visible mound + critter art is
# painted here, at the same rects, so a signal callback never has to paint
# onto another node's canvas.
# ---------------------------------------------------------------------------

func _draw() -> void:
	_draw_page_bg()
	_draw_sign_plank()
	_draw_stat_pills()
	_draw_field_frame()
	_draw_holes()
	_draw_legend()

func _draw_page_bg() -> void:
	var vp := get_viewport_rect().size
	draw_rect(Rect2(Vector2.ZERO, vp), COLOR_PAGE_BG, true)

func _draw_sign_plank() -> void:
	_draw_wood_panel(SIGN_RECT, 14.0)

func _draw_stat_pills() -> void:
	_draw_parchment_pill(STATS_RECT, 16.0)
	_draw_parchment_pill(SCORE_PILL_RECT)
	_draw_parchment_pill(TIME_PILL_RECT)
	_draw_star_icon(SCORE_PILL_RECT.position + Vector2(18, SCORE_PILL_RECT.size.y * 0.5), 8.0)
	_draw_clock_icon(TIME_PILL_RECT.position + Vector2(18, TIME_PILL_RECT.size.y * 0.5), 8.0)

func _draw_star_icon(center: Vector2, r: float) -> void:
	var points := PackedVector2Array()
	for i in range(10):
		var ang := -PI / 2 + i * PI / 5
		var rad := r if i % 2 == 0 else r * 0.45
		points.append(center + Vector2(cos(ang), sin(ang)) * rad)
	draw_colored_polygon(points, Color("#f2b705"))

func _draw_clock_icon(center: Vector2, r: float) -> void:
	draw_circle(center, r, COLOR_PARCHMENT)
	draw_arc(center, r, 0, TAU, 24, COLOR_OUTLINE, 1.5)
	draw_line(center, center + Vector2(0, -r * 0.65), COLOR_OUTLINE, 1.5)
	draw_line(center, center + Vector2(r * 0.5, r * 0.15), COLOR_OUTLINE, 1.5)

func _draw_field_frame() -> void:
	_draw_wood_panel(FRAME_RECT, 18.0)

func _draw_holes() -> void:
	for i in range(holes.size()):
		var rect := _hole_rect(i)
		_draw_mound(rect)
		match hole_state[i]:
			Critter.CAPYBARA:
				_draw_critter_in_hole(capybara_texture, rect)
			Critter.DECOY:
				_draw_critter_in_hole(porcupine_texture, rect)
		_draw_front_rim(rect)

func _hole_rect(index: int) -> Rect2:
	var col := index % HOLE_COLS
	var row := index / HOLE_COLS
	var pos := HOLE_ORIGIN + Vector2(col * (HOLE_CELL + HOLE_GAP), row * (HOLE_CELL + HOLE_GAP))
	return Rect2(pos, Vector2(HOLE_CELL, HOLE_CELL))

func _draw_mound(rect: Rect2) -> void:
	var mound_sb := StyleBoxFlat.new()
	mound_sb.bg_color = COLOR_DIRT_LIGHT
	mound_sb.set_corner_radius_all(int(rect.size.x * 0.3))
	mound_sb.border_width_bottom = 3
	mound_sb.border_color = COLOR_DIRT_DARK
	draw_style_box(mound_sb, rect)
	draw_circle(_hole_center(rect), _hole_radius(rect), COLOR_HOLE_SHADOW)

func _hole_center(rect: Rect2) -> Vector2:
	return rect.position + Vector2(rect.size.x * 0.5, rect.size.y * 0.62)

func _hole_radius(rect: Rect2) -> float:
	return rect.size.x * 0.32

func _draw_capybara(rect: Rect2) -> void:
	_draw_texture_contain(capybara_texture, rect, 0.9)

func _draw_critter_in_hole(tex: Texture2D, rect: Rect2) -> void:
	# Contain-fit into a CRITTER_MAX_SIDE square, centred on the hole, with the
	# bottom edge sitting inside the front rim's band so the rim hides it.
	var hc := _hole_center(rect)
	var tex_size := tex.get_size()
	var fit_scale: float = min(CRITTER_MAX_SIDE / tex_size.x, CRITTER_MAX_SIDE / tex_size.y)
	var draw_size := tex_size * fit_scale
	var bottom_y := hc.y + _hole_radius(rect) - RIM_THICKNESS * 0.5 - CRITTER_LIFT
	draw_texture_rect(tex, Rect2(Vector2(hc.x - draw_size.x * 0.5, bottom_y - draw_size.y), draw_size), false)

func _draw_front_rim(rect: Rect2) -> void:
	# Front lip of the hole, drawn over the critter: a crescent hugging the
	# lower half of the hole, RIM_THICKNESS thick at the bottom and tapering
	# to nothing at the sides, filled with the mound colour the hole is cut
	# into so it reads as the hole's own edge rather than a separate object.
	var hc := _hole_center(rect)
	var ro := _hole_radius(rect) + 1.0
	var points := PackedVector2Array()
	var inner := PackedVector2Array()
	for k in range(33):
		var ang := PI * k / 32.0
		points.append(hc + Vector2(cos(ang) * ro, sin(ang) * ro))
	for k in range(31, 0, -1):
		var ang := PI * k / 32.0
		inner.append(hc + Vector2(cos(ang) * ro, sin(ang) * (ro - RIM_THICKNESS)))
	points.append_array(inner)
	draw_colored_polygon(points, COLOR_DIRT_LIGHT)
	draw_polyline(inner, COLOR_DIRT_DARK, 1.5, true)

# Returns src with everything outside an ellipse (in src pixel space) made
# transparent and an outline stroke px wide along the cut, so the cut edge
# matches the art's own dark outline. Cropped to what's left.
func _crop_to_ellipse(src: Texture2D, center: Vector2, radii: Vector2, stroke: float) -> Texture2D:
	var img := src.get_image()
	if img.is_compressed():
		img.decompress()
	img.convert(Image.FORMAT_RGBA8)
	var min_radius: float = min(radii.x, radii.y)
	for y in range(img.get_height()):
		for x in range(img.get_width()):
			var col := img.get_pixel(x, y)
			if col.a == 0.0:
				continue
			var n := Vector2((x - center.x) / radii.x, (y - center.y) / radii.y).length()
			var inside := (1.0 - n) * min_radius
			if inside <= 0.0:
				col.a = 0.0
			elif inside < stroke:
				col = Color(CAPY_OUTLINE, col.a * clampf(inside, 0.0, 1.0))
			img.set_pixel(x, y, col)
	return ImageTexture.create_from_image(img.get_region(img.get_used_rect()))

func _draw_porcupine(rect: Rect2) -> void:
	_draw_texture_contain(porcupine_texture, rect, 0.9)

func _draw_texture_contain(tex: Texture2D, rect: Rect2, scale_factor: float = 1.0) -> void:
	var tex_size := tex.get_size()
	var target_size := rect.size * scale_factor
	var scale: float = min(target_size.x / tex_size.x, target_size.y / tex_size.y)
	var draw_size := tex_size * scale
	var draw_pos := rect.position + (rect.size - draw_size) * 0.5
	draw_texture_rect(tex, Rect2(draw_pos, draw_size), false)

func _draw_legend() -> void:
	_draw_parchment_pill(LEGEND_RECT, 16.0)
	_draw_parchment_pill(CAPY_LEGEND_PILL_RECT, 12.0)
	_draw_parchment_pill(PORC_LEGEND_PILL_RECT, 12.0)
	var capy_icon_rect := Rect2(CAPY_LEGEND_PILL_RECT.position + Vector2(6, 4), Vector2(40, 40))
	var porc_icon_rect := Rect2(PORC_LEGEND_PILL_RECT.position + Vector2(6, 4), Vector2(40, 40))
	_draw_capybara(capy_icon_rect)
	_draw_porcupine(porc_icon_rect)

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

# ---------------------------------------------------------------------------
# UI node styling - applied once in _ready() to real Control/Button nodes
# (which need to stay real nodes for input + text layout) rather than
# folded into _draw().
# ---------------------------------------------------------------------------

func _style_ui() -> void:
	_style_round_button(top_exit_button, COLOR_SUNSET_ORANGE, COLOR_SUNSET_ORANGE_DEEP, 10)

	for hole_button in hole_grid.get_children():
		_style_hole_button(hole_button)

	title_label.add_theme_color_override("font_color", Color(1, 1, 1))
	title_label.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.5))
	title_label.add_theme_constant_override("shadow_offset_x", 1)
	title_label.add_theme_constant_override("shadow_offset_y", 1)

	score_caption_label.add_theme_color_override("font_color", COLOR_INK)
	score_value_label.add_theme_color_override("font_color", COLOR_INK)
	time_caption_label.add_theme_color_override("font_color", COLOR_INK)
	time_value_label.add_theme_color_override("font_color", COLOR_INK)
	capy_legend_label.add_theme_color_override("font_color", COLOR_INK)
	porc_legend_label.add_theme_color_override("font_color", COLOR_INK)

func _style_hole_button(btn: Button) -> void:
	# All visible art for a hole (mound + critter) is painted by Main._draw()
	# underneath this button - the button itself only needs to exist as an
	# invisible, focus-ring-free hit-box for input.
	var empty := StyleBoxEmpty.new()
	btn.add_theme_stylebox_override("normal", empty)
	btn.add_theme_stylebox_override("hover", empty)
	btn.add_theme_stylebox_override("pressed", empty)
	btn.add_theme_stylebox_override("focus", empty)
	btn.add_theme_stylebox_override("disabled", empty)

func _style_round_button(btn: Button, bg: Color, border: Color, radius: int) -> void:
	var normal := StyleBoxFlat.new()
	normal.bg_color = bg
	normal.set_corner_radius_all(radius)
	normal.set_border_width_all(3)
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
