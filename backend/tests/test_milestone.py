"""Unit tests for the milestone math — tech spec section 4.2 / 5."""

from app.services.milestone import DIAGONAL_A, DIAGONAL_B, X_SHAPE, detect_new_milestones


def _no_prior():
    return {"achieved_lines": set(), "achieved_x": False, "achieved_blackout": False}


def test_row_line_triggers_bingo_with_exact_tile_indices():
    row_2 = {10, 11, 12, 13, 14}
    hits = detect_new_milestones(row_2, **_no_prior())

    assert len(hits) == 1
    hit = hits[0]
    assert hit.type == "line"
    assert hit.message == "BINGO"
    assert set(hit.tile_indices) == row_2
    assert hit.line_index == 2  # rows are line indices 0-4


def test_column_line_triggers_bingo_with_exact_tile_indices():
    col_3 = {3, 8, 13, 18, 23}
    hits = detect_new_milestones(col_3, **_no_prior())

    assert len(hits) == 1
    hit = hits[0]
    assert hit.type == "line"
    assert set(hit.tile_indices) == col_3
    assert hit.line_index == 5 + 3  # cols are line indices 5-9, col 3 -> index 8


def test_all_ten_lines_are_individually_detected():
    from app.services.milestone import LINES

    assert len(LINES) == 10
    for line_index, line in enumerate(LINES):
        hits = detect_new_milestones(set(line), **_no_prior())
        line_hits = [h for h in hits if h.type == "line"]
        assert len(line_hits) == 1
        assert line_hits[0].line_index == line_index


def test_x_shape_requires_all_nine_tiles_not_just_five_filled_tiles():
    # Five arbitrary filled tiles (not the X shape) must NOT trigger the X milestone —
    # this is explicitly called out in the spec as "not just any 5 filled tiles".
    five_arbitrary = {0, 1, 2, 3, 4}
    hits = detect_new_milestones(five_arbitrary, **_no_prior())
    assert not any(h.type == "x" for h in hits)


def test_x_shape_triggers_on_exactly_the_nine_diagonal_tiles():
    assert len(X_SHAPE) == 9
    assert 12 in DIAGONAL_A and 12 in DIAGONAL_B  # shared center tile

    hits = detect_new_milestones(set(X_SHAPE), **_no_prior())
    x_hits = [h for h in hits if h.type == "x"]
    assert len(x_hits) == 1
    assert x_hits[0].message == "X MARKS THE SPOT"
    assert set(x_hits[0].tile_indices) == X_SHAPE


def test_x_shape_does_not_trigger_with_one_tile_missing():
    incomplete = set(X_SHAPE) - {24}
    hits = detect_new_milestones(incomplete, **_no_prior())
    assert not any(h.type == "x" for h in hits)


def test_blackout_requires_all_25_tiles():
    all_but_one = set(range(25)) - {24}
    hits = detect_new_milestones(all_but_one, **_no_prior())
    assert not any(h.type == "blackout" for h in hits)

    hits = detect_new_milestones(set(range(25)), **_no_prior())
    blackout_hits = [h for h in hits if h.type == "blackout"]
    assert len(blackout_hits) == 1
    assert blackout_hits[0].message == "BLACKOUT"
    assert set(blackout_hits[0].tile_indices) == set(range(25))


def test_already_achieved_milestones_do_not_refire():
    row_0 = {0, 1, 2, 3, 4}
    hits = detect_new_milestones(row_0, achieved_lines={0}, achieved_x=False, achieved_blackout=False)
    assert hits == []

    hits = detect_new_milestones(set(X_SHAPE), achieved_lines=set(), achieved_x=True, achieved_blackout=False)
    assert not any(h.type == "x" for h in hits)

    hits = detect_new_milestones(
        set(range(25)), achieved_lines=set(range(10)), achieved_x=True, achieved_blackout=True
    )
    assert hits == []


def test_completion_closing_a_row_and_column_at_once_queues_both():
    # Row 0 and col 0 share tile index 0 — completing that tile last closes both
    # in the same check, and both must be reported, not just one.
    completed = {0, 1, 2, 3, 4, 5, 10, 15, 20}  # row 0 union col 0
    hits = detect_new_milestones(completed, achieved_lines=set(), achieved_x=False, achieved_blackout=False)

    line_hits = [h for h in hits if h.type == "line"]
    assert {h.line_index for h in line_hits} == {0, 5}


def test_completing_the_final_tile_can_trigger_every_shape_at_once():
    # Rare edge case per spec: the very last tile completed closes every row,
    # column, the X, and the blackout simultaneously — nothing should be dropped.
    hits = detect_new_milestones(set(range(25)), achieved_lines=set(), achieved_x=False, achieved_blackout=False)

    types = [h.type for h in hits]
    assert types.count("line") == 10
    assert types.count("x") == 1
    assert types.count("blackout") == 1
