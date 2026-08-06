"""Unit tests for scannable-code normalization/generation (QR scanning)."""

from app.services.scan_codes import ADJECTIVES, NOUNS, generate_code, normalize_code


def test_normalize_lowercases_and_trims():
    assert normalize_code("  Brave-Otter  ") == "brave-otter"


def test_normalize_collapses_spaces_to_a_hyphen():
    assert normalize_code("Brave Otter") == "brave-otter"


def test_normalize_collapses_space_hyphen_space():
    assert normalize_code("Brave - Otter") == "brave-otter"


def test_normalize_is_idempotent_on_the_canonical_form():
    assert normalize_code("brave-otter") == "brave-otter"


def test_generate_code_uses_only_curated_words():
    code = generate_code()
    adjective, _, noun = code.partition("-")
    assert adjective in ADJECTIVES
    assert noun in NOUNS


def test_generate_code_avoids_existing_codes():
    # Force every adjective/noun pair but one to be "taken", so the only
    # legal draw left is the untaken one -- proves the exclusion actually works.
    survivor = f"{ADJECTIVES[0]}-{NOUNS[0]}"
    existing = {f"{a}-{n}" for a in ADJECTIVES for n in NOUNS if f"{a}-{n}" != survivor}
    assert generate_code(existing) == survivor
