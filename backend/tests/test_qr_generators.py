"""The printable-QR scripts (scripts/qr_output.py and the generate_*_qr_codes.py
scripts on top of it): the base URL is a required, checked input -- never
localhost, a private address or plain http unless --allow-insecure -- nothing
is written without confirmation, and every PNG decodes back to the URL its
manifest.csv row says.

The decode round-trips need Node and the frontend's jsqr package (the
verification step's decoder); they're skipped, not failed, without them.
"""

from __future__ import annotations

import argparse
import csv
import shutil
import sys
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

import generate_all_qr_codes  # noqa: E402
import generate_animal_qr_codes  # noqa: E402
import qr_output  # noqa: E402
from qr_output import BaseUrlError, QrEntry, validate_base_url  # noqa: E402

from app import supabase_client  # noqa: E402
from tests.fake_supabase import FakeSupabase  # noqa: E402

_JSQR = SCRIPTS.parents[1] / "frontend" / "node_modules" / "jsqr"
needs_decoder = pytest.mark.skipif(
    shutil.which("node") is None or not _JSQR.exists(), reason="verification needs Node + frontend/node_modules/jsqr"
)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("https://example.com", "https://example.com"),
        ("https://example.com/", "https://example.com"),
        ("  https://park.example.co.uk  ", "https://park.example.co.uk"),
        ("https://park.example.com:8443", "https://park.example.com:8443"),
        ("https://8.8.8.8", "https://8.8.8.8"),
    ],
)
def test_public_https_origins_are_accepted(raw, expected):
    assert validate_base_url(raw) == expected


@pytest.mark.parametrize(
    "raw",
    [
        None,
        "",
        "   ",
        "example.com",
        "ftp://example.com",
        "http://example.com",
        "https://localhost",
        "https://localhost:5173",
        "https://LOCALHOST",
        "https://app.localhost",
        "https://127.0.0.1",
        "https://127.8.9.10",
        "https://0.0.0.0",
        "https://10.0.0.5",
        "https://172.16.0.1",
        "https://192.168.1.10",
        "https://169.254.169.254",
        "https://[::1]",
        "https://[fd00::1]",
        "https://[fe80::1]",
        "https://park.local",
        "https://printer.lan",
        "https://intranet",
        "https://example.com/app",
        "https://example.com/scan/brave-otter",
        "https://example.com?x=1",
        "https://example.com#top",
        "https://user:secret@example.com",
        "https://example.com:notaport",
    ],
)
def test_unusable_base_urls_are_refused(raw):
    with pytest.raises(BaseUrlError):
        validate_base_url(raw)


@pytest.mark.parametrize("raw", ["http://localhost:5173", "http://192.168.1.10:5173", "https://127.0.0.1"])
def test_allow_insecure_permits_local_testing_urls(raw):
    assert validate_base_url(raw, allow_insecure=True) == raw


@pytest.mark.parametrize("raw", ["https://example.com/app", "localhost:5173", "https://u:p@localhost"])
def test_allow_insecure_still_needs_a_bare_origin(raw):
    with pytest.raises(BaseUrlError):
        validate_base_url(raw, allow_insecure=True)


def test_cloudflare_dev_addresses_get_a_warning():
    assert qr_output.base_url_warnings("https://cap.someone.workers.dev")
    assert qr_output.base_url_warnings("https://example.com") == []


# --- run(): the generator flow -------------------------------------------------

ENTRIES = [
    QrEntry(file="goat-qr.png", kind="animal", name="Goat", id="goat", path="/animals/goat"),
    QrEntry(file="mini-golf.png", kind="scoring", name="Mini Golf", id="blacklight-mini-golf", path="/scoring/blacklight-mini-golf"),
]


def _args(out: Path, *extra: str) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    qr_output.add_arguments(parser, out)
    return parser.parse_args([str(out), *extra])


def test_no_base_url_and_no_env_refuses_and_writes_nothing(tmp_path, monkeypatch, capsys):
    monkeypatch.delenv(qr_output.BASE_URL_ENV, raising=False)
    built = []
    assert qr_output.run(_args(tmp_path / "out", "--yes"), lambda: built.append(1) or ENTRIES) == 2
    assert "There is no default" in capsys.readouterr().err
    assert not (tmp_path / "out").exists()
    assert built == []  # nothing (no database read) happens before the URL passes


def test_localhost_from_the_environment_is_refused(tmp_path, monkeypatch):
    monkeypatch.setenv(qr_output.BASE_URL_ENV, "http://localhost:5173")
    assert qr_output.run(_args(tmp_path / "out", "--yes"), lambda: ENTRIES) == 2
    assert not (tmp_path / "out").exists()


def test_without_yes_a_non_interactive_run_writes_nothing(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(sys.stdin, "isatty", lambda: False)
    assert qr_output.run(_args(tmp_path / "out", "--base-url", "https://example.com"), lambda: ENTRIES) == 2
    out = capsys.readouterr()
    assert "These QR codes will encode: https://example.com" in out.out
    assert "nothing written" in out.err
    assert not (tmp_path / "out").exists()


def test_typed_confirmation_must_match_the_host(tmp_path, monkeypatch):
    monkeypatch.setattr(sys.stdin, "isatty", lambda: True)
    monkeypatch.setattr("builtins.input", lambda _prompt: "example.org")
    assert qr_output.run(_args(tmp_path / "out", "--base-url", "https://example.com"), lambda: ENTRIES) == 2
    assert not (tmp_path / "out").exists()


def test_a_folder_with_old_pngs_is_refused_without_overwrite(tmp_path):
    out = tmp_path / "out"
    out.mkdir()
    (out / "old-localhost-code.png").write_bytes(b"old")
    assert qr_output.run(_args(out, "--base-url", "https://example.com", "--yes"), lambda: ENTRIES) == 2
    assert not (out / "manifest.csv").exists()


def test_manifest_lists_every_file_with_its_full_url(tmp_path, monkeypatch):
    monkeypatch.setattr(qr_output, "verify", lambda *a, **k: 0)
    out = tmp_path / "out"
    assert qr_output.run(_args(out, "--base-url", "https://example.com/", "--yes"), lambda: ENTRIES) == 0
    with open(out / "manifest.csv", newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    assert rows == [
        {"file": "goat-qr.png", "kind": "animal", "name": "Goat", "id": "goat", "url": "https://example.com/animals/goat"},
        {
            "file": "mini-golf.png",
            "kind": "scoring",
            "name": "Mini Golf",
            "id": "blacklight-mini-golf",
            "url": "https://example.com/scoring/blacklight-mini-golf",
        },
    ]
    assert sorted(p.name for p in out.glob("*.png")) == ["goat-qr.png", "mini-golf.png"]


@needs_decoder
def test_generated_codes_decode_to_their_manifest_urls(tmp_path, capsys):
    out = tmp_path / "out"
    assert qr_output.run(_args(out, "--base-url", "https://park.example.com", "--yes"), lambda: ENTRIES) == 0
    assert "Verified: all 2 PNG(s)" in capsys.readouterr().out
    assert qr_output.decode_pngs(sorted(out.glob("*.png"))) == {
        "goat-qr.png": "https://park.example.com/animals/goat",
        "mini-golf.png": "https://park.example.com/scoring/blacklight-mini-golf",
    }


@needs_decoder
def test_verify_catches_a_png_that_doesnt_match_its_row(tmp_path, capsys):
    out = tmp_path / "out"
    qr_output.write(ENTRIES, "https://park.example.com", out)
    # Swap two files: each still decodes, but to the other row's URL.
    a, b = out / "goat-qr.png", out / "mini-golf.png"
    a_bytes = a.read_bytes()
    a.write_bytes(b.read_bytes())
    b.write_bytes(a_bytes)
    assert qr_output.verify(out) == 1
    err = capsys.readouterr().err
    assert "goat-qr.png: encodes 'https://park.example.com/scoring/blacklight-mini-golf'" in err


@needs_decoder
def test_verify_catches_strays_missing_files_and_unreadable_pngs(tmp_path, capsys):
    from PIL import Image

    out = tmp_path / "out"
    qr_output.write(ENTRIES, "https://park.example.com", out)
    (out / "mini-golf.png").unlink()
    Image.new("RGB", (100, 100), "white").save(out / "goat-qr.png")
    qr_output.write([QrEntry("x.png", "animal", "X", "x", "/animals/x")], "https://park.example.com", tmp_path / "other")
    shutil.copy(tmp_path / "other" / "x.png", out / "stray.png")
    assert qr_output.verify(out) == 1
    err = capsys.readouterr().err
    assert "mini-golf.png: listed in manifest.csv but missing" in err
    assert "stray.png: not in manifest.csv" in err
    assert "goat-qr.png: no QR code could be decoded" in err


@needs_decoder
def test_verify_refuses_a_folder_made_with_allow_insecure(tmp_path, capsys):
    out = tmp_path / "out"
    assert qr_output.run(_args(out, "--base-url", "http://localhost:5173", "--allow-insecure", "--yes"), lambda: ENTRIES) == 0
    capsys.readouterr()
    assert qr_output.verify(out) == 1  # without --allow-insecure: not printable
    assert "manifest base URL refused" in capsys.readouterr().err


# --- what the scripts cover ----------------------------------------------------


def test_animal_script_covers_all_20_animals():
    entries = generate_animal_qr_codes.animal_entries()
    assert len(entries) == 20
    assert {e.path for e in entries} == {f"/animals/{slug}" for slug in generate_animal_qr_codes.ANIMAL_SLUGS}


def _fake_db(monkeypatch, scoring_slugs):
    fake = FakeSupabase()
    fake.tables["hunt_characters"] += [{"id": "h1", "name": "Capybara", "sort_order": 1}]
    fake.tables["scannable_codes"] += [
        {"code": "brave-otter", "hunt_character_id": "h1"},
        {"code": "quiet-fern", "hunt_character_id": None},
    ]
    fake.tables["scoring_games"] += [
        {"name": s.replace("-", " ").title(), "slug": s, "created_at": f"2026-01-0{i + 1}"} for i, s in enumerate(scoring_slugs)
    ]
    fake.tables["puzzles"] += [{"id": "p1", "name": "Escape Box"}]
    fake.tables["puzzle_challenges"] += [{"puzzle_id": "p1", "label": "Level 1", "slug": "escape-box-1", "sort_order": 1}]
    monkeypatch.setattr(supabase_client, "SUPABASE_URL", "https://fake.supabase.co")
    monkeypatch.setattr(supabase_client, "SUPABASE_KEY", "fake-key")
    monkeypatch.setattr(supabase_client, "_client", fake)
    return fake


def test_all_script_covers_animals_hunt_both_mini_golf_sheets_and_puzzles(monkeypatch):
    _fake_db(monkeypatch, ["cornhole", "blacklight-mini-golf", "cornhole-mini-golf"])
    entries = generate_all_qr_codes.all_entries()
    paths = {e.path for e in entries}
    assert {"/scoring/blacklight-mini-golf", "/scoring/cornhole-mini-golf", "/scoring/cornhole"} <= paths
    assert "/scan/brave-otter" in paths
    assert "/scan/quiet-fern" not in paths  # Encyclopedia placeholder, as in the Staff QR Directory
    assert "/puzzles/escape-box-1" in paths
    assert sum(e.kind == "animal" for e in entries) == 20
    assert len({e.file for e in entries}) == len(entries)


def test_all_script_refuses_a_database_missing_a_mini_golf_sheet(monkeypatch):
    _fake_db(monkeypatch, ["cornhole", "blacklight-mini-golf"])
    with pytest.raises(SystemExit, match="cornhole-mini-golf"):
        generate_all_qr_codes.all_entries()
