"""get_or_create_session's last_active_at refresh throttle (app/device_session.py):
the first request for a token always upserts (creating the session), repeat
requests inside LAST_ACTIVE_REFRESH_INTERVAL reuse it with no Supabase call,
and the first request after the interval upserts again so last_active_at
keeps advancing (session cleanup's 14-day inactivity rule depends on it)."""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app import device_session

_T0 = datetime(2026, 10, 12, 12, 0, tzinfo=timezone.utc)


class _FakeSessionsTable:
    """Minimal device_sessions upsert stand-in: one row per token, created
    on first upsert, last_active_at overwritten on every upsert."""

    def __init__(self):
        self.rows: dict[str, dict] = {}
        self.upserts: list[dict] = []
        self._pending = None

    def table(self, name):
        assert name == "device_sessions"
        return self

    def upsert(self, payload, *, on_conflict, default_to_null):
        assert on_conflict == "device_token" and default_to_null is False
        self.upserts.append(payload)
        token = payload["device_token"]
        row = self.rows.setdefault(
            token, {"id": f"00000000-0000-4000-8000-{len(self.rows):012d}", "created_at": payload["last_active_at"]}
        )
        row["last_active_at"] = payload["last_active_at"]
        self._pending = dict(row)
        return self

    def execute(self):
        class _Resp:
            data = [self._pending]

        return _Resp()


@pytest.fixture
def fake(monkeypatch):
    table = _FakeSessionsTable()
    clock = {"now": _T0}
    monkeypatch.setattr(device_session, "get_supabase_client", lambda: table)
    monkeypatch.setattr(device_session, "_now", lambda: clock["now"])
    monkeypatch.setattr(device_session, "_recent_sessions", device_session.OrderedDict())
    table.clock = clock
    return table


def test_first_request_creates_the_session(fake):
    session = device_session.get_or_create_session("token-a")

    assert len(fake.upserts) == 1
    assert fake.upserts[0]["device_token"] == "token-a"
    assert session.last_active_at == _T0


def test_repeat_requests_inside_the_interval_make_no_supabase_call(fake):
    first = device_session.get_or_create_session("token-a")
    fake.clock["now"] = _T0 + timedelta(minutes=4, seconds=59)
    second = device_session.get_or_create_session("token-a")

    assert len(fake.upserts) == 1
    assert second == first


def test_first_request_after_the_interval_refreshes_last_active_at(fake):
    first = device_session.get_or_create_session("token-a")
    later = _T0 + device_session.LAST_ACTIVE_REFRESH_INTERVAL
    fake.clock["now"] = later
    refreshed = device_session.get_or_create_session("token-a")

    assert len(fake.upserts) == 2
    assert refreshed.id == first.id  # same session, not a new one
    assert refreshed.created_at == first.created_at
    assert refreshed.last_active_at == later
    assert fake.rows["token-a"]["last_active_at"] == later.isoformat()


def test_each_token_is_resolved_independently(fake):
    a = device_session.get_or_create_session("token-a")
    b = device_session.get_or_create_session("token-b")

    assert a.id != b.id
    assert len(fake.upserts) == 2


def test_the_interval_stays_far_inside_the_cleanup_threshold():
    from app.services.session_cleanup import INACTIVITY_THRESHOLD

    assert device_session.LAST_ACTIVE_REFRESH_INTERVAL * 100 < INACTIVITY_THRESHOLD


def test_memory_is_bounded_least_recently_used_first(fake, monkeypatch):
    monkeypatch.setattr(device_session, "_RECENT_SESSIONS_MAX", 2)
    device_session.get_or_create_session("token-a")
    device_session.get_or_create_session("token-b")
    device_session.get_or_create_session("token-a")  # cache hit, now most recent
    device_session.get_or_create_session("token-c")  # evicts token-b

    assert list(device_session._recent_sessions) == ["token-a", "token-c"]
    assert len(fake.upserts) == 3
    device_session.get_or_create_session("token-b")  # upserts again, same row
    assert len(fake.upserts) == 4
    assert len(fake.rows) == 3


def test_blank_header_is_still_rejected(fake):
    with pytest.raises(HTTPException) as exc:
        device_session.get_or_create_session("   ")
    assert exc.value.status_code == 400
    assert fake.upserts == []
