import pytest

from app import reference_cache


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
