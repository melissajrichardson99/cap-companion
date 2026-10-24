# Deployment

Ops reference for the live Cobb's Adventure Park Companion App. Written for a
future redeploy, a from-scratch rebuild, or handing this off for review —
optimized for "what do I do" and "what will trip me up," not narrative.

Cross-checked against the repo state as of 2026-09-07, including the full
Guest Accounts project (migrations 035-038: optional guest sign-up/login with
lifetime Coins/Collectibles/Bingo/Map/Passport-history, gated behind Phase 5's
security review before any cutover -- see section 5). Anything that can only
be confirmed in a dashboard (not in this repo) is marked as such below.

## 1. Architecture

| Layer | Where | Why |
|---|---|---|
| Frontend (static React/Vite build) | Cloudflare Workers **Static Assets** | Free tier with no commercial-use restriction. Vercel's free tier was ruled out — its terms prohibit commercial use, and this is a client-commissioned app. |
| Minigames (Godot 4.x → HTML5/WebGL) | Cloudflare **R2**, served through a small Worker (`worker.js`) | Godot Web exports include `.wasm` files (~38MB) that exceed Cloudflare's 25MiB per-file static-asset cap. R2 (no per-file size cap, cheap egress) was the lower-risk fix, chosen over rebuilding a stripped-down/minimal Godot web export to shrink the `.wasm` under the cap. |
| Backend (FastAPI) | Render, free web service tier | Simple Python web service hosting, free tier, no credit card required. |
| Database + Storage | A second, isolated Supabase free project (separate from local dev's project) | Keeps production data/storage separate from whatever's used for local development. |

Request flow: browser → Cloudflare Worker. `wrangler.jsonc`'s
`assets.run_worker_first: ["/games/*"]` routes `/games/*` requests into
`worker.js`, which streams the matching object out of the `GAMES_BUCKET` R2
bucket (with edge caching via the Cache API). Every other path is served
directly by Cloudflare's Static Assets layer, falling back to `index.html`
for client-side routing (`not_found_handling: "single-page-application"`).
The frontend calls the FastAPI backend on Render over HTTPS; the backend
talks to the isolated Supabase project for both Postgres and Storage.

## 2. Fresh-deploy checklist

Follow in order — later steps depend on earlier ones.

### 2.1 Supabase (new isolated project)

1. Create a new Supabase project (free tier).
2. In the SQL editor, run in this exact order:
   1. `backend/supabase/schema.sql` — creates all base tables and the three
      Storage buckets (`favorite-photos`, `family-passport-photos`,
      `animal-photos`) via
      `insert into storage.buckets (...)` statements baked into the file
      itself. **No manual "create a bucket" step in the dashboard is
      needed** — schema.sql provisions them.
   2. Everything in `backend/supabase/migrations/`, in **numeric filename
      order** (002 → the latest, currently 047; there is no 001, numbering
      starts at 002). Most are idempotent (`add column if not exists`,
      `on conflict do nothing`), but **`017_grant_service_role_privileges.sql`
      is not optional** — a fresh Supabase project does not grant
      `service_role` any table privileges by default, and the backend
      connects exclusively as `service_role` (see
      `backend/app/supabase_client.py`). Skip 017 and every DB-backed route
      500s with Postgres error `42501: permission denied for table X`.
      `035_guest_accounts.sql` through `038_passport_guest_history.sql` are
      the Guest Accounts feature (optional guest sign-up/login, tables
      `guests`/`guest_auth_tokens`/`password_reset_tokens`, and the
      `device_sessions.guest_id` / `passport_sessions.guest_id` link
      columns) — same idempotent, run-in-order treatment as every other
      migration here, no special handling needed beyond ordering.
      **`044_analytics_summary_rpc.sql` must be applied before deploying
      any backend that includes it** (the Staff Analytics tab calls its
      `analytics_summary()` function): on an existing database, run 044 in
      the SQL editor first, then deploy. Deployed without it, every
      `GET /analytics/summary` fails with "analytics_summary() is missing
      from the database: run migration 044..." (the rest of the app is
      unaffected).
      **`045_storage_bucket_limits.sql`** sets a 15 MiB size limit
      (15728640 bytes, the same as `MAX_UPLOAD_BYTES` in
      `backend/app/uploads.py`) and JPEG/PNG/WebP-only types on the three
      photo buckets. It does **not** need to run before the backend
      deploys: on an existing database, run it *after* the backend that
      includes `uploads.py` is live, because an older backend passes the
      client's own Content-Type to Storage. Objects already stored
      (including old animal GIFs) are not affected. Limits apply only to
      new uploads.
      **`046_enable_rls_all_tables.sql`** turns on row level security,
      with no policies, on every `public` table, so only `service_role` can
      read or write them. It does **not** need to run before the backend
      deploys (the backend uses the service-role key, which bypasses RLS).
      On an existing database, **test it on the dev project first**. Then
      run it on production and check its verify queries (all tables
      `rls_enabled = true`; no anon/authenticated privileges). It refuses
      to run if `service_role` lacks BYPASSRLS, and fails, changing
      nothing, if any `public` table would be left without RLS.
      **New tables from now on:** a migration that creates a table must
      also run `alter table <name> enable row level security;` in the same
      file and add no policies, unless anon access is genuinely intended.
      Re-running 046's verify query A afterwards should still show every
      table `true`. (It needs no grant either; 017's default privileges
      already cover `service_role`.)
      **`047_map_nodes_farm_toss_and_pins.sql`** adds the 4- and 5-point
      Farm Toss scores, moves the Cornhole Mini Golf pin, renames Tractor
      Ride to "Tractor Ride - West", adds Tractor Ride - East, Bee Maze and
      a coming-soon building, and adds `map_nodes.coming_soon`. It can run
      before or after the backend deploy (the backend treats a missing
      column as false). Map changes show within 60 s and Farm Toss within
      5 min (reference cache), or at once after a backend restart.
   3. `backend/supabase/seed.sql` — inserts map nodes, minigames, puzzles,
      scoring games, hunt characters, etc.
3. Why this order: schema.sql must exist before migrations can `alter
   table`/`insert` against it, and seed.sql's inserts assume the
   fully-migrated schema (columns, constraints, and — critically —
   `service_role` write access from migration 017). Running seed.sql before
   the migrations risks inserting against a schema that's missing fixes the
   migrations apply.
4. Grab the project's URL and `service_role` key for the next step.

### 2.2 Backend (Render)

1. Create the service from `render.yaml` (Render Blueprint) — `rootDir:
   backend`, free plan, `pip install -r requirements.txt`, `uvicorn
   app.main:app --host 0.0.0.0 --port $PORT`.
2. Set these env vars in the Render dashboard (`sync: false` in
   `render.yaml` means Render won't set them for you):
   - `SUPABASE_URL`, `SUPABASE_KEY` — from step 2.1.4. Use the
     `service_role` key, not the anon key.
   - `STAFF_PASSWORD`, `STAFF_SESSION_SECRET` — **generate fresh values,
     do not reuse whatever's in local `backend/.env`.** These gate the
     `/staff` admin area and sign staff session tokens; reusing dev
     credentials in prod defeats the point of them.
   - `FRONTEND_BASE_URL` — see the circular-dependency note below; deploy
     with a placeholder first. Guest Accounts' password-reset emails link to
     `<FRONTEND_BASE_URL>/reset-password?token=...` (see
     `backend/app/services/email.py`), so this must be finalized (2.5)
     before password reset is usable in production, same as the QR codes.
   - `CORS_ALLOWED_ORIGINS` — same placeholder caveat. **Must include the
     full scheme** (`https://your-app.workers.dev`), not a bare domain —
     see Gotchas.
   - `RESEND_API_KEY` — **new for Guest Accounts.** Transactional email
     (password reset) via Resend; get this from Render's dashboard, never
     paste the raw key into chat (same handling as every other credential
     here). Without it, `POST /account/password-reset/request` still
     responds normally (the enumeration-prevention generic message), but
     the email silently fails to send — logged server-side
     (`app/services/guest_accounts.py`'s `request_password_reset`), not
     surfaced to the caller. Verify it's set by actually requesting a reset
     against a real account after deploying, not just by checking the env
     var is present.
   - `RESEND_FROM_ADDRESS` — optional, defaults to Resend's shared testing
     sender (`onboarding@resend.dev`, no domain verification needed). Set to
     a verified custom-domain address before this goes anywhere near real
     guest volume — see `app/services/email.py`.
   - `INTERNAL_CLEANUP_SECRET` — **new for session cleanup.** Generate a
     fresh long random string; this must also be set as the
     `INTERNAL_CLEANUP_SECRET` GitHub Actions repo secret (see section 6) —
     the two must match exactly, or the scheduled cleanup workflow gets a
     401 on every run.
   - `REFERENCE_CACHE_ENABLED` — optional; leave unset (cache on). Set to
     `0` only as the kill switch described in section 7.
   - **Never set `DEV_SUPABASE_PROJECT_REFS` on Render.** It is the
     allow-list that lets the destructive dev-only scripts
     (`cleanup_dev_test_data.py`, `e2e_run_cleanup.py`,
     `reset_demo_data.py`, `e2e_collision_fixture.py`,
     `verify_session_cleanup.py`) run against a project; it belongs only in
     a dev machine's `backend/.env`. It is deliberately not in
     `render.yaml`.
3. Deploy. Render builds and starts the service; note its public URL
   (`https://cap-companion-backend.onrender.com`-style).

### 2.3 Frontend (Cloudflare Workers Static Assets)

1. In the Cloudflare dashboard, under the Worker's settings there are **two
   separate "Variables and secrets" sections** — one for the *build*
   (used while running the frontend's build command) and one for the
   *Worker runtime* (used by `worker.js` when it executes). These are easy
   to conflate and only one of them actually reaches the frontend bundle.
   - `VITE_API_BASE_URL` (the Render backend URL from 2.2.3) must go in the
     **build-time** variables section. Vite inlines `import.meta.env.*`
     values into the JS bundle at build time (see `frontend/src/api.ts`) —
     setting it as a runtime-only variable does nothing, since by the time
     the Worker runs, the bundle is already built with whatever
     `VITE_API_BASE_URL` was (or wasn't) present at build time.
   - The Worker runtime doesn't need any custom env vars itself — its only
     binding is `GAMES_BUCKET` (R2, wired via `wrangler.jsonc`'s
     `r2_buckets`), not an env var.
2. `wrangler.jsonc` (repo root) already has the asset/routing config:
   `assets.directory: "./frontend/dist"`, `not_found_handling:
   "single-page-application"` for SPA fallback, and `run_worker_first:
   ["/games/*"]` so only `/games/*` requests hit `worker.js` — everything
   else is served straight from static assets without invoking the Worker.
3. Deploy (`wrangler deploy`, or via the connected build pipeline). Note
   the resulting `*.workers.dev` URL (or custom domain).
4. **Env var changes require a fresh build, not just "Promote Version."**
   Promoting a version in the Cloudflare dashboard only switches which
   *already-built* artifact is live — it does not re-run the build step.
   If you change `VITE_API_BASE_URL` after the fact, you must trigger a new
   build, not just promote.

### 2.4 R2 (minigames)

1. Create the `cap-companion-games` R2 bucket (name must match
   `wrangler.jsonc`'s `r2_buckets[0].bucket_name`).
2. **R2 requires a credit card on the Cloudflare account to enable, even to
   stay on the free tier** — budget it into the setup, this isn't
   optional/skippable the way Workers/Pages free tier is.
3. Before exporting, run `node scripts/sync-minigame-shared.mjs`. It copies
   the shared end card (`minigames/_shared/EndCard.gd`) into every game and
   writes each export preset's `html/head_include` (the inline script that
   tells the app the build reports round results). Edit the master in
   `minigames/_shared/`, never a game's copy; `--check` exits non-zero if
   any copy is out of date.
4. Export the Godot minigames, then copy each `minigames/<slug>/export_web/`
   into `frontend/games-dist/<slug>/` (not `frontend/public/games/` — they
   were moved out of the static-assets directory specifically because
   they're too large for it; see the `.gitignore` comment and
   `f83ac6f`/`c56a4bf`). Copy everything **except the `*.import` files**
   Godot writes next to the export — they're editor metadata, not part of
   the shipped build.
5. **Upload with `node scripts/upload-games-to-r2.mjs`** from the repo root.
   Re-run it after every minigame re-export — R2 has no build hook into
   Cloudflare's own build pipeline, unlike static assets.
   - It runs a pinned wrangler (`npx --yes wrangler@4.142.0`, set in the
     script's `WRANGLER_VERSION`) and uses your `wrangler login`. Run
     `npx wrangler@4.142.0 login` first if `npx wrangler@4.142.0 whoami`
     says the token expired (it can't refresh non-interactively).
   - **Always dry-run first:** `--dry-run` lists every file with its key,
     size, content type and whether it would upload or skip, and why. No
     writes, no confirmation needed.
   - **Only changed files upload.** The script keeps a manifest
     (`_meta/upload-manifest.json` in the bucket; the Worker 404s it) with
     each file's size and SHA-256; matching files are skipped, anything
     else (changed, unrecorded, unreadable) uploads. `--verify-remote`
     ignores the manifest and compares against the live bytes instead
     (downloads the whole bucket, ~380MB, read-only) — use it for the first
     run (no manifest exists yet) and after any upload done outside the
     script. `--force-all` uploads everything; `--only <slug,...>` limits
     the run.
   - **Order:** one game at a time, and within a game the engine/support
     files first, then `index.pck`, then `index.html` last — a run that
     stops part-way never serves a new `index.html` in front of older files.
   - **Failures:** each file is retried twice (2s, 5s). If it still fails
     the script stops, lists what was and wasn't uploaded, prints the
     resume command, and exits non-zero. Re-running resumes — finished
     files are skipped.
   - A real run prints the target bucket and asks you to type its name;
     `--yes` skips that.
   - Testing the script itself: `--local <dir>` targets wrangler's local R2
     simulator instead of the real bucket.
6. **Caching and how long until guests see it.** `worker.js` sets the
   `Cache-Control` guests get (the object's stored header is ignored):
   `index.html` and `index.pck` — the only files a game update changes —
   get `public, max-age=60`; `.wasm`, `.js` and images keep
   `public, max-age=3600`. The edge (Cache API) and the browser each honour
   it, so a new build reaches every guest within about **2 minutes**. The
   live app is on `*.workers.dev`, which has **no zone to purge** — waiting
   is the only option. That header only applies to files cached after the
   Worker change deployed, so the Worker must be live (it deploys with the
   frontend on push) at least an hour before the first game upload that
   relies on it. Mixing is harmless: an old `index.pck` behind a new
   `index.html` boots and plays, but the overlay closes at round end without
   a result, so a Scavenger Hunt Challenge 3 play in that window doesn't
   count; the reverse mix shows the end card normally. The size of
   `index.pck` written into `index.html` only drives the loading bar.
7. **Deploy order doesn't matter** between the React app and the games.
   The minigame overlay treats a build that never sends `minigame-hello`
   exactly as before end cards existed, and an older overlay ignores the
   new messages and closes on Exit. Deploying React first means the
   Scavenger Hunt Challenge 3 rule (a round must be finished) takes effect
   as each game lands.
8. **Rollback** — every build is in git (`frontend/games-dist/` is
   tracked; R2 has no object versioning). To restore the previous build:
   ```powershell
   git restore --source=<previous-commit> -- frontend/games-dist
   node scripts/upload-games-to-r2.mjs --dry-run   # shows just the files that differ
   node scripts/upload-games-to-r2.mjs
   git restore --source=HEAD -- frontend/games-dist
   ```
   `git log --oneline -- frontend/games-dist` lists the builds.

> **History:** until the October 2026 release the bucket was still serving
> the 2026-08-16 build (commit `f83ac6f`), so the first upload after it also
> ships the 2026-08-22 popup fixes (`07cc092`), not just the end-card work.

### 2.5 Close the loop: URLs and QR codes

1. Once the Cloudflare URL is live (2.3.3), go back to Render and update:
   - `FRONTEND_BASE_URL` → the real Cloudflare URL.
   - `CORS_ALLOWED_ORIGINS` → the real Cloudflare URL, **with `https://`**.
   This is a circular dependency — Render needs the Cloudflare URL, but
   deploying to Cloudflare doesn't require Render to be finished first —
   so the practical order is: deploy Render with placeholder values →
   deploy Cloudflare → come back and update Render's env vars → Render
   redeploys automatically on env var change.
2. Generate the QR codes for printing **only once the park's final domain
   is decided**. Every QR script needs that address passed explicitly —
   there is no default, and `FRONTEND_BASE_URL` is never used for signs:

   ```bash
   # dry check of what's encoded, then confirm by typing the host name:
   python backend/scripts/generate_all_qr_codes.py --base-url https://<final domain>
   # or set QR_BASE_URL=https://<final domain> instead of --base-url

   # re-check a folder right before sending it to the printer:
   python backend/scripts/generate_all_qr_codes.py --verify
   ```

   - **Which script:** `generate_all_qr_codes.py` writes every sign the
     Staff QR Code Directory lists into one folder
     (`backend/scripts/output/all_qr_codes/`): the 20 Our Animals signs
     (`/animals/<slug>`), each Hunt character (`/scan/<code>`), every
     scoring sheet (`/scoring/<slug>`, including
     `/scoring/blacklight-mini-golf` and `/scoring/cornhole-mini-golf` —
     it refuses to run if either is missing from the database) and every
     puzzle challenge (`/puzzles/<slug>`). The older per-kind scripts
     still work the same way: `generate_animal_qr_codes.py`,
     `generate_hunt_qr_codes.py`, and `generate_qr_codes.py` (every
     `scannable_codes` row, Encyclopedia placeholders included).
   - **Checks:** the base URL must be `https://` with a public host name
     and nothing after it — `localhost`, `127.0.0.1`, private/link-local
     IPs, `.local`-style and single-label names, paths, queries and
     `user:password@` are refused. A `*.workers.dev` / `*.pages.dev`
     address is accepted but warned about: it belongs to one Cloudflare
     account, so printed signs die with that account. `--allow-insecure`
     lifts the checks **for local testing only**; `--verify` (without that
     flag) then refuses the folder, so test codes can't be mistaken for
     printable ones.
   - **What's written:** one PNG per sign plus `manifest.csv` (file, kind,
     name, slug/code, full URL). Every run then decodes every PNG (with
     jsQR, via Node and `frontend/node_modules` — run `npm install` in
     `frontend/` first) and checks it against the manifest; it also flags
     PNGs in the folder that aren't in the manifest. A folder that already
     holds PNGs is refused unless `--overwrite` is given.
   - Nothing is written without `--yes` or typing the host name back.
     Hunt, scoring and puzzle entries are read from the Supabase project
     `backend/.env` points at (printed first) — generate against
     production so the codes match production's rows.
   - Output goes under `backend/scripts/output/`, which is gitignored:
     never commit generated codes.
   - `GET /scan/{code}/qr.png` (single code, testing only) still encodes
     the server's `FRONTEND_BASE_URL`; don't print from it.

## 3. Gotchas

- **CORS origins need the full scheme.** `CORS_ALLOWED_ORIGINS` is a
  comma-separated list matched directly against the browser's `Origin`
  header (`backend/app/main.py`) — `your-app.workers.dev` silently fails to
  match `https://your-app.workers.dev` and CORS just breaks with no useful
  error server-side, only a browser console CORS failure.
- **Cloudflare "Promote Version" doesn't rebuild.** It only repoints which
  previously-built artifact serves traffic. An env var change (especially
  `VITE_API_BASE_URL`, which is baked into the JS bundle at build time)
  needs a fresh build — promoting an old build after changing the var does
  nothing.
- **Node 20+ doesn't auto-escape `shell: true` child-process args.**
  `scripts/upload-games-to-r2.mjs` shells out to `wrangler` (via its
  `.cmd` shim on Windows, which requires `shell: true`). As of Node 20,
  `execSync`/`spawn` with a string or `true` shell no longer escapes
  array args for you (Node DEP0190) — it just space-joins them, so any arg
  containing a space or shell metacharacter (e.g. `"public, max-age=3600"`)
  silently splits into multiple argv entries. The script has its own
  `shellQuote()` helper to guard against this — if you add new args to
  that script, quote them the same way rather than passing raw strings.
- **`worker.js` must not have named exports.** The Workers runtime treats
  every named export as an entrypoint and refuses to start on anything that
  isn't a handler (`export const X = ...` took the whole Worker down in
  `wrangler dev`). Keep helpers module-private; check with `wrangler dev`.
- **Cloudflare's 25MiB per-file static-asset cap** is why minigames live in
  R2 instead of `frontend/public/games/` — Godot's `.wasm` exports run
  ~38MB. See `worker.js`'s header comment and section 2.4 above.
- **A fresh Supabase project grants `service_role` nothing by default.**
  `schema.sql` never explicitly grants table privileges (it relied on
  Supabase auto-provisioned defaults that this project didn't actually
  get). Every DB-backed backend route 500s with Postgres `42501: permission
  denied` until `017_grant_service_role_privileges.sql` runs. That
  migration also sets `alter default privileges ... grant ... to
  service_role`, so tables created by *future* migrations don't need a
  repeat of this fix — but it's easy to skip 017 on a fresh project since
  nothing about the error points at "missing grant."
- **seed.sql edits alone don't reach a live database.** Editing
  `seed.sql` in the repo has no effect on an already-provisioned project —
  it has to be re-run by hand in the SQL editor, or shipped as a numbered
  migration. (See migration `004_phase2_minigames.sql`'s own header comment
  — it exists because seed.sql was updated with the Phase 2 minigames but
  never re-run against the live DB.) Verify what's actually live via the
  Supabase REST API rather than assuming seed.sql reflects it.
- **A browser "CORS error" can be a Render outage in disguise — check
  before touching `CORS_ALLOWED_ORIGINS`.** On 2026-08-20, every frontend
  API call started failing with "No 'Access-Control-Allow-Origin' header is
  present," across every route, with no config change on our end. Root
  cause: a Render platform incident ("Deployment Issues," upstream Google
  Cloud problem, see status.render.com) had disabled builds/deploys and
  free-tier spin-up across all regions. Render's own edge proxy was
  returning 502/503 directly — the request never reached FastAPI or its
  `CORSMiddleware` at all — and Render's error responses carry no CORS
  headers, so the browser reports it exactly like a CORS misconfiguration.
  Before assuming `CORS_ALLOWED_ORIGINS` reverted or drifted:
  1. `curl -i` the backend directly and check the `x-render-routing`
     response header. `hibernate-wake-error` or `no-deploy` (returned
     near-instantly, not after a normal ~30-60s cold-start delay) means
     the platform itself isn't routing to your service — this is not an
     app-level config problem.
  2. Check https://status.render.com before editing any env var — a
     platform incident affecting free-tier services will explain a
     sudden, total, config-untouched failure far better than "the value
     silently reverted." (It won't — `render.yaml` declares
     `CORS_ALLOWED_ORIGINS` with `sync: false`, which persists the
     dashboard value across redeploys; there is no mechanism here that
     resets it.)
  3. Only if the routing header/status page point at a real request
     reaching FastAPI (not a Render-edge error) is `CORS_ALLOWED_ORIGINS`
     itself worth re-checking.

## 4. Cost and safety notes

- A Cloudflare **Budget Alert** and an **R2 operations Usage Notification**
  are configured on the account as free-tier safety nets — set up in the
  Cloudflare dashboard, not represented in this repo, so they can't be
  verified here. Confirm they're still active from the dashboard directly
  rather than trusting this doc if it's been a while.
- **The base app has no login — each device is its own anonymous
  session.** The browser generates an `X-Device-Session` token on first
  visit and every guest's progress (Bingo, Map visits, Hunt, Coins,
  Collectibles, Scoring, Puzzles, votes) is stored against it. What is
  shared by everyone is the park content itself: one live bingo card
  layout and one set of map nodes, including each attraction's open/closed
  status (see `backend/scripts/reset_demo_data.py`'s docstring). The
  guest-facing **Reset Session** action
  (`frontend/src/components/ResetSessionModal.tsx`,
  `backend/app/routers/session.py`) wipes progress for *this device only*.
  If you stand up a second environment for concurrent testing/demoing,
  per-device isolation depends on each tester's browser actually holding
  a distinct `X-Device-Session` token — there's no per-family isolation
  beyond that, and the token is not a credential (a client can send any
  value).
- **Guest Accounts (optional, on top of the above) is a real per-user auth
  layer** — email/password sign-up, bcrypt-hashed, bearer tokens
  (`X-Guest-Auth`), see section 5. It does not replace the anonymous
  per-device model; a guest opts in from the nav to make their Coins/
  Collectibles/Bingo/Map/Passport history follow them across devices and
  visits instead of resetting per device.
- **Staff login is rate-limited per client IP.** `POST /staff/login` allows
  5 wrong passwords per IP in any 10 minutes, then answers 429 ("Too many
  incorrect password attempts. Please wait N minutes...") until the oldest
  failure is 10 minutes old; a correct password clears the count, so normal
  logins and the odd typo are unaffected (`backend/app/rate_limit.py`). The
  IP is the **last** `X-Forwarded-For` entry, the one Render's proxy adds
  itself; earlier entries are client-supplied and ignored. Same caveat as
  the reference cache (section 7): the counts live in memory, reset on every
  deploy/restart/spin-down, and are per instance, so this only holds while
  the backend runs as a single instance. Each lockout logs
  `Staff login locked out for client <ip>` — after deploying, check that
  two different networks (e.g. phone on mobile data and a laptop on Wi-Fi)
  show different IPs there; if every lockout shows the same address,
  Render's proxy chain differs from what's assumed and the key needs
  revisiting. To unlock early, restart the service.

## 5. Guest Accounts

Optional account layer (migrations 035-038) sitting on top of the anonymous
per-device-session model above — a guest never has to create one, and every
existing anonymous flow is unaffected either way.

- **Endpoints** (`backend/app/routers/account.py`, prefix `/account`):
  `POST /signup`, `POST /login`, `POST /logout`, `POST /password-reset/request`,
  `POST /password-reset/confirm`, `GET /whoami`, `GET /bingo-map/status`,
  `POST /bingo-map/start-fresh`, `GET /passports`.
- **Auth model**: bcrypt password hashing, a 90-day sliding-expiry bearer
  token (`X-Guest-Auth`, stored server-side in `guest_auth_tokens` so a
  password change can revoke every other active session), and short-lived
  (1 hour) single-use password-reset tokens. Login and password-reset-request
  responses are deliberately generic (never reveal whether an email has an
  account); signup, login and password-reset-request are all rate-limited
  in-process (5 attempts / 15 min, keyed by normalized email —
  `backend/app/rate_limit.py`). That limiter is per-process, in-memory state
  — it resets on every deploy/restart and does **not** share state across
  instances, so it only actually throttles abuse as long as this API runs as
  a single instance (true today on Render's free tier).
- **Device linking**: `X-Device-Session` (the existing anonymous token)
  becomes linked to a guest the moment they sign up or log in on that device
  (`device_sessions.guest_id`), which is what makes Coins/Collectibles/Bingo/
  Map lifetime totals and Passport history follow the guest across devices.
  A device already linked to one guest **rejects** (409) an attempt to sign
  up or log in as a *different* guest on it — this was a fixed bug (Phase 5
  security review): re-authenticating as someone else used to silently
  overwrite the link and detach the first guest's history. A plain
  **Log Out** only deletes that device's auth token, not the link itself —
  only **Reset Session** actually frees a device (by rotating to a brand new,
  unlinked token) for a different guest to log in on it next.
- **Required env var**: `RESEND_API_KEY` (see 2.2.2 above) — password-reset
  emails silently no-op without it (logged server-side, not surfaced to the
  caller), so this is easy to miss until someone actually needs to reset a
  password in production.

## 6. Session cleanup housekeeping

Anonymous (guest_id IS NULL) `device_sessions` rows accumulate forever with
no expiry otherwise — a scheduled job purges ones idle 14+ days, and
everything tied to them, via `POST /internal/session-cleanup`
(`backend/app/routers/internal.py`, logic in
`backend/app/services/session_cleanup.py`). **Guest-linked sessions are never
touched, regardless of age** — that's a guest's permanent history. See that
module's docstring for the full per-table policy and the safety reasoning.

- **Scheduling: GitHub Actions, not Render Cron Jobs.** This backend runs on
  Render's free web-service plan (`render.yaml`); Render's Cron Job is a
  separate, billed service type, which would add a new cost surface to a
  project that has otherwise deliberately stayed free everywhere
  (Cloudflare Workers, Supabase, R2). A scheduled GitHub Actions workflow
  (`.github/workflows/session-cleanup.yml`) costs nothing and needs no new
  infrastructure — it just calls the existing backend over HTTPS.
- **Setup** (one-time, in the GitHub repo's Settings > Secrets and variables
  > Actions):
  1. Secret `INTERNAL_CLEANUP_SECRET` — must exactly match the backend's own
     env var of the same name (2.2.2 above).
  2. Variable `BACKEND_URL` — the deployed backend's base URL (not a
     secret — it's already public in this doc), e.g.
     `https://cap-companion-backend.onrender.com`.
- The workflow also has a `workflow_dispatch` trigger for an on-demand
  manual run from the Actions tab, in addition to its daily schedule.
- **Cold-start note**: the workflow's `curl` uses `--max-time 90`, not the
  default — Render's free tier cold-starts after 15 minutes idle (see the
  hibernate-wake-error gotcha above), and a cold request can take 30-60s.
- Manual/dev-DB verification lives in
  `backend/scripts/verify_session_cleanup.py` (run against the real dev
  Supabase project, same as `reset_demo_data.py` — see its docstring).

## 7. Reference-data cache

The backend keeps shared, slow-changing data in memory
(`backend/app/reference_cache.py`) so a guest's page load doesn't re-read it
from Supabase every time. It covers map nodes, the bingo layout, minigames,
puzzles, scoring games, Hunt characters and challenges, announcements,
animal photos, the shortlisted photo gallery (photo of the day comes from
it) and the QR lookup tables. Anything per-device, per-guest or staff-only
is always read fresh.

- **Kill switch:** set `REFERENCE_CACHE_ENABLED=0` in the Render dashboard
  to turn caching off completely. Render restarts the service when an env
  var changes; after that every request reads Supabase directly, exactly
  as before the cache existed. Unset (the default) means on. No code
  change or redeploy needed either way.
- **Staff changes are immediate.** Every write that goes through the API
  (opening or closing an attraction, announcements, animal photo
  upload/delete/reorder, photo shortlist/reject/delete/clear, votes, Reset
  Session and session cleanup removing votes, QR location edits) clears
  the affected entries before it responds.
- **Direct database edits are not immediate.** A migration, a `seed.sql`
  re-run or a value typed into the SQL editor (for example a Math Maze
  staff time) shows up when the entry expires: within **60 seconds** for
  most data, and within **5 minutes** for minigames, scoring games, the
  bingo layout and Hunt challenge content. To make a change show at once,
  restart the service from the Render dashboard (the cache is in memory,
  so a restart empties it).
- **Restarts and sleep:** the cache lives only in the running process. A
  deploy, a restart or the free tier spinning down after 15 idle minutes
  empties it, and the first requests afterwards simply refill it.
- **More than one instance:** today the backend is a single uvicorn
  process on one free-tier instance, so every request shares one cache. If
  it is ever scaled to several instances (or run with `--workers N`), each
  one keeps its own cache, and a staff write only clears the cache of the
  instance that handled it. The other instances catch up when their copy
  expires, so a guest could see the old value for up to the TTL above
  (60 seconds, or 5 minutes for the static tables). If that matters at
  that point, either lower the TTLs, move the cache to a shared store such
  as Redis, or turn it off with the kill switch.
- **Signed URLs:** nothing cached contains an expiring URL. Animal photos
  and gallery photos use public Storage URLs, built from the stored path
  on every request.

## 8. Per-device limits on public write endpoints

The public endpoints that write something on a guest's behalf are limited
per **device session** (the `X-Device-Session` identity the rest of the
backend uses), never per IP — the whole park can share one Wi-Fi address.
The numbers are far above what a family does in a visit, so they only stop
scripts and runaway clients (`backend/app/rate_limit.py`):

| Endpoint | Limit per device session | Over the limit |
| --- | --- | --- |
| `POST /staff-requests` (Contact Staff) | 5 per hour | 429 + message + `Retry-After` |
| `POST /photos/submit` (Favorite Photo upload) | 10 per hour | 429 + message + `Retry-After` |
| `POST /passport/generate` (Family Passport, with or without a photo) | 10 per hour | 429 + message + `Retry-After` |
| `POST /photos/{id}/vote` | 60 per hour | 429 + message + `Retry-After` |
| `POST /scan-events` (heatmap logging) | 120 per hour | normal 204, event just not logged |

- **Never limited:** the scan itself (`GET /scan/...` and the deep-linked
  pages), Mark Visited, Bingo/Map progress, Hunt, coins — anything a
  guest's progress depends on. The heatmap limit only stops the analytics
  row being written.
- **No device session:** a request with no `X-Device-Session` header at
  all (the app always sends one, so in practice only a hand-made request)
  shares one small bucket per IP per endpoint (2–20 an hour). The other
  endpoints already require the header.
- **Known gap:** a device session is whatever token the client sends, so a
  script that invents a fresh token per request gets a fresh allowance
  each time. Closing that needs a per-IP ceiling or server-issued
  tokens — deliberately not done, because of the shared Wi-Fi.
- **The guest sees** the backend's sentence (e.g. "Please wait 12 minutes
  and try again") where that screen already shows errors.
- **Single instance assumed.** The counts live in memory in the one
  uvicorn process, like the reference cache (section 7): a deploy,
  restart or free-tier spin-down resets them, and with several instances
  (or `--workers N`) each would count separately, multiplying every
  limit. Move the counts to a shared store (e.g. Redis) before scaling
  out. Memory is bounded (at most 50,000 tracked keys, each holding at
  most its limit's worth of timestamps).
- **Kill switch:** set `RATE_LIMITS_ENABLED=0` (also `false`/`no`/`off`)
  in the Render dashboard to turn all of these off without a code change;
  Render restarts the service on an env var change. Unset (the default)
  means on. It does not affect the staff login limiter (section 4).
