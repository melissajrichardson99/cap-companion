"""The reference-cache helper itself (app/reference_cache.py): TTL expiry
with a controlled clock, explicit invalidation (including a load that was
already in flight when the write happened), the kill switch, shared loads
for concurrent misses, the size bound, and copy-on-read."""

import threading

import pytest

from app import reference_cache


@pytest.fixture
def clock(monkeypatch):
    now = {"t": 1000.0}
    monkeypatch.setattr(reference_cache, "_clock", lambda: now["t"])
    return now


class _Loader:
    def __init__(self, *values):
        self.values = list(values)
        self.calls = 0

    def __call__(self):
        self.calls += 1
        return self.values[min(self.calls, len(self.values)) - 1]


def test_second_get_is_a_hit_and_skips_the_loader(clock):
    load = _Loader([{"id": 1}])
    assert reference_cache.get("k", load) == [{"id": 1}]
    assert reference_cache.get("k", load) == [{"id": 1}]
    assert load.calls == 1
    assert reference_cache.stats()["k"] == {"hits": 1, "misses": 1, "invalidations": 0}


def test_entry_expires_after_its_ttl_and_refetches(clock):
    load = _Loader(["old"], ["new"])
    reference_cache.get("k", load, ttl=60)
    clock["t"] += 59.9
    assert reference_cache.get("k", load, ttl=60) == ["old"]
    clock["t"] += 0.2
    assert reference_cache.get("k", load, ttl=60) == ["new"]
    assert load.calls == 2


def test_invalidate_forces_the_next_get_to_reload(clock):
    load = _Loader(["old"], ["new"])
    reference_cache.get("k", load)
    reference_cache.invalidate("k")
    assert reference_cache.get("k", load) == ["new"]
    assert reference_cache.stats()["k"]["invalidations"] == 1


def test_invalidate_only_touches_the_named_keys(clock):
    a, b = _Loader(["a"]), _Loader(["b"])
    reference_cache.get("a", a)
    reference_cache.get("b", b)
    reference_cache.invalidate("a")
    reference_cache.get("a", a)
    reference_cache.get("b", b)
    assert (a.calls, b.calls) == (2, 1)


def test_a_load_in_flight_during_an_invalidate_is_not_stored(clock):
    """A guest read that started before a staff write must not put the
    pre-write rows back into the cache after the write invalidated it."""
    started, release = threading.Event(), threading.Event()

    def slow_stale_load():
        started.set()
        release.wait(5)
        return ["pre-write"]

    result = {}
    t = threading.Thread(target=lambda: result.setdefault("v", reference_cache.get("k", slow_stale_load)))
    t.start()
    started.wait(5)
    reference_cache.invalidate("k")  # the staff write lands mid-load
    release.set()
    t.join(5)

    assert result["v"] == ["pre-write"]  # that request still gets what it read
    fresh = _Loader(["post-write"])
    assert reference_cache.get("k", fresh) == ["post-write"]
    assert fresh.calls == 1


def test_concurrent_misses_share_one_load(clock):
    gate = threading.Event()
    calls = []

    def load():
        calls.append(1)
        gate.wait(5)
        return ["rows"]

    results = []
    threads = [threading.Thread(target=lambda: results.append(reference_cache.get("k", load))) for _ in range(5)]
    for t in threads:
        t.start()
    while not calls:
        pass
    gate.set()
    for t in threads:
        t.join(5)

    assert results == [["rows"]] * 5
    assert len(calls) == 1


def test_a_failing_loader_stores_nothing_and_raises(clock):
    def boom():
        raise RuntimeError("supabase down")

    with pytest.raises(RuntimeError):
        reference_cache.get("k", boom)
    load = _Loader(["ok"])
    assert reference_cache.get("k", load) == ["ok"]


def test_callers_get_copies_so_mutation_cannot_leak(clock):
    reference_cache.get("k", _Loader([{"name": "A"}]))
    first = reference_cache.get("k", _Loader(None))
    first[0]["name"] = "mutated"
    first.append({"name": "extra"})
    assert reference_cache.get("k", _Loader(None)) == [{"name": "A"}]


def test_size_is_bounded_least_recently_used_first(clock, monkeypatch):
    monkeypatch.setattr(reference_cache, "MAX_ENTRIES", 2)
    reference_cache.get("a", _Loader(["a"]))
    reference_cache.get("b", _Loader(["b"]))
    reference_cache.get("a", _Loader(None))  # touch a, so b is the oldest
    reference_cache.get("c", _Loader(["c"]))
    b_again = _Loader(["b2"])
    a_again = _Loader(["a2"])
    assert reference_cache.get("b", b_again) == ["b2"]  # evicted, reloaded
    assert b_again.calls == 1
    reference_cache.get("c", _Loader(None))
    assert reference_cache.get("a", a_again) == ["a2"]  # evicted by b's reload
    assert a_again.calls == 1


@pytest.mark.parametrize("value", ["0", "false", "no", "off", "OFF", " 0 "])
def test_kill_switch_disables_caching_entirely(clock, monkeypatch, value):
    monkeypatch.setenv("REFERENCE_CACHE_ENABLED", value)
    load = _Loader(["one"], ["two"])
    assert reference_cache.get("k", load) == ["one"]
    assert reference_cache.get("k", load) == ["two"]
    assert load.calls == 2
    assert "k" not in reference_cache.stats()


@pytest.mark.parametrize("value", ["1", "true", "yes", ""])
def test_cache_is_on_by_default_and_for_truthy_values(clock, monkeypatch, value):
    monkeypatch.setenv("REFERENCE_CACHE_ENABLED", value)
    assert reference_cache.enabled()
    load = _Loader(["one"])
    reference_cache.get("k", load)
    reference_cache.get("k", load)
    assert load.calls == 1


def test_hits_misses_and_invalidations_are_logged_at_debug(clock, caplog):
    caplog.set_level("DEBUG", logger="app.reference_cache")
    reference_cache.get("k", _Loader(["x"]))
    reference_cache.get("k", _Loader(None))
    reference_cache.invalidate("k")
    messages = [r.getMessage() for r in caplog.records]
    assert "reference cache miss: k" in messages
    assert "reference cache hit: k" in messages
    assert "reference cache invalidate: k" in messages
