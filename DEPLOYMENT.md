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
   1. `backend/supabase/schema.sql` — creates all base tables and the two
      Storage buckets (`favorite-photos`, `family-passport-photos`) via
      `insert into storage.buckets (...)` statements baked into the file
      itself. **No manual "create a bucket" step in the dashboard is
      needed** — schema.sql provisions them.
   2. Everything in `backend/supabase/migrations/`, in **numeric filename
      order** (002 → the latest, currently 038; there is no 001, numbering
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
3. Export the Godot minigames to `frontend/games-dist/` (not
   `frontend/public/games/` — they were moved out of the static-assets
   directory specifically because they're too large for it; see the
   `.gitignore` comment and `f83ac6f`/`c56a4bf`).
4. Run `node scripts/upload-games-to-r2.mjs [bucket-name]` (defaults to
   `cap-companion-games`) to push every file under `frontend/games-dist/`
   into the bucket via `wrangler r2 object put --remote`. Requires
   `wrangler login` to have been run already, or `CLOUDFLARE_API_TOKEN`
   set. Re-run this after every minigame re-export — R2 has no build hook
   into Cloudflare's own build pipeline, unlike static assets.

### 2.5 Close the loop: URLs and QR codes

1. Once the Cloudflare URL is live (2.3.3), go back to Render and update:
   - `FRONTEND_BASE_URL` → the real Cloudflare URL.
   - `CORS_ALLOWED_ORIGINS` → the real Cloudflare URL, **with `https://`**.
   This is a circular dependency — Render needs the Cloudflare URL, but
   deploying to Cloudflare doesn't require Render to be finished first —
   so the practical order is: deploy Render with placeholder values →
   deploy Cloudflare → come back and update Render's env vars → Render
   redeploys automatically on env var change.
2. Regenerate QR codes (`backend/scripts/generate_qr_codes.py` and
   `generate_hunt_qr_codes.py`) **after** `FRONTEND_BASE_URL` is finalized.
   Each code encodes `<FRONTEND_BASE_URL>/scan/<code>` (see
   `backend/app/services/qr.py`) baked in at generation time — codes
   generated against a placeholder URL, or before an environment's final
   domain is known, will point at the wrong place once printed.

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
- **The base app has no per-user auth — it's a shared-kiosk session model.**
  There is one live bingo card and one shared set of map-node states (see
  `backend/scripts/reset_demo_data.py`'s docstring: "every map_nodes row —
  all cards share the same map"), plus a guest-facing **Reset Session**
  action (`frontend/src/components/ResetSessionModal.tsx`,
  `backend/app/routers/session.py`) that wipes progress for *this device
  only* (per-device scoping was completed by the Per-Device Sessions
  migration referenced throughout the codebase; this note previously
  described an earlier, fully-shared-state version of Reset Session that no
  longer reflects the live code). If you stand up a second environment for
  concurrent testing/demoing, know that per-device isolation depends on each
  tester's browser actually holding a distinct `X-Device-Session` token —
  there's no per-family isolation beyond that.
- **Guest Accounts (optional, on top of the above) is a real per-user auth
  layer** — email/password sign-up, bcrypt-hashed, bearer tokens
  (`X-Guest-Auth`), see section 5. It does not replace the anonymous
  per-device model; a guest opts in from the nav to make their Coins/
  Collectibles/Bingo/Map/Passport history follow them across devices and
  visits instead of resetting per device.

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
  account); signup and password-reset-request/signup are all rate-limited
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
