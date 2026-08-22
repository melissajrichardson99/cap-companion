extends Node2D

const TARGET_LENGTH := 10
const START_LENGTH := 2
const GROWTH_PER_ROUND := 2
const PRE_DELAY := 0.6
const SHOW_DURATION := 0.55
const GAP_DURATION := 0.25
const ROUND_GAP := 0.9
const TAP_FLASH_DURATION := 0.15

const ANIMAL_NAMES := ["ALPACA", "PIG", "HEN", "EWE"]

# --- Layout rects (design canvas is 400x600, see project.godot). Purely
# cosmetic - none of this feeds gameplay math, which stays entirely in
# sequence/index space. Mirrors Mini Snake's SIGN_RECT/STATS_RECT const
# pattern.
const SIGN_RECT := Rect2(10, 10, 380, 56)
const STATS_RECT := Rect2(10, 74, 380, 54)
const ROUND_PILL_RECT := Rect2(115, 84, 170, 34)
const TIP_RECT := Rect2(10, 530, 380, 58)
const TILE_COW_RECT := Rect2(43, 170, 150, 150)
const TILE_PIG_RECT := Rect2(207, 170, 150, 150)
const TILE_HEN_RECT := Rect2(43, 334, 150, 150)
const TILE_EWE_RECT := Rect2(207, 334, 150, 150)
const TILE_RECTS := [TILE_COW_RECT, TILE_PIG_RECT, TILE_HEN_RECT, TILE_EWE_RECT]

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
const COLOR_GRASS_DARK := Color("#243a1c")
const COLOR_GRASS_LINE := Color("#324d27")
const COLOR_GRASS_BLADE := Color("#4c8a2e")

# Per-animal accent colors used for the tile's glow border when lit. Idle =
# muted/dusty, Lit = bright. Replaces the old raw Button.modulate tint swap;
# same mechanism (index-matched idle/lit arrays). No longer used to tint the
# animal art itself (that's now a real photo texture, drawn unmodulated) but
# still drives the lit border_color/font_color chrome.
const COLOR_ALPACA_IDLE := Color("#c9a978")
const COLOR_ALPACA_LIT := Color("#f0dcb8")
const COLOR_PIG_IDLE := Color("#e28aa0")
const COLOR_PIG_LIT := Color("#ffc0d0")
const COLOR_HEN_IDLE := Color("#d9ab1e")
const COLOR_HEN_LIT := Color("#ffd94d")
const COLOR_EWE_IDLE := Color("#8f9bb3")
const COLOR_EWE_LIT := Color("#c9d4ea")
const IDLE_COLORS := [COLOR_ALPACA_IDLE, COLOR_PIG_IDLE, COLOR_HEN_IDLE, COLOR_EWE_IDLE]
const LIT_COLORS := [COLOR_ALPACA_LIT, COLOR_PIG_LIT, COLOR_HEN_LIT, COLOR_EWE_LIT]

# Real photo-style textures for each tile, index-aligned with TILE_RECTS /
# animal_buttons (0=Alpaca [was Cow, same slot], 1=Pig, 2=Hen/Chicken,
# 3=Ewe/Sheep). Drawn unmodulated in _draw_animal_icon - see note there on
# why lit/idle state is signaled by the panel chrome instead of a tint.
const TILE_TEXTURES := [
	preload("res://assets/alpaca.png"),
	preload("res://assets/pig.png"),
	preload("res://assets/chicken.png"),
	preload("res://assets/sheep.png"),
]

const NAME_LABEL_IDLE_COLOR := Color(0.97, 0.95, 0.9)

@onready var status_label: Label = $UI/StatusLabel
@onready var round_caption_label: Label = $UI/StatsBar/RoundPill/CaptionLabel
@onready var round_value_label: Label = $UI/StatsBar/RoundPill/ValueLabel
@onready var title_label: Label = $UI/SignBar/TitleLabel
@onready var animal_buttons: Array = [
	$UI/AnimalGrid/BtnCow,
	$UI/AnimalGrid/BtnPig,
	$UI/AnimalGrid/BtnHen,
	$UI/AnimalGrid/BtnEwe,
]
@onready var animal_name_labels: Array = [
	$UI/AnimalGrid/NameCow,
	$UI/AnimalGrid/NamePig,
	$UI/AnimalGrid/NameHen,
	$UI/AnimalGrid/NameEwe,
]
@onready var game_over_layer: Control = $UI/GameOverLayer
@onready var result_label: Label = $UI/GameOverLayer/ResultLabel
@onready var score_result_label: Label = $UI/GameOverLayer/ScoreResultLabel
@onready var restart_button: Button = $UI/GameOverLayer/RestartButton
@onready var top_exit_button: Button = $UI/SignBar/ExitButton
@onready var gameover_exit_button: Button = $UI/GameOverLayer/ExitButton

var sequence: Array[int] = []
var player_step: int = 0
var is_running: bool = false
var is_input_enabled: bool = false
# 1-based count of rounds successfully completed + 1 (i.e. the round the
# player is currently on). Distinct from sequence.size(), which is the
# pattern's item count (2/4/6/8/10) - current_round is what the "Round"
# stat box displays (1/2/3/4/5).
var current_round: int = 1
# Per-tile lit state, drawn each frame in _draw() instead of a raw
# Button.modulate swap so the tile can get real chrome (panel + icon).
var tile_lit: Array[bool] = [false, false, false, false]
# Bumped each time a new round starts so stale awaits from a previous
# round (or a round abandoned via exit/restart) can detect they're outdated
# and bail out instead of resuming stale playback/input state.
var round_token: int = 0

func _ready() -> void:
	randomize()
	_style_ui()
	for i in range(animal_buttons.size()):
		var idx := i
		var button: Button = animal_buttons[i]
		button.pressed.connect(func(): _on_animal_pressed(idx))
	restart_button.pressed.connect(_start_game)
	top_exit_button.pressed.connect(_on_exit_pressed)
	gameover_exit_button.pressed.connect(_on_exit_pressed)
	_start_game()

func _start_game() -> void:
	round_token += 1
	sequence.clear()
	player_step = 0
	current_round = 1
	is_running = true
	is_input_enabled = false
	game_over_layer.visible = false
	for i in range(animal_buttons.size()):
		_set_button_lit(i, false)
	for i in range(START_LENGTH):
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
	for i in range(GROWTH_PER_ROUND):
		sequence.append(randi() % ANIMAL_NAMES.size())
	current_round += 1
	_update_labels()
	_play_sequence(token)

func _set_button_lit(index: int, lit: bool) -> void:
	tile_lit[index] = lit
	var label: Label = animal_name_labels[index]
	label.add_theme_color_override("font_color", LIT_COLORS[index] if lit else NAME_LABEL_IDLE_COLOR)
	queue_redraw()

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
	round_value_label.text = str(current_round)

# ---------------------------------------------------------------------------
# Drawing. Main is a Node2D so everything here renders beneath the $UI
# CanvasLayer's real Label/Button nodes (CanvasLayer always composites above
# the base 2D canvas). The AnimalGrid's Button nodes are made fully
# transparent (see _style_ui) so their only job is hit-testing; all tile
# chrome + the animal silhouette icons are drawn here, underneath them.
# ---------------------------------------------------------------------------

func _draw() -> void:
	_draw_page_bg()
	_draw_sign_plank()
	_draw_stats_bar()
	_draw_animal_tiles()
	_draw_tip_bar()

func _draw_page_bg() -> void:
	var vp := get_viewport_rect().size
	draw_rect(Rect2(Vector2.ZERO, vp), COLOR_PAGE_BG, true)

func _draw_sign_plank() -> void:
	_draw_wood_panel(SIGN_RECT, 14.0)

func _draw_stats_bar() -> void:
	_draw_parchment_pill(STATS_RECT, 16.0)
	_draw_parchment_pill(ROUND_PILL_RECT)

func _draw_tip_bar() -> void:
	_draw_parchment_pill(TIP_RECT, 14.0)
	var cx := TIP_RECT.position.x + 30
	var cy := TIP_RECT.position.y + TIP_RECT.size.y * 0.5
	_draw_lightbulb_icon(Vector2(cx, cy), 12.0)

func _draw_lightbulb_icon(center: Vector2, r: float) -> void:
	draw_circle(center + Vector2(0, -r * 0.15), r * 0.65, Color("#f2b705"))
	var base_sb := StyleBoxFlat.new()
	base_sb.bg_color = COLOR_WOOD_DARK
	base_sb.set_corner_radius_all(2)
	draw_style_box(base_sb, Rect2(center + Vector2(-r * 0.28, r * 0.35), Vector2(r * 0.56, r * 0.35)))
	draw_line(center + Vector2(-r * 0.15, -r * 0.35), center + Vector2(r * 0.1, r * 0.05), COLOR_OUTLINE, 1.5)
	draw_line(center + Vector2(r * 0.15, -r * 0.35), center + Vector2(-r * 0.1, r * 0.05), COLOR_OUTLINE, 1.5)

func _draw_animal_tiles() -> void:
	for i in range(TILE_RECTS.size()):
		_draw_animal_tile(i)

func _draw_animal_tile(index: int) -> void:
	var rect: Rect2 = TILE_RECTS[index]
	var lit: bool = tile_lit[index]
	var shadow_sb := StyleBoxFlat.new()
	shadow_sb.bg_color = COLOR_OUTLINE
	shadow_sb.set_corner_radius_all(16)
	draw_style_box(shadow_sb, Rect2(rect.position + Vector2(3, 3), rect.size))
	var sb := StyleBoxFlat.new()
	sb.bg_color = COLOR_ADVENTURE_GREEN if lit else COLOR_HEADER_GREEN
	sb.set_corner_radius_all(16)
	sb.set_border_width_all(4 if lit else 3)
	sb.border_color = LIT_COLORS[index] if lit else COLOR_OUTLINE
	draw_style_box(sb, rect)
	_draw_animal_icon(rect, index)

func _draw_animal_icon(rect: Rect2, index: int) -> void:
	# Real photo textures are drawn unmodulated regardless of lit state - the
	# panel chrome above (bg_color/border_color/border width in
	# _draw_animal_tile) already carries the lit-vs-idle signal. Tinting a
	# photo by an accent color (the old flat-color-icon approach) would muddy
	# it, so we deliberately don't touch color here.
	var tex: Texture2D = TILE_TEXTURES[index]
	var tex_size := tex.get_size()
	var target_size := rect.size * 0.72
	var icon_scale: float = min(target_size.x / tex_size.x, target_size.y / tex_size.y)
	var draw_size: Vector2 = tex_size * icon_scale
	# 0.42 y-fraction mirrors where the old icons were vertically centered,
	# slightly above tile-center, to leave room for the name label below.
	var center := rect.position + Vector2(rect.size.x * 0.5, rect.size.y * 0.42)
	draw_texture_rect(tex, Rect2(center - draw_size * 0.5, draw_size), false)

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
	_style_round_button(restart_button, COLOR_HEADER_GREEN, COLOR_OUTLINE, 10)
	_style_round_button(gameover_exit_button, COLOR_PARCHMENT, COLOR_OUTLINE, 10)
	gameover_exit_button.add_theme_color_override("font_color", COLOR_INK)
	gameover_exit_button.add_theme_color_override("font_hover_color", COLOR_INK)
	gameover_exit_button.add_theme_color_override("font_pressed_color", COLOR_INK)

	for button in animal_buttons:
		var empty := StyleBoxEmpty.new()
		button.add_theme_stylebox_override("normal", empty)
		button.add_theme_stylebox_override("hover", empty)
		button.add_theme_stylebox_override("pressed", empty)
		button.add_theme_stylebox_override("focus", empty)
		button.add_theme_stylebox_override("disabled", empty)

	for label in animal_name_labels:
		label.add_theme_color_override("font_color", NAME_LABEL_IDLE_COLOR)
		label.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.55))
		label.add_theme_constant_override("shadow_offset_x", 1)
		label.add_theme_constant_override("shadow_offset_y", 1)

	title_label.add_theme_color_override("font_color", Color(1, 1, 1))
	title_label.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.5))
	title_label.add_theme_constant_override("shadow_offset_x", 1)
	title_label.add_theme_constant_override("shadow_offset_y", 1)

	status_label.add_theme_color_override("font_color", COLOR_INK)
	round_caption_label.add_theme_color_override("font_color", COLOR_INK)
	round_value_label.add_theme_color_override("font_color", COLOR_INK)

	result_label.add_theme_color_override("font_color", COLOR_INK)
	score_result_label.add_theme_color_override("font_color", COLOR_INK)

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
