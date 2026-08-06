"""Word-based scannable codes for park signage (e.g. "brave-otter").

Two curated, common English words joined by a hyphen -- easy to spell and
read aloud, chosen to avoid homophones ("bear"/"bare"), ambiguous/regional
spellings ("grey"/"gray"), and anything inappropriate for a family park.
Deliberately excludes the actual Scavenger Hunt character names and
Encyclopedia animal names as *nouns* here, so a code never doubles as a
spoiler or a duplicate of the thing it points at.
"""

from __future__ import annotations

import random
import re

ADJECTIVES = [
    "brave",
    "happy",
    "silly",
    "quick",
    "gentle",
    "clever",
    "jolly",
    "sunny",
    "lucky",
    "mighty",
    "calm",
    "bright",
    "friendly",
    "curious",
    "playful",
    "swift",
    "bold",
    "cheerful",
    "proud",
    "tiny",
    "giant",
    "quiet",
    "wild",
    "cozy",
    "merry",
    "sleepy",
]

NOUNS = [
    "otter",
    "tiger",
    "panda",
    "eagle",
    "rabbit",
    "turtle",
    "dolphin",
    "koala",
    "penguin",
    "zebra",
    "giraffe",
    "monkey",
    "falcon",
    "badger",
    "beaver",
    "hedgehog",
    "walrus",
    "cheetah",
    "leopard",
    "raccoon",
    "meerkat",
    "gecko",
]

_WHITESPACE_OR_HYPHEN = re.compile(r"[\s-]+")


def normalize_code(raw: str) -> str:
    """Case-insensitive, whitespace-tolerant canonicalization for manual entry.

    "Brave Otter", "  brave-otter  ", and "BRAVE - OTTER" all normalize to
    the same "brave-otter" that's stored in scannable_codes.code.
    """
    return _WHITESPACE_OR_HYPHEN.sub("-", raw.strip().lower())


def generate_code(existing: set[str] | None = None) -> str:
    """Pick a random unused adjective-noun code, for printing new signage."""
    existing = existing or set()
    while True:
        code = f"{random.choice(ADJECTIVES)}-{random.choice(NOUNS)}"
        if code not in existing:
            return code
