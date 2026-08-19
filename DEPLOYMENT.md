# Deployment

Ops reference for the live Cobb's Adventure Park Companion App. Written for a
future redeploy, a from-scratch rebuild, or handing this off for review —
optimized for "what do I do" and "what will trip me up," not narrative.

Cross-checked against the repo state as of 2026-08-19. Anything that can only
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
      order** (002 → 017; there is no 001, numbering starts at 002).
      Most are idempotent (`add column if not exists`, `on conflict do
      nothing`), but **`017_grant_service_role_privileges.sql` is not
      optional** — a fresh Supabase project does not grant `service_role`
      any table privileges by default, and the backend connects exclusively
      as `service_role` (see `backend/app/supabase_client.py`). Skip 017
      and every DB-backed route 500s with Postgres error `42501: permission
      denied for table X`.
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
     with a placeholder first.
   - `CORS_ALLOWED_ORIGINS` — same placeholder caveat. **Must include the
     full scheme** (`https://your-app.workers.dev`), not a bare domain —
     see Gotchas.
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

## 4. Cost and safety notes

- A Cloudflare **Budget Alert** and an **R2 operations Usage Notification**
  are configured on the account as free-tier safety nets — set up in the
  Cloudflare dashboard, not represented in this repo, so they can't be
  verified here. Confirm they're still active from the dashboard directly
  rather than trusting this doc if it's been a while.
- **This app has no per-user auth — it's a shared-kiosk session model.**
  There is one live bingo card and one shared set of map-node states (see
  `backend/scripts/reset_demo_data.py`'s docstring: "every map_nodes row —
  all cards share the same map"), plus a staff-facing **Reset Session**
  action (`frontend/src/components/ResetSessionModal.tsx`,
  `backend/app/routers/session.py`) that wipes progress for *everyone*
  currently using the app. If you stand up a second environment for
  concurrent testing/demoing, know that one tester hitting Reset Session
  resets the whole shared state for every other concurrent user on that
  environment — there's no per-family isolation. Don't rely on concurrent
  testers being able to work independently against a single deployed
  instance.
