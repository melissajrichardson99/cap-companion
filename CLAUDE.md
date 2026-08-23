# Cobb's Adventure Park Companion App

Proof-of-concept companion app for Cobb's Adventure Park (single-tenant, no multi-tenant).

## Stack
- Frontend: React (Vite) — /frontend
- Backend: FastAPI — /backend
- Database: Supabase (Postgres)
- Minigames: Godot 4.x → HTML5/WebGL, built into /minigames, exports copied to /frontend/games-dist/ (NOT /frontend/public/games/ — the builds are too large for Cloudflare's bundled-asset limit, so a custom Vite middleware serves them from games-dist/ instead of the static public/ dir). Copying a new build to the wrong path fails silently — no error, the dev server just keeps serving the stale build.

## Build priority
Full detail in CAP_Companion_App_TechSpec.md. Order:
1. Interactive Map + Bingo Card (25 tiles) + Map↔Bingo interconnectivity + 5 Phase 1 minigames
2. Remaining 5 minigames + Puzzle Timer
3. Scavenger Hunt + Scoring Sheet + QR Encyclopedia
4. Family Passport, Cobb Coins, Contact Staff, Favorite Photo

## Docs
- CAP_Companion_App_Plan.md — full feature plan, confirmed game/puzzle rules, park map data
- CAP_Companion_App_TechSpec.md — data models, core logic specs, known pitfalls

## Known pitfalls (from a prior no-code attempt at this same app — verify explicitly)
- Bingo milestone detection (line/X/blackout) needs exact tile-index math, not approximate shape detection
- Minigame random draw must be uniformly distributed across the pool — test it
- Snake needs solid collision handling + a real win condition (not endless mode)
