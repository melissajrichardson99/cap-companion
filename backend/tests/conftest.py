import pytest

from app import rate_limit, reference_cache


@pytest.fixture(autouse=True)
def _fresh_reference_cache(monkeypatch):
    """Every test starts with an empty, enabled reference cache, whatever
    the developer's environment says, so cached rows from one test's fake
    database can never leak into another's."""
    monkeypatch.delenv("REFERENCE_CACHE_ENABLED", raising=False)
    reference_cache.clear()
    reference_cache.reset_stats()
    yield
    reference_cache.clear()


@pytest.fixture(autouse=True)
def _fresh_device_rate_limits(monkeypatch):
    """Per-device write limits on, and empty, for every test -- tests reuse
    device tokens like "guest-a", so counts would otherwise carry over."""
    monkeypatch.delenv(rate_limit.RATE_LIMITS_ENABLED_ENV, raising=False)
    rate_limit.reset_device_limits()
    yield
    rate_limit.reset_device_limits()
