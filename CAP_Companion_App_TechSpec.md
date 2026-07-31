# CAP Companion App — Technical Spec for Claude Code

This is a build-ready spec, meant to be dropped into your project (e.g. as `PROJECT_SPEC.md` or `CLAUDE.md` at the repo root) so Claude Code has the full context up front. It complements — doesn't replace — the full feature plan at `CAP_Companion_App_Plan.md`; this doc focuses on what's needed to actually start building, in priority order, and is explicit about the exact logic that broke in the Base44 attempt so it doesn't repeat here.

---

## 1. Tech Stack & Project Structure

- **Frontend:** React (Vite is a good call for a POC — fast dev server, minimal config)
- **Backend:** FastAPI (Python)
- **Database:** Supabase (Postgres)
- **Minigames:** Godot 4.x, exported to HTML5/WebGL, embedded in the React app (via iframe or direct canvas mount)

Suggested structure:
```
/frontend       React app
/backend        FastAPI app
/minigames      One Godot project per game; exported builds copied into frontend/public/games/
```

---

## 2. Build Priority

**Phase 1 (build first):** Interactive Map, Bingo Card (25 tiles), Map↔Bingo interconnectivity, and the 5 Phase 1 minigames (Whack-a-Capybara, Pattern Repeat, Card Flip Pairs, Mini Maze, Mini Snake). This is the slice that matters most right now.

**Phase 2:** remaining 5 minigames (Mini Platformer, Digital Ring Toss, Bug Net Swipe, Obstacle Dodge, Sort the Species), Puzzle Solving Timer.

**Phase 3:** Scavenger Hunt full content (3 characters × 5 challenges), Scoring Sheet (all documented games), QR Encyclopedia.

**Phase 4:** Family Passport, Cobb Coins full loop, Contact Staff + staff dashboard, Favorite Photo, full cross-feature integration pass.

---

## 3. Data Models

### MapNode
```
id: uuid
name: string
category: enum [attraction, animal, service, food, seasonal]
description: string
state: enum [not_visited, visited, closed]   // default not_visited
linked_bingo_tile_ids: uuid[]                // tiles that reference this node
```

### BingoCard
```
id: uuid
owner_label: string              // family/player name for this session
tiles: BingoTile[25]              // fixed 5x5, index 0-24; row = floor(index/5), col = index % 5
milestones_achieved: { lines: int[], x: bool, blackout: bool }
```

### BingoTile
```
id: uuid
card_id: uuid
position: { row: 0-4, col: 0-4 }
label: string                    // the challenge text
linked_map_node_id: uuid | null
completed: bool                  // default false
completed_at: timestamp | null
```

### Minigame
```
id: uuid
name: string
engine_group: enum [reaction_timing, grid_drag, auto_scroll, standalone]
theme: string
target_duration_seconds: int     // ~30
phase: 1 | 2                     // which build phase it belongs to
```

---

## 4. Core Logic Specs

These are written explicitly because they're exactly where the Base44 attempt broke — treat this section as the acceptance criteria, not just guidance.

### 4.1 Minigame Random Draw
- Maintain the pool of **currently available** minigames (Phase 1 pool = 5 games; grows to 10 once Phase 2 ships).
- On tile completion: draw 1 minigame **uniformly at random** from the available pool.
- If the completion also satisfies the milestone condition (4.2), draw **2 additional** minigames as separate independent draws (repeats allowed, including repeating the game already drawn for the base trigger).
- Minigame outcome (win/lose/score) **never** affects tile completion state — the tile stays marked complete regardless of how the minigame goes.
- Optional refinement: avoid repeating the immediately-preceding draw (track a "last played" pointer, re-roll once on a match) to prevent back-to-back repeats feeling stale. Not required, but worth adding if time allows.

### 4.2 Milestone Detection (line / X / blackout)
Grid indexed 0-24, `row = floor(i/5)`, `col = i % 5`.

- **Line**: any of the 5 rows OR 5 columns fully completed (10 possible lines total).
- **X shape**: both diagonals completed. Diagonal A = indices `0, 6, 12, 18, 24` (row == col). Diagonal B = indices `4, 8, 12, 16, 20` (row + col == 4). Union = **9 unique tiles** (index 12 is shared by both). The X milestone triggers only when all 9 of these specific tiles are completed — this is not "any 5 filled tiles," it's specifically this shape.
- **Blackout**: all 25 tiles completed.
- Check milestone status after **every** tile completion, not periodically. Support triggering multiple milestone messages in sequence if one completion satisfies more than one shape at once (rare edge case, but the animation layer should queue rather than drop one).
- On milestone: pass the exact tile ids/positions forming the completed shape to the animation layer for highlighting — don't just highlight "recently completed" tiles generically.
- Messages: **"BINGO"** (line), **"X MARKS THE SPOT"** (X shape), **"BLACKOUT"** (all 25).

### 4.3 Map Node State & Bingo Interconnectivity
- States are mutually exclusive: `not_visited` (default) / `visited` / `closed`. `closed` is a staff/admin-set state, not guest-triggered — hardcode which nodes (if any) start closed for the POC, or add a minimal admin toggle.
- Tapping a node opens a detail popup: name, description, current state, and — if it has any uncompleted linked Bingo tiles — the count of those.
- Marking a node "visited": if it has at least one uncompleted linked tile, show a "Did you complete [tile label] here?" Yes/No popup **before** finalizing the visited state.
  - Yes → mark that tile completed (triggers 4.1 and 4.2) **and** mark the node visited.
  - No → mark the node visited only, no tile change.
  - If a node has multiple uncompleted linked tiles, ask about each one in sequence (one popup per tile) rather than only the first, so none get silently skipped.

---

## 5. Known Base44 Failure Points — Use as Test Cases

These are the specific things that broke in the Base44 attempt. Treat each as an explicit thing to verify once built, not just implement-and-move-on:

- **Map nodes**: confirm all three states render distinctly, and tapping a node produces an accurate, non-stale linked-tile count.
- **Minigame randomization**: run the draw ~100 times in a test and confirm a roughly even distribution across the pool — Base44's version was reportedly uneven or broken in a way that favored/ignored certain games.
- **Snake**: this was the specific minigame that broke. Verify collision detection (walls + self), growth-on-eat, and the short target-length win condition (reach length 10, not an endless mode) all work correctly before considering it done.

---

## 6. Reference Data

### 6.1 Map Node List
(Caveat: the physical park map this is based on is itself outdated — see the full plan doc's note on the new Capybara Area and missing newer games/puzzles. Treat this as a starting seed, confirm before finalizing.)

- **Attractions:** Arcade Pad, Pedal Karts, Tractor Ride, Mini-Golf, Archery, Tether Ball, Chicken Bowl, Axe Throwing, Farm Toss, Fort Slide, Playground, Mystery Maze, Blaster Balls, Ground Games, Climbing Wall, Slide Tower, Rope Maze, Soccer Game, Cornhole, Cornhole Extreme, Horse Hoops, Tiki Toss/Ring & Hook, Pyramid Puzzler, Hop Dots, Red White and Blue, Math Maze, Right Turn Only
- **Animals:** Small Animals; Kangaroos/Wallaroos; Goats; Alpacas/Sheep/Pigs; Capybaras & Emus
- **Services & Food:** Ticket Booth, Restrooms, Party Tents, Main Stage, Critter Cafe, Sugar Shack, General Store
- **Seasonal (Halloween/Fall)** — decide whether to include for POC: Mad House, Area 51, Scarey Tales, Buried Alive, and Haunted Manor haunted houses; Maze of Terror

### 6.2 Bingo Tile Pool (seed ~25, tied to map sections where possible)
Generate tiles like: "Visit the Capybara habitat," "Try the Farm Toss game," "Win a round at Cornhole," "Beat the challenge time at Hop Dots," "Win a round of Gaga Ball," "Beat a family member at Giant Checkers," "Visit the Kangaroo/Wallaroo section," etc. — reference real map sections above wherever a tile implies a location.

### 6.3 Phase 1 Minigame Specs
1. **Whack-a-Capybara** — capybara heads pop up randomly from a grid of holes; tap before they disappear to score. Occasional decoy animal pops up instead — tapping it does NOT score (red-light/green-light twist). ~30 second timer.
2. **Pattern Repeat** — Simon-style memory game, farm animal theme (cow/pig/chicken/sheep icons or sounds). Sequence grows each round; player taps it back in order; ends on first mistake.
3. **Card Flip Pairs** — 4x4 grid (16 cards, 8 pairs), themed around park animals. Flip two at a time, find all matches to finish.
4. **Mini Maze** — small grid maze; navigate start to finish via swipe/drag/directional taps, avoiding dead ends. Timed.
5. **Mini Snake** — small-scale classic Snake; swipe or on-screen arrows for direction; ends on collision or on reaching a short target length (e.g. 10) — not an endless mode.

---

## 7. Suggested First Claude Code Session

A reasonable opening prompt/session goal, once the repo is scaffolded:

> Set up the project structure per section 1, then build the MapNode and BingoTile/BingoCard data models (section 3) with the Phase 1 seed data (section 6). Once the data layer is working, build the Interactive Map screen and Bingo Card screen with the core logic in section 4 — pay particular attention to the milestone detection math (4.2) and the minigame random draw (4.1), since those are exactly the areas that broke in a prior no-code attempt at this same app. Leave the 5 Phase 1 minigames as stub components that can be triggered from Bingo tile completion, and we'll build each one out individually after the Map/Bingo core is solid.

Building the Map/Bingo core with stubbed-out minigame triggers first — before writing any of the 5 games themselves — means you can verify the trickiest logic (milestone detection, randomization, interconnectivity) in isolation before layering game-specific code on top.
