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
const PLAY_TOP := 170.0
const PLAY_BOTTOM := 500.0
const BIN_TOP := PLAY_BOTTOM
const BIN_BOTTOM := VIEWPORT_HEIGHT

const ITEM_RADIUS := 24.0
const BIN_ICON_RADIUS := 19.0
const BIN_ICON_Y := BIN_TOP + 36.0

const FALL_SPEED := 200.0
const SPAWN_INTERVAL := 2.6
const GRAB_RADIUS := 42.0

const TARGET_CORRECT := 8
const MAX_MISSES := 4

const READY_COUNTDOWN := ["Ready?", "3", "2", "1", "Go!"]
const READY_STEP_DURATION := 0.5

# Godot's default font (used by the Web export) has no emoji glyphs -
# confirmed elsewhere in this repo (Card Flip Pairs / project memory) as a
# "tofu" missing-glyph box in the HTML5 export. Species icons are drawn from
# real photo textures (see SPECIES_TEXTURES below) via _draw_species_icon(),
# so this doesn't matter here, but the roster stays text-driven for labels.
const SPECIES_POOL := ["Capybara", "Alpaca", "Chicken"]

# --- Layout rects (design canvas is 400x600, see project.godot). Purely
# cosmetic - none of this feeds gameplay math, which stays driven entirely by
# PLAY_TOP/PLAY_BOTTOM/BIN_TOP/BIN_BOTTOM/LANE_WIDTH above (left untouched by
# this art pass) and only touches pixels through those same constants at draw
# time, mirroring Mini Snake's SIGN_RECT/STATS_RECT-style layout consts.
const SIGN_RECT := Rect2(4, 4, 392, 56)
const STATS_RECT := Rect2(4, 68, 392, 54)
const CORRECT_PILL_RECT := Rect2(14, 73, 181, 44)
const MISSED_PILL_RECT := Rect2(205, 73, 181, 44)
const BINS_SHELF_RECT := Rect2(4, 504, 392, 92)
const BUCKET_PANEL_TOP := BIN_TOP + 12.0
const BUCKET_PANEL_HEIGHT := 78.0
const BUCKET_PANEL_MARGIN := 8.0

# --- Brand palette. Mirrors frontend/src/index.css's --cap-* tokens so this
# game's chrome reads as the same parchment/wood UI system as the rest of the
# app (copied from Mini Snake's Main.gd, which has the reference build-out).
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

# Game-specific: the play field reads as a "sorting chute" (dark mossy green
# track with lighter dividers), distinct from the wood/parchment chrome
# framing it.
const COLOR_FIELD_BG := Color("#243626")
const COLOR_LANE_DIVIDER := Color("#3a5236")

# Per-species silhouette colors. Each animal gets a pale/fluffy "body" tone
# (used for the bulk of the icon) and a more saturated "accent" tone (used
# for small features on the icon AND as that species' bucket color-code /
# label color, so the same hue means the same animal everywhere on screen).
const COLOR_CHICKEN_BODY := Color("#f7efe1")
const COLOR_CHICKEN_ACCENT := Color("#d9432e")
const COLOR_CHICKEN_BEAK := Color("#f2b705")
const COLOR_CHICKEN_EYE := Color("#1e2b2e")

const COLOR_ALPACA_BODY := Color("#e3c9a0")
const COLOR_ALPACA_ACCENT := Color("#a9773f")
const COLOR_ALPACA_EYE := Color("#1e2b2e")

const COLOR_CAPYBARA_BODY := Color("#8a6a45")
const COLOR_CAPYBARA_ACCENT := Color("#4a331d")
const COLOR_CAPYBARA_EYE := Color("#1e2b2e")

# Real photo-style art for the falling items / bucket-lid icons, replacing
# the procedural silhouettes below. Shared by both draw call sites (falling
# items at ITEM_RADIUS and bucket lids at BIN_ICON_RADIUS) via
# _draw_species_icon()'s contain-fit texture draw.
const SPECIES_TEXTURES := {
	"Capybara": preload("res://assets/capybara.png"),
	"Alpaca": preload("res://assets/alpaca.png"),
	"Chicken": preload("res://assets/chicken.png"),
}

@onready var spawn_timer: Timer = $SpawnTimer
@onready var title_label: Label = $UI/SignBar/TitleLabel
@onready var correct_label: Label = $UI/StatsBar/CorrectPill/ValueLabel
@onready var missed_label: Label = $UI/StatsBar/MissedPill/ValueLabel
@onready var correct_caption_label: Label = $UI/StatsBar/CorrectPill/CaptionLabel
@onready var missed_caption_label: Label = $UI/StatsBar/MissedPill/CaptionLabel
@onready var status_label: Label = $UI/StatusLabel
@onready var top_exit_button: Button = $UI/SignBar/ExitButton
@onready var bin_labels: Array[Label] = [$UI/Bins/BinLabel0, $UI/Bins/BinLabel1, $UI/Bins/BinLabel2]
@onready var end_card: EndCard = $UI/EndCard

# Each entry: {"lane": int (spawn lane, informational only), "x": float,
# "y": float, "species": String}. Data-driven and drawn via _draw(), same
# convention as Obstacle Dodge's `obstacles` array - no per-item scene nodes.
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
	_style_ui()
	spawn_timer.wait_time = SPAWN_INTERVAL
	spawn_timer.timeout.connect(_spawn_item)
	end_card.play_again_pressed.connect(_start_game)
	top_exit_button.pressed.connect(_on_exit_pressed)
	end_card.exit_pressed.connect(_on_exit_pressed)
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
	end_card.hide_card()
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
		# Bucket label text is tinted to match that species' accent color so
		# the label reinforces the same color-coding as the bucket panel's
		# accent bar and the falling item's own icon accent.
		var accent := _species_accent_color(bin_species[lane])
		bin_labels[lane].add_theme_color_override("font_color", accent)

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
# way whenever it points past i - otherwise a drag held on a later item could
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
	end_card.show_result(
		"Great Sorting!" if won else "Too Many Missed",
		EndCard.OUTCOME_WIN if won else EndCard.OUTCOME_LOSE,
		[
			EndCard.stat("Correct", correct_count),
			EndCard.stat("Missed", missed_count, "%d / %d" % [missed_count, MAX_MISSES]),
		],
	)

func _on_exit_pressed() -> void:
	is_running = false
	round_token += 1
	spawn_timer.stop()
	held_index = -1
	EndCard.notify_host_complete("sort_the_species")

func _update_labels() -> void:
	correct_label.text = "%d" % correct_count
	missed_label.text = "%d / %d" % [missed_count, MAX_MISSES]

# ---------------------------------------------------------------------------
# Drawing. Main is a Node2D so everything here renders beneath the $UI
# CanvasLayer's real Label/Button nodes (CanvasLayer always composites above
# the base 2D canvas), the same layering Mini Snake and Card Flip Pairs rely
# on for their chrome.
# ---------------------------------------------------------------------------

func _draw() -> void:
	_draw_page_bg()
	_draw_field()
	_draw_bins()
	_draw_sign_plank()
	_draw_stats_bar()

func _draw_page_bg() -> void:
	var vp := get_viewport_rect().size
	draw_rect(Rect2(Vector2.ZERO, vp), COLOR_PAGE_BG, true)

func _draw_field() -> void:
	var field_rect := Rect2(Vector2(0, PLAY_TOP), Vector2(VIEWPORT_WIDTH, PLAY_BOTTOM - PLAY_TOP))
	draw_rect(field_rect, COLOR_FIELD_BG, true)
	for lane in range(1, LANE_COUNT):
		var x: float = lane * LANE_WIDTH
		draw_line(Vector2(x, PLAY_TOP), Vector2(x, PLAY_BOTTOM), COLOR_LANE_DIVIDER, 2.0)
	for item in items:
		_draw_species_icon(item["species"], Vector2(item["x"], item["y"]), ITEM_RADIUS)

func _draw_bins() -> void:
	_draw_wood_panel(BINS_SHELF_RECT, 14.0)
	for lane in range(LANE_COUNT):
		_draw_bucket_panel(lane)

func _bucket_rect(lane: int) -> Rect2:
	return Rect2(lane * LANE_WIDTH + BUCKET_PANEL_MARGIN, BUCKET_PANEL_TOP, LANE_WIDTH - BUCKET_PANEL_MARGIN * 2, BUCKET_PANEL_HEIGHT)

func _draw_bucket_panel(lane: int) -> void:
	var species: String = bin_species[lane]
	var rect := _bucket_rect(lane)
	_draw_parchment_pill(rect, 12.0)
	# Colored accent bar along the top of the pill, matching the species'
	# accent color used on its icon and label - the "clear color-coding" cue.
	var accent_rect := Rect2(rect.position + Vector2(3, 3), Vector2(rect.size.x - 6, 8))
	var accent_sb := StyleBoxFlat.new()
	accent_sb.bg_color = _species_accent_color(species)
	accent_sb.corner_radius_top_left = 9
	accent_sb.corner_radius_top_right = 9
	draw_style_box(accent_sb, accent_rect)
	_draw_species_icon(species, Vector2(_lane_x(lane), BIN_ICON_Y), BIN_ICON_RADIUS)

func _draw_sign_plank() -> void:
	_draw_wood_panel(SIGN_RECT, 14.0)

func _draw_stats_bar() -> void:
	_draw_parchment_pill(STATS_RECT, 16.0)
	_draw_parchment_pill(CORRECT_PILL_RECT, 10.0)
	_draw_parchment_pill(MISSED_PILL_RECT, 10.0)

func _species_accent_color(species: String) -> Color:
	match species:
		"Chicken":
			return COLOR_CHICKEN_ACCENT
		"Alpaca":
			return COLOR_ALPACA_ACCENT
		"Capybara":
			return COLOR_CAPYBARA_ACCENT
		_:
			return COLOR_WOOD_MID

func _draw_species_icon(species: String, pos: Vector2, r: float) -> void:
	var tex: Texture2D = SPECIES_TEXTURES.get(species)
	if tex == null:
		draw_circle(pos, r, Color(0.6, 0.6, 0.6))
		return
	var tex_size: Vector2 = tex.get_size()
	var target := r * 2.0
	# Named fit_scale (not "scale") - Node2D already has a built-in `scale`
	# property, and shadowing it here breaks the parser's type inference.
	# Explicit `: float` (rather than `:=`) because min()'s return type isn't
	# statically inferable, which otherwise breaks inference on draw_size too.
	var fit_scale: float = min(target / tex_size.x, target / tex_size.y)
	var draw_size: Vector2 = tex_size * fit_scale
	draw_texture_rect(tex, Rect2(pos - draw_size * 0.5, draw_size), false)

# --- Shared panel drawing helpers, copied/adapted from Mini Snake's Main.gd
# (the reference implementation for this repo's wood-plank/parchment art
# system - GDScript has no cross-project imports, so each minigame keeps its
# own copy). -----------------------------------------------------------------

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
# (which need to stay real nodes for input + text layout) rather than folded
# into _draw(). Bucket label colors are handled separately in
# _shuffle_bin_species() since they depend on the per-round species shuffle.
# ---------------------------------------------------------------------------

func _style_ui() -> void:
	_style_round_button(top_exit_button, COLOR_SUNSET_ORANGE, COLOR_SUNSET_ORANGE_DEEP, 10)

	title_label.add_theme_color_override("font_color", Color(1, 1, 1))
	title_label.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.5))
	title_label.add_theme_constant_override("shadow_offset_x", 1)
	title_label.add_theme_constant_override("shadow_offset_y", 1)

	for lbl in [correct_label, missed_label, correct_caption_label, missed_caption_label]:
		lbl.add_theme_color_override("font_color", COLOR_INK)

	status_label.add_theme_color_override("font_color", Color(1, 1, 1))
	status_label.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.55))
	status_label.add_theme_constant_override("shadow_offset_x", 1)
	status_label.add_theme_constant_override("shadow_offset_y", 1)
	status_label.add_theme_font_size_override("font_size", 14)

	for bin_label in bin_labels:
		bin_label.add_theme_font_size_override("font_size", 15)

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
