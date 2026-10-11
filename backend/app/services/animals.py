"""The Our Animals roster's slugs, backend side.

Our Animals is static frontend content (frontend/src/animalContent.ts), not
DB-backed, so this is a hardcoded mirror of that file's ANIMAL_DEFINITIONS
slugs -- keep the two in sync if animals are added/renamed. It's what QR
scans resolve against (scan.py's manual entry, qr_locations.py's heatmap
logging and Staff QR Code Directory locations).

Deliberately separate from collectibles.COLLECTIBLE_SLUGS: the Collectible
Cards shop sells only the animals with a curated photo pool, so a new Our
Animals page doesn't automatically become a buyable card.
"""

ANIMAL_SLUGS = [
    "capybara",
    "kangaroo",
    "alpaca",
    "emu",
    "wallaby",
    "goat",
    "sloth",
    "porcupine",
    "pig",
    "wallaroo",
    "tamandua",
    "sugar-glider",
    "tortoise",
    "iguana",
    "snake",
    "sheep",
    "rabbit",
    "ferret",
    "chicken",
    "duck",
]
