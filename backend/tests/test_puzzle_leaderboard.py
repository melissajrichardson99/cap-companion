"""Unit tests for puzzle leaderboard ranking/filtering — Plan.md 2.3."""

from datetime import datetime, timedelta, timezone

from app.services.puzzle_leaderboard import AttemptRecord, rank_attempts

NOW = datetime(2026, 8, 5, 18, 0, tzinfo=timezone.utc)


def _attempt(id_: str, elapsed: int, when: datetime) -> AttemptRecord:
    return AttemptRecord(id=id_, elapsed_seconds=elapsed, created_at=when)


def test_all_time_ranks_fastest_first_regardless_of_date():
    attempts = [
        _attempt("a", 90, NOW - timedelta(days=5)),
        _attempt("b", 30, NOW),
        _attempt("c", 60, NOW - timedelta(days=1)),
    ]
    ranked = rank_attempts(attempts, scope="all_time", now=NOW)
    assert [a.id for a in ranked] == ["b", "c", "a"]


def test_daily_scope_excludes_attempts_from_other_calendar_days():
    attempts = [
        _attempt("today_fast", 40, NOW),
        _attempt("today_slow", 80, NOW - timedelta(hours=2)),
        _attempt("yesterday_faster", 10, NOW - timedelta(days=1)),
    ]
    ranked = rank_attempts(attempts, scope="daily", now=NOW)
    assert [a.id for a in ranked] == ["today_fast", "today_slow"]


def test_daily_scope_with_no_attempts_today_is_empty():
    attempts = [_attempt("yesterday", 10, NOW - timedelta(days=1))]
    ranked = rank_attempts(attempts, scope="daily", now=NOW)
    assert ranked == []


def test_limit_caps_the_returned_count():
    attempts = [_attempt(str(i), i, NOW) for i in range(1, 21)]
    ranked = rank_attempts(attempts, scope="all_time", now=NOW, limit=5)
    assert len(ranked) == 5
    assert [a.elapsed_seconds for a in ranked] == [1, 2, 3, 4, 5]
