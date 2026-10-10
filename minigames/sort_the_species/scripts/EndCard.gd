class_name EndCard
extends Control

# Shared end-of-round card for every CAP minigame. The master copy lives in
# minigames/_shared/EndCard.gd; scripts/sync_shared.mjs copies it into each
# game's scripts/ folder (Godot can't load res:// files from outside a
# project). Edit the master, then re-run the sync -- never edit a copy.
#
# Usage, from a game's Main.gd:
#   end_card.game_slug = "mini_snake"
#   end_card.play_again_pressed.connect(_start_game)
#   end_card.exit_pressed.connect(_on_exit_pressed)
#   end_card.show_result("You Win!", EndCard.OUTCOME_WIN, [EndCard.stat("Score", 7)])
#   end_card.hide_card()                         # at the start of every round
#   EndCard.notify_host_complete("mini_snake")   # from Exit and the top-bar X
#
# Host contract (see frontend/src/components/MinigameOverlay.tsx):
#   minigame-result   -- sent by show_result(); the overlay stays open
#   minigame-complete -- sent on Exit / X; the overlay closes
#   minigame-hello    -- sent by an inline <head> script in the export
#                        preset (html/head_include), not from here, so the
#                        host knows this build reports results before the
#                        engine has even booted

signal play_again_pressed
signal exit_pressed

const OUTCOME_WIN := "win"
const OUTCOME_LOSE := "lose"
const OUTCOME_TIMEUP := "timeup"
const OUTCOME_FINISHED := "finished"

# Brand palette, mirrored from frontend/src/index.css's --cap-* tokens.
const COLOR_OUTLINE := Color("#14181a")
const COLOR_PARCHMENT := Color("#f0dec0")
const COLOR_WOOD_LIGHT := Color("#a9773f")
const COLOR_WOOD_MID := Color("#8a5a2f")
const COLOR_WOOD_DARK := Color("#6e4523")
const COLOR_INK := Color("#1e2b2e")
const COLOR_BODY_TEXT := Color("#45585d")
const COLOR_HEADER_GREEN := Color("#144f05")
const COLOR_ADVENTURE_GREEN := Color("#3b7801")

const BOARD_WIDTH := 340.0
const BOARD_PAD := 20.0
const TITLE_HEIGHT := 56.0
const STATS_HEIGHT := 78.0
const BUTTON_HEIGHT := 52.0
const GAP := 12.0

@export var game_slug := ""

# The game's design canvas (400x660 or 400x600, see each project.godot).
var _canvas_size := Vector2(400, 600)
var _board: Control
# Wood backdrop, rebuilt per result since its height depends on the stats.
var _board_bg: Control
var _title_label: Label
var _stats_card: Control
var _stats_row: HBoxContainer
var _play_again_holder: Control
var _exit_holder: Control

func _ready() -> void:
	visible = false
	mouse_filter = Control.MOUSE_FILTER_STOP
	_canvas_size = get_viewport_rect().size
	position = Vector2.ZERO
	size = _canvas_size
	_build()

static func stat(label: String, value: float, display: String = "") -> Dictionary:
	# display overrides how the value is shown (e.g. "12.3s"); the host always
	# gets the raw number.
	return {"label": label, "value": value, "display": display if display != "" else _format_number(value)}

# Shows the card for a finished round and reports the result to the host.
# outcome is one of the OUTCOME_* constants; stats is an Array of stat()
# dictionaries -- the same numbers the game's pill row shows. Pass [] for a
# game with nothing to show (title and buttons only).
func show_result(title: String, outcome: String, stats: Array) -> void:
	_title_label.text = title
	for child in _stats_row.get_children():
		child.queue_free()
	for s in stats:
		_stats_row.add_child(_make_stat_pill(s))
	_layout(not stats.is_empty())
	visible = true
	_play_in()
	_notify_host_result(outcome, stats)

func hide_card() -> void:
	visible = false

static func notify_host_complete(slug: String) -> void:
	# Tells the React MinigameOverlay the guest is done (Exit or the X) so it
	# can close. No-op outside a web export.
	if OS.has_feature("web"):
		JavaScriptBridge.eval("window.parent.postMessage(%s, '*');" % JSON.stringify({"type": "minigame-complete", "game": slug}))

func _notify_host_result(outcome: String, stats: Array) -> void:
	if not OS.has_feature("web"):
		return
	var payload_stats := {}
	for s in stats:
		payload_stats[String(s["label"]).to_lower().replace(" ", "_")] = s["value"]
	var payload := {"type": "minigame-result", "game": game_slug, "outcome": outcome, "stats": payload_stats}
	JavaScriptBridge.eval("window.parent.postMessage(%s, '*');" % JSON.stringify(payload))

static func _format_number(value: float) -> String:
	if is_equal_approx(value, roundf(value)):
		return str(int(roundf(value)))
	return "%.1f" % value

# ---------------------------------------------------------------------------
# Node construction. Everything is built in code (Panels + StyleBoxFlat, no
# image assets) so this one file is the whole card and the .tscn only needs a
# single Control node pointing at it.
# ---------------------------------------------------------------------------

func _build() -> void:
	var dim := ColorRect.new()
	dim.color = Color(0, 0, 0, 0.55)
	dim.position = Vector2.ZERO
	dim.size = _canvas_size
	dim.mouse_filter = Control.MOUSE_FILTER_STOP
	add_child(dim)

	_board = Control.new()
	_board.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_board)
	_board_bg = Control.new()
	_board_bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_board.add_child(_board_bg)

	var inner_w := BOARD_WIDTH - BOARD_PAD * 2

	_title_label = Label.new()
	_title_label.size = Vector2(inner_w, TITLE_HEIGHT)
	_title_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_title_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_title_label.add_theme_font_size_override("font_size", 30)
	_title_label.add_theme_color_override("font_color", Color(1, 1, 1))
	_title_label.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.55))
	_title_label.add_theme_constant_override("shadow_offset_x", 2)
	_title_label.add_theme_constant_override("shadow_offset_y", 2)
	_title_label.add_theme_color_override("font_outline_color", COLOR_WOOD_DARK)
	_title_label.add_theme_constant_override("outline_size", 4)
	_board.add_child(_title_label)

	# Parchment inset holding one pill per stat.
	_stats_card = Control.new()
	_stats_card.size = Vector2(inner_w, STATS_HEIGHT)
	_stats_card.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_stats_card.add_child(_make_panel(Rect2(Vector2(2, 2), _stats_card.size), COLOR_OUTLINE, Color(0, 0, 0, 0), 0, 14))
	_stats_card.add_child(_make_panel(Rect2(Vector2.ZERO, _stats_card.size), COLOR_PARCHMENT, COLOR_OUTLINE, 2, 14))
	_stats_row = HBoxContainer.new()
	_stats_row.alignment = BoxContainer.ALIGNMENT_CENTER
	_stats_row.add_theme_constant_override("separation", 10)
	_stats_row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_stats_row.position = Vector2(10, 10)
	_stats_row.size = Vector2(inner_w - 20, STATS_HEIGHT - 20)
	_stats_card.add_child(_stats_row)
	_board.add_child(_stats_card)

	var play_again := _make_button("Play Again", COLOR_ADVENTURE_GREEN, COLOR_HEADER_GREEN, Color(1, 1, 1))
	play_again.pressed.connect(func(): play_again_pressed.emit())
	_play_again_holder = _make_button_holder(play_again, inner_w)
	_board.add_child(_play_again_holder)
	var exit_btn := _make_button("Exit", COLOR_PARCHMENT, COLOR_OUTLINE, COLOR_INK)
	exit_btn.pressed.connect(func(): exit_pressed.emit())
	_exit_holder = _make_button_holder(exit_btn, inner_w)
	_board.add_child(_exit_holder)

	_layout(true)

# Positions are recomputed per result, since a game with no stats (Kangaroo
# Hop) gets a shorter board.
func _layout(has_stats: bool) -> void:
	var height := BOARD_PAD + TITLE_HEIGHT + GAP
	if has_stats:
		height += 4 + STATS_HEIGHT + GAP
	height += BUTTON_HEIGHT * 2 + GAP + BOARD_PAD
	_board.position = Vector2((_canvas_size.x - BOARD_WIDTH) / 2, round((_canvas_size.y - height) / 2) - 10)
	_board.size = Vector2(BOARD_WIDTH, height)
	_board.pivot_offset = _board.size / 2

	for child in _board_bg.get_children():
		child.queue_free()
	_board_bg.add_child(_make_panel(Rect2(Vector2(4, 4), _board.size), COLOR_OUTLINE, Color(0, 0, 0, 0), 0, 20))
	_board_bg.add_child(_make_panel(Rect2(Vector2.ZERO, _board.size), COLOR_WOOD_MID, COLOR_OUTLINE, 3, 20))
	# Lighter title plank, then a seam -- the same light-over-dark wood look as
	# the games' own _draw_wood_panel() highlight band.
	var seam_y := BOARD_PAD + TITLE_HEIGHT + GAP * 0.5
	var hl := _make_panel(Rect2(Vector2(3, 3), Vector2(BOARD_WIDTH - 6, seam_y - 3)), Color(COLOR_WOOD_LIGHT, 0.5), Color(0, 0, 0, 0), 0, 17)
	var hl_sb := hl.get_theme_stylebox("panel") as StyleBoxFlat
	hl_sb.corner_radius_bottom_left = 0
	hl_sb.corner_radius_bottom_right = 0
	_board_bg.add_child(hl)
	_board_bg.add_child(_make_panel(Rect2(Vector2(3, seam_y), Vector2(BOARD_WIDTH - 6, 2)), Color(COLOR_WOOD_DARK, 0.8), Color(0, 0, 0, 0), 0, 0))

	var y := BOARD_PAD
	_title_label.position = Vector2(BOARD_PAD, y)
	y += TITLE_HEIGHT + GAP
	_stats_card.visible = has_stats
	if has_stats:
		y += 4
		_stats_card.position = Vector2(BOARD_PAD, y)
		y += STATS_HEIGHT + GAP
	_play_again_holder.position = Vector2(BOARD_PAD, y)
	y += BUTTON_HEIGHT + GAP
	_exit_holder.position = Vector2(BOARD_PAD, y)

# A button with its hard pop shadow behind it.
func _make_button_holder(btn: Button, width: float) -> Control:
	var holder := Control.new()
	holder.size = Vector2(width, BUTTON_HEIGHT)
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	holder.add_child(_make_panel(Rect2(Vector2(3, 3), holder.size), COLOR_OUTLINE, Color(0, 0, 0, 0), 0, BUTTON_HEIGHT / 2))
	btn.position = Vector2.ZERO
	btn.size = holder.size
	holder.add_child(btn)
	return holder

func _make_button(text: String, bg: Color, border: Color, font_color: Color) -> Button:
	var btn := Button.new()
	btn.text = text
	btn.focus_mode = Control.FOCUS_NONE
	btn.add_theme_font_size_override("font_size", 22)
	var normal := StyleBoxFlat.new()
	normal.bg_color = bg
	normal.set_corner_radius_all(int(BUTTON_HEIGHT / 2))
	normal.set_border_width_all(3)
	normal.border_color = border
	var hover := normal.duplicate()
	hover.bg_color = bg.lightened(0.08)
	var pressed := normal.duplicate()
	pressed.bg_color = bg.darkened(0.12)
	btn.add_theme_stylebox_override("normal", normal)
	btn.add_theme_stylebox_override("hover", hover)
	btn.add_theme_stylebox_override("pressed", pressed)
	btn.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
	for key in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color"]:
		btn.add_theme_color_override(key, font_color)
	return btn

func _make_stat_pill(s: Dictionary) -> Control:
	var pill := PanelContainer.new()
	pill.custom_minimum_size = Vector2(110, 0)
	pill.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	pill.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(1, 1, 1, 0.45)
	sb.set_corner_radius_all(12)
	sb.set_border_width_all(2)
	sb.border_color = Color(COLOR_WOOD_MID, 0.6)
	pill.add_theme_stylebox_override("panel", sb)
	var box := VBoxContainer.new()
	box.alignment = BoxContainer.ALIGNMENT_CENTER
	box.add_theme_constant_override("separation", 0)
	box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	pill.add_child(box)
	var caption := Label.new()
	caption.text = String(s["label"]).to_upper()
	caption.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	caption.add_theme_font_size_override("font_size", 12)
	caption.add_theme_color_override("font_color", COLOR_BODY_TEXT)
	box.add_child(caption)
	var value := Label.new()
	value.text = String(s["display"])
	value.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	value.add_theme_font_size_override("font_size", 26)
	value.add_theme_color_override("font_color", COLOR_INK)
	box.add_child(value)
	return pill

func _make_panel(rect: Rect2, bg: Color, border: Color, border_width: int, radius: float) -> Panel:
	var panel := Panel.new()
	panel.position = rect.position
	panel.size = rect.size
	panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var sb := StyleBoxFlat.new()
	sb.bg_color = bg
	sb.set_corner_radius_all(int(radius))
	sb.set_border_width_all(border_width)
	sb.border_color = border
	panel.add_theme_stylebox_override("panel", sb)
	return panel

func _play_in() -> void:
	_board.scale = Vector2(0.92, 0.92)
	_board.modulate = Color(1, 1, 1, 0)
	var tween := create_tween().set_parallel(true).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	tween.tween_property(_board, "scale", Vector2.ONE, 0.22)
	tween.tween_property(_board, "modulate", Color(1, 1, 1, 1), 0.15)
