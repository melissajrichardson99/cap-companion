# Call reduction, Phase 2: backend reference-data cache

2026-10-12. All measurements were on dev (StrictMode, so page loads fire twice), using the same method as Phase 1: an ASGI wrapper around `app.main.app` patching `httpx.Client.send`, with Playwright driving fresh browser contexts and `/__marker/<name>` around each action.

## 1.1 What a full page load calls

`App.tsx`'s mount effect fires the same 14 GETs on every route: 15 with a guest token (`/account/whoami`), plus route-specific extras. All counts below are per request in production (one call each).

| Endpoint | Shared (same for every guest) | Per session / guest |
|---|---|---|
| GET /map/nodes | map_nodes, bingo_tiles (links) | node_visits, session_tile_completions (+ device_sessions for a guest token) |
| GET /bingo/cards | bingo_cards | none |
| GET /bingo/card/:id | bingo_cards, bingo_tiles (card) | session_tile_completions (+ device_sessions for a guest token) |
| GET /bingo/minigames | minigames | none |
| GET /puzzles | puzzles, puzzle_challenges | none |
| GET /scoring/games | scoring_games, game_score_events | none |
| GET /hunt/characters | hunt_characters, hunt_challenges | hunt_progress |
| GET /announcements | announcements | none |
| GET /animal-photos | animal_photos | none |
| GET /photos/gallery | photo_submissions + photo_votes (shortlisted) | none (voted_by_me is computed in Python) |
| GET /coins/summary | none | coin_awards, collectible_redemptions |
| GET /collectibles | none | collectible_redemptions |
| GET /collectibles/catalog | none (0 calls, static) | none |
| GET /staff-requests/mine | none | staff_requests (**also polled every 12 s**) |
| any first request from a new device | none | device_sessions upsert (several in parallel on a cold token) |

Route extras:
- `/` also calls GET /photos/of-the-day (shared: the gallery query).
- `/scan/:code` (Hunt QR) also calls POST /scan-events (shared: scannable_codes; then a background insert), GET /scan/:code (shared: scannable_codes, hunt_characters, hunt_challenges; per session: hunt_progress) and POST /hunt/characters/:id/unlock (a write).
- `/animals/:slug` (animal QR) also calls POST /scan-events (shared: animal_map_locations). Animal content itself is static frontend data.
- `/map` and `/bingo` have no extras: their data comes from the mount fan-out.

## 1.2 Frontend over-fetch (report only, nothing changed)

- **Everything loads on every route.** Home's first paint needs only `/announcements` (popup), `/photos/of-the-day`, `/coins/summary` and `/staff-requests/mine` (both in the header). The other 10 (map nodes, bingo cards, bingo card, puzzles, scoring games, hunt characters, minigames, collectibles catalog, collectibles, gallery, animal photos) are only needed when their screen opens. A QR deep link to `/scan/:code` or `/animals/:slug` pays for all of them too. Lazy-loading per screen (fetch on first visit to that route, keep in App state) would cut a cold page load from 14–15 requests to about 4–6. Bingo minigames are needed only when a tile completes or a Hunt challenge launches one.
- **Contact Staff poll (biggest steady-state cost).** `/staff-requests/mine` is polled every 12 s for as long as the tab is open, whether or not the guest has a request. That is 300 Supabase calls an hour per open tab, it is per-session so it can't be cached, and it also keeps the tab's session refresh alive. Suggestion: poll only while this device has an open or acknowledged request (the guest creates it in this tab, so the tab knows), and pause while `document.hidden`. With no request open this drops to 0. This changes the polling contract, so I left it for you to decide.
- **Parallel cold-token upserts.** A new device's first burst fires 5–6 `device_sessions` upserts (dev), because every parallel request misses the 5-minute session cache at the same moment. A per-token single-flight in `device_session.get_or_create_session`, like the one the reference cache now has, would make that 1. It is per-session code, not reference data, so it was out of scope here.
- Nothing trivial and clearly safe stood out to change now, so **no frontend change was made**.

## 1.3 Where reference data changes

The backend is one uvicorn process (`render.yaml`: `uvicorn app.main:app`, no `--workers`) on Render's free tier. Sync handlers run in a thread pool, so the cache has to be thread-safe. A restart, deploy or free-tier sleep (15 min idle) empties the in-memory cache, and the next requests refill it.

| Write path | Tables | Cache keys cleared (same request, before the response) |
|---|---|---|
| PATCH /map/nodes/:id/status (staff open/close) | map_nodes | map_nodes, map_nodes:by_name |
| POST/PATCH/DELETE /announcements | announcements | announcements |
| POST /animal-photos/:slug, DELETE /animal-photos/:id, PUT /animal-photos/:slug/reorder | animal_photos | animal_photos (in `finally`, so a partial reorder clears too) |
| POST /photos/:id/shortlist, /reject | photo_submissions | photo_gallery |
| DELETE /photos/:id, DELETE /photos/shortlisted | photo_submissions (+votes cascade) | photo_gallery |
| POST /photos/:id/vote (guest) | photo_votes | photo_gallery (vote counts + photo of the day) |
| POST /session/reset | photo_votes (plus per-session tables) | photo_gallery, if any votes were deleted |
| POST /internal/session-cleanup | photo_votes (plus per-session tables) | photo_gallery, if any votes were deleted |
| PUT /staff/qr-locations/:type/:id | hunt_characters / scoring_games / puzzles .map_node_id, animal_map_locations | hunt_characters / scoring_games / puzzles / animal_map_locations (only the type edited) |
| POST /photos/submit | photo_submissions (pending only) | none needed: pending photos aren't in the gallery |

Changes made outside the API (no invalidation, so the TTL bounds staleness):
- Migrations and seed.sql re-runs (every reference table).
- Math Maze and other staff times typed into the SQL editor (puzzle_challenges): 60 s.
- `scripts/migrate_animal_photos.py` (animal_photos): 60 s.
- Dev scripts: `reset_demo_data.py` (announcements, photo_submissions, Math Maze time) and `e2e_collision_fixture.py` (scannable_codes). See the e2e section.

Time-dependent or expiring data:
- **No signed URLs.** Animal and gallery photos use public Storage URLs (`get_public_url`, built locally, no expiry). Passport photos aren't cached.
- **Park hours, open/closed and countdowns are frontend-only** (`parkSchedule.ts`, `parkStatusText.ts`). The only server-side open/closed flag is `map_nodes.is_open`, which is invalidated on write.
- **Photo of the day** depends on votes, which are invalidated on every vote, reset and cleanup.
- **Never cached:** anything keyed by session or guest (visits, completions, Hunt progress, coins, collectibles, staff requests, score sheets, passports, guest session-id lookups), and every staff-only read (`/photos/pending`, `/photos/shortlisted` with emails, `/staff/qr-locations`, `/hunt/scan-codes`, heatmap, analytics).

## 2. What was built

`backend/app/reference_cache.py`, about 200 lines, standard library only, **no new dependency**.

How it works:
- `get(key, loader, ttl)` caches the result for `ttl` seconds. Concurrent misses on the same key share one load (single-flight), so StrictMode's double request and the parallel page-load burst cost one read.
- `invalidate(*keys)` bumps a per-key generation number. A load that was already in flight when a write happened won't store its pre-write result, so a staff change can't be overwritten by an older read finishing late.
- Bounded LRU with 512 entries. Keys are a fixed set plus one per bingo card and one per map node. QR lookups are cached as whole tables, so made-up codes can't grow the cache.
- Every read returns a deep copy, so a caller can't mutate cached rows.
- Thread-safe with one `threading.Lock`; loads run outside the lock.

TTLs:
- **Default, 60 s:** map nodes, puzzles and challenges (Math Maze time), Hunt characters (map_node_id), announcements, animal photos, photo gallery, scannable codes, encyclopedia entries, animal map locations, and the per-node linked tiles used by Mark Visited.
- **Static, 300 s:** minigames, scoring games and score events, bingo cards, bingo tiles, and Hunt challenge content. These change only with a release or migration.

Observability:
- A debug-level log line for each hit, miss and invalidate (logger `app.reference_cache`).
- `reference_cache.stats()` gives per-key hit, miss and invalidation counters, and `reset_stats()` clears them. There's no new endpoint.

Kill switch: `REFERENCE_CACHE_ENABLED`, on by default. `0`, `false`, `no` or `off` turns the cache off; every `get()` then just runs the query. It is read on every call and documented in `backend/.env.example` and DEPLOYMENT.md §7, which also covers multiple instances.

**Cached:**
- The shared parts of /map/nodes and /bingo/card/:id. The split keeps visits and completions per request.
- Bingo cards and minigames, also used by tile completion's draw pool.
- Puzzles, scoring games and Hunt characters and challenges. Shared parts only: hunt_progress stays per request, including for /scan/:code, unlock and complete.
- Announcements and animal photos.
- The guest gallery and photo of the day. Votes are cached as the shared rows, with email stripped before storing; voted_by_me is computed per request.
- The QR lookup tables: scannable_codes and encyclopedia entries for /scan/:code and /scan/:code/qr.png; scannable_codes, hunt_characters, scoring_games, puzzles and challenges, and animal_map_locations for /scan-events.
- Mark Visited's map nodes and linked tiles, and the exploration bonus's is_open check.

**Deliberately not cached:**
- **`/scan/lookup/:text` (manual sign-code entry).** It is never on a page load, and it's the check that catches cross-table slug collisions, so it should see the database as it is right now. The e2e collision fixture depends on that too.
- **Staff-only reads** (pending and shortlisted photos with email, QR directory, hunt scan codes, heatmap, analytics, passport totals). They are staff-only and not on the guest path.
- **`complete_tile`'s single-tile lookup by id and `record_attempt`'s challenge existence check.** These are writes, not page loads. Serving "not found" from a stale cache would turn a new row into a 404 for up to a TTL.
- **`_resolve_session_ids` for logged-in guests.** It is guest-specific.

## Tests

New tests:
- `tests/test_reference_cache.py` (20 tests): hit, miss, TTL expiry with a patched clock, invalidation, the in-flight race, single-flight, a failing loader, copy-on-read, the LRU bound, kill switch values, and debug logs.
- `tests/test_reference_cache_routes.py` (17 tests): TestClient through the real routers, over `tests/fake_supabase.py`, an in-memory PostgREST stand-in that counts reads per table. They cover:
  - **Isolation:** session A warms every cached endpoint after visiting a node, completing a tile, unlocking a character and voting. Session B and a brand-new device then see none of A's progress, with 0 cache misses (all served warm). A still sees exactly its own.
  - **Invalidation:** node close and reopen (also through the exploration bonus), announcement create, edit and delete, animal photo upload, reorder and delete, shortlist, reject, delete and clear, a vote seen by another guest (count, photo of the day, voted_by_me), Reset Session removing a vote, and the QR location edit for all four destination types.
  - **TTL:** a direct staff-time edit stays cached until 60 s, then refetches. No sleeping.
  - **Kill switch:** reads go to the database every time, and writes still work.
  - **Equivalence:** all 13 cached endpoints are byte-identical with the cache off, cold and warm, for two sessions.
  - **Warm load:** zero reads from any shared table.
- `tests/conftest.py`: an autouse fixture that empties and enables the cache around every test.

Mutation check:
- With `invalidate()` turned into a no-op, all 11 invalidation tests fail.
- With the generation guard removed, the in-flight race test fails.

Live dev DB check:
- All 13 cached endpoints were compared off vs cold vs warm with real data (a session with a visit, a completed tile and an unlocked character; the gallery had a shortlisted photo), plus a second session.
- **All byte-identical.**

Full backend suite: 219 passed.

## e2e

How direct database writes in e2e are handled:
- **Global setup** (`reset_demo_data.py` deletes announcements and photos and pins the Math Maze time). Playwright 1.62 starts webServer before globalSetup. A freshly spawned backend has only served `/health` at that point, so its cache is empty and nothing is stale. Caveat: with `reuseExistingServer`, an already-running backend that served those tables in the last 60 s could serve them stale (the existing stale-backend gotcha). Restart it before a run.
- **Collision fixture** (`e2e_collision_fixture.py` inserts a scannable_codes row mid-test). It is only read by `/scan/lookup`, which is deliberately uncached, so nothing changed for it.
- **No waits were added.**

The relevant subset (announcements, attraction status, staff animal photos, favorite photo, shortlisted photos, heatmap QR, scan, puzzle timer, map visited, our animals deep link, scavenger hunt, home page) ran 97 tests:
- **96 passed.**
- **One failed: `announcements.spec.ts` "editing re-triggers the popup...".** Request-timing logs showed it was a pre-existing race in the test, not the cache. The guest's reload GET arrived while the staff PATCH was still in flight. Its "saved" assertion matches while the edit textarea still holds the new text, so it never waited for the save. Before the cache, the guest's ~100 ms Supabase round trip happened to finish after the write.
- **Fix:** wait for the edit form to close, which only happens after the PATCH resolves. That's one line in the spec.
- **Result:** after the fix the spec passed 18/18 across `--repeat-each 3`.

**Full e2e suite: 354 passed (29.7 min), 0 failed, 0 flaky.**

## Before / after (Supabase calls)

| Scenario | Before (dev) | After (dev) | Prod-equivalent before → after |
|---|---|---|---|
| Home, new device (normal case, warm cache) | 52 | 22 | ~26 → ~11 |
| Home, first load after a restart (cold cache) | 50 | 32 | ~25 → ~23 (14 shared reads, once per TTL) |
| /map, new device | 50 | 22 | ~25 → ~11 |
| /bingo, new device | 49 | 22 | ~25 → ~11 |
| QR Hunt deep link, first scan | 67 | 30 | ~38 → ~19 |
| QR animal deep link | 51 | 24 | ~27 → ~13 |
| Mark Visited (Ticket Booth, incl. follow-up reloads) | 13 | 9 first visit / 7 warm | same (not doubled) |
| Warm second load, same device | 48 | 16 | ~24 → ~8 |

How the production-equivalent column is worked out:
- Page-load requests are halved for StrictMode.
- One-shot actions (scan-events, unlock, Mark Visited) aren't doubled.
- On a cold cache, single-flight already makes each shared read happen once on dev, so those 14 reads aren't halved.

What's left on a warm load:
- Only per-session reads: visits, completions, Hunt progress, coins (2), collectibles, staff request.
- Plus `device_sessions` upserts for a new device.

Expected hit rate:
- Each shared key refreshes at most once per TTL, so shared Supabase reads are capped at about 14 per 60 s (fewer for the 300 s keys), whatever the traffic.
- With N page loads per minute, the per-key hit rate is about 1 − 1/N: about 90% at 10 loads/min and 99% at 100/min.
- Staff writes and guest votes each force one refresh of the affected key.

## Not done (as asked)
- **Returning updated state from Mark Visited.** No new information.
- **Frontend loading changes.** See 1.2.
