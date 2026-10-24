# CAP Companion App — Project Plan

**Project:** Cobb's Adventure Park Companion App
**Status:** Proof of Concept
**Scope:** Single-tenant (Cobb's only, no multi-tenant architecture)

---

## 1. Vision

A single companion app that turns a visit to Cobb's into a connected, game-like experience. Instead of separate standalone tools, every feature feeds a shared sense of progress — points earned in one activity show up in others, and the visit builds toward one satisfying payoff at the end (the Family Passport).

The guiding design principle: **each feature should stand on its own, but none should feel isolated.**

---

## 2. Core Features

### 2.1 Scavenger Hunt
- Three characters at launch: a marsupial, a camelid, and a rodent.
- Each character has **5 challenges**: 1 multiple choice, 1 true/false, 1 matching, and 2 random draws from the shared Minigame Library (section 2.13). MC, True/False, and Matching are exclusive to Scavenger Hunt — not part of the shared random pool.
- Each answer reveals a clue about the character's identity; the final question asks the guest to guess the species based on everything learned.
- Species reveal is a dedicated animated moment (confidence meter fills as clues are answered correctly, then a card-flip style reveal).
- Difficulty branching by age group (younger guests get more T/F and matching; older guests get riddles and short answer).

### 2.2 Scoring Sheet
Confirmed from official park rule sheets — scoring is **variable point-per-shot**, not simple hit/miss, so the data model needs a per-game point table rather than one generic scoring pattern.

| Game | Win Condition | Scoring |
|---|---|---|
| **Farm Toss** | First to 21 | Ring toss at animal targets, each worth different points (2, 3, 4, 5 or 6 per throw, plus Miss; migration 047) |
| **Horse Hoops** | Team play, first to 10 (bonus round on tie) | Hit horse with hoop = 1 pt; hoop around blue horse's neck = 2; yellow = 3; red = 4 |
| **Cornhole** | First to 21 | Innings-based, each player pitches all 4 bags per inning. "Woody" (bag rests on board) = 1 pt; "Cornhole" (bag through the hole) = 3 pts |
| **Cornhole Extreme** | First to 21 | Three-hole variant. Woody = 1 pt; first hole = 2, second hole = 3, third hole = 4 |
| **Tiki Toss / Ring & Hook** (the "ring toss" game) | First to 100 (highest score wins if multiple reach 100 same round; tie plays until someone wins a round) | 10 throws/round. "Ting" (single hit) = 1 pt; "Nassau" (double hit same throw) = 3 pts; "Bimini" (ringer/hooked) = 5 pts |
| **Blacklight Mini Golf** / **Cornhole Mini Golf** (two separate courses; "Cornhole Mini Golf" is not the Cornhole game) | Stroke play: lowest total strokes wins, ties shared | 9 holes to start (really 9-12; hole count is data, `scoring_games.hole_count`). 1-999 strokes per hole, no par. Migration 043 |
| **Archery** | Not yet documented | Pending official rules |

- Flashy animation on every score entry, tuned per game and per point-value (a Bimini ringer deserves a bigger animation than a Woody, for example) — miss = "maybe next time" with a light comedic touch, big scores = escalating celebration.
- Win animation when a game concludes.
- Downloadable/shareable score sheet.
- The colorful terminology (Ting, Nassau, Bimini, Woody) is a natural source of flavor text for the score-entry animations rather than generic "hit"/"miss" labels.
- Archery rule sheet still needed before its scoring logic can be built. Mini golf is built as a second scoring mode (stroke play), see migration 043.

### 2.3 Puzzle Solving Timer
Confirmed from official rule signage. Important architecture note: **most of these puzzles have multiple challenge variants**, not one single objective — the timer needs to support selecting a challenge level per puzzle, not just start/stop against a single target.

| Puzzle | Rules | Challenge Variants |
|---|---|---|
| **Pyramid Puzzler** | Turn right on red, left on blue, straight on yellow; choose freely on white squares; start over if forced off the pyramid | 1: reach the top. 2: reach the top, then exit from the starting block. 3: visit all 4 corners and the centre, then exit from the starting block |
| **Hop Dots** | Hop dots in order RED, BLUE, YELLOW | 1: start on any corner red dot, reach the opposite corner red dot, return to start. 2: start on any corner red dot, visit all other corner dots clockwise or counter-clockwise, return to start |
| **Red, White and Blue** | Enter on the bottom red tile, exit on the top blue tile; stay on paths; no turning around; alternate red/blue, never two of the same color in a row; must retrace your path to solve | Single objective |
| **Math Maze** | Start on the start square; move in a straight line the number of tiles marked on your current tile; one direction per move; no diagonal moves; reach the finish square | Multiple maze layouts posted (at least two distinct number sequences seen on-site) |
| **Right Turn Only** | Stay on paths; no turning around; no left turns; don't stop until reaching the centre | Challenge: complete the maze in 20 turns |
| **Big Mystery Maze** | Walkthrough maze (Scooby-Doo mystery themed); no posted step-by-step rule sheet found on-site | Straightforward timed walkthrough — good candidate for a simple "time to complete" leaderboard without challenge-tier complexity |

- Start/stop timer per puzzle **and per challenge variant**, compared against a posted challenge time for that variant.
- Progressive hint system (tap for a nudge, tap again for more, final tap for full solution) rather than one-shot answer reveal.
- Leaderboard per puzzle and per challenge variant (daily / all-time).

### 2.4 Interactive Park Map
- Digital map with clickable nodes per attraction.
- Each node shows: brief description, related in-app hints (e.g. "Scavenger Hunt character here"), and next available time for scheduled events.
- Colorable node states: **visited / not visited / closed**.
- Live countdown ticking on schedule-linked nodes (tractor, stage) rather than static text.
- **Bingo interconnectivity**: tapping a node shows the number of available (uncompleted) Bingo tiles tied to that park section. Marking a node as visited prompts a popup asking whether the linked Bingo tile/challenge was completed — a "yes" marks that tile complete (triggering its minigame and any milestone check) without the guest needing to separately open the Bingo card.

**Confirmed node list**, from the current physical park map (photographed — slightly outdated per the park's own note, see caveat below):

| Category | Nodes |
|---|---|
| **Attractions** (18) | Arcade Pad, Pedal Karts, Tractor Ride, Mini-Golf, Archery, Tether Ball, Chicken Bowl, Axe Throwing, Farm Toss, Fort Slide, Playground, Mystery Maze, Blaster Balls, Ground Games, Climbing Wall, Slide Tower, Rope Maze, Soccer Game |
| **Animals** (7 sections) | Small Animals; Kangaroos/Wallaroos; Goats; Alpacas/Sheep/Pigs; Capybaras & Emus; Wallaroos (viewing only); Private Event Animal Space |
| **Services** (6) | Ticket Booth, Restrooms, Party Tents, Main Stage, Admin Offices, Animal Stage |
| **Food & Stores** (4) | Critter Cafe, Granny Ann's Kitchen, Sugar Shack, General Store |
| **Halloween/Fall** (6, seasonal) | Mad House, Area 51, Scarey Tales, Buried Alive, and Haunted Manor haunted houses; Maze of Terror |

- **Map caveat**: the physical map itself is out of date — it shows a red arrow pointing to a "NEW Capybara Area" not yet reflected in the printed node positions, and several newer additions (Cornhole, Cornhole Extreme, Horse Hoops, Tiki Toss/Ring & Hook, and the park puzzles — Pyramid, Hop Dots, Red White and Blue, Math Maze, Right Turn Only) don't appear on this map at all. The digital map's node list should be confirmed against current park layout rather than built directly off this photo — treat it as the starting skeleton, not the final node set.
- **Halloween/Fall nodes are seasonal** — worth deciding whether the POC map shows them year-round, hides them outside the season, or omits them entirely for now (they're not tied to any core app feature).
- **Fun idea for later** (not weekend scope): the physical map already has a built-in "Map Game" — a spot-the-hidden-object challenge with illustrated icons (a juggler, a pumpkin, a vampire, a stormtrooper, a rocket, etc.) scattered across the map art. A digital version of this — tap the hidden icons on the interactive map — would reuse existing park branding/assets and fits the same spirit as the rest of the app, but isn't essential for the Map+Bingo weekend demo.

### 2.5 QR Codes on Animal Pen Signs
- QR scan opens an encyclopedia-style page per animal.
- Content delivered as short, swipeable cards (3–5 per animal) rather than a long article — one fact + photo per card.
- Populated with original photos taken at the park.
- Scanning all signs in a pen unlocks a completionist badge.

### 2.6 Bingo Card
- Randomized bingo card per family member — **25 tiles**.
- Tiles reference activities from across the app (scavenger hunt completions, puzzle times, general sightseeing) and can auto-mark when completed elsewhere, or be marked directly via the Map interconnectivity flow (section 2.4).
- Tapping an open tile shows its challenge description; tapping "Completed Challenge" marks it complete and triggers **1 random minigame** from the Shared Minigame Library (section 2.13). If the newly filled tile connects to make 5 total filled tiles in a milestone shape, the milestone animation plays after that minigame, followed by a button offering **1 additional** random minigame framed as celebrating the milestone (2 total for that fill).
- **Milestone animations** — the demo centerpiece for this feature: completing a line, an X, or a full blackout highlights the exact tiles forming that shape, then displays a dedicated message ("BINGO", "X MARKS THE SPOT", "BLACKOUT").

### 2.7 Home Screen
- Daily Event Schedule: tractor rides and stage shows on a recurring schedule, subtle "starting in 5 minutes" notification (user-disableable).
- Surfaces "what's next for you" — nearest incomplete scavenger hunt character, active bingo card, upcoming event.

### 2.8 Digital Family Passport Redemption
- Triggered when a family finishes park activities.
- Prompts a group photo, then generates a digital summary card: activities completed, most games won, scavenger hunt completion percentage, and other stats.
- Auto-generated title/badge based on the family's strongest category (e.g. "Maze Masters," "Sharpshooter Family").
- Physical print option to be investigated separately.

### 2.9 Cobb Coins
- Coins awarded for completing app activities, scaled by challenge level.
- POC scope: digital collectibles/badges only, no real-world redemption yet — gives management a working loop to react to before deciding on physical rewards.

### 2.10 Contact Staff Button
- Two separate flows: general question vs. genuine emergency, so staff can prioritize accordingly.
- Attaches guest's nearest map node/zone so staff know where to respond.
- Requires a lightweight staff-facing view showing incoming requests with location — treated as its own small sub-feature.

### 2.11 Additional Park Games (Map/Bingo integration)
Found on-site with no obvious fit in Scavenger Hunt, Scoring Sheet, or Puzzle Timer. None of these need a dedicated feature for the POC — they slot naturally into the Interactive Map and Bingo Card instead:

- **Gaga Ball**: has an official rule sheet (dodgeball-style, played in a pit, last player standing wins). Doesn't need a points scoreboard since there's a single winner per round, not a running score — best fit is a **Bingo tile** ("win a round of Gaga Ball") or a simple "declare winner" tap on the Map node, no full Scoring Sheet entry needed.
- **Giant Pool** (soccer-ball billiards on an inflatable table): no rule sheet found on-site — likely house rules only. Map node for now; revisit for Bingo/Scoring once/if official rules exist.
- **Giant Checkers**: clear win/loss, no point count — natural Bingo tile ("win a game of giant checkers against a family member"), otherwise just a Map node.
- **Giant Sandbox**: non-competitive, open play, mainly for younger kids. Map node only, with a possible photo-based Bingo tile ("build a sandcastle") tying into the same photo-submission pattern as the Favorite Photo feature.

### 2.13 Shared Minigame Library
Ten confirmed minigames, drawn randomly for Scavenger Hunt's 2 random slots per character and Bingo's 1 (or 3, on a milestone-connecting fill) slots per tile. Grouped below by shared underlying engine — building one engine per group and re-skinning it across games is the efficient build path, rather than building each as a one-off.

| Game | Theme | Mechanic | Shared Engine Group |
|---|---|---|---|
| **Mini Platformer** | Kangaroo | Run/jump side-scroller | Platformer (standalone) |
| **Mini Snake** | — | Classic snake | Snake (standalone) |
| **Whack-a-Capybara** | Capybara | Reaction tap / red-light-green-light | Reaction/Timing |
| **Pattern Repeat** | Farm animals | Simon-style sequence memory | Reaction/Timing |
| **Digital Ring Toss** | — | Drag-and-release aim/power throw | Aim/Physics (standalone) |
| **Bug Net Swipe** | — | Swipe to net moving targets | Aim/Physics (standalone) |
| **Card Flip Pairs** | Various park animals (16 cards, 8 pairs) | Memory match grid | Grid/Drag |
| **Obstacle Dodge** | Alpaca | Swipe left/right, endless lane dodge | Auto-Scroll |
| **Mini Maze** | — | Trace a path through a small maze | Grid/Drag |
| **Sort the Species** | — | Sort falling items into the correct bin before they land | Auto-Scroll |

- **Reaction/Timing engine**: shared timing-window and input-scoring logic underneath Whack-a-Capybara and Pattern Repeat.
- **Grid/Drag engine**: shared grid-and-drag-interaction logic underneath Card Flip Pairs and Mini Maze.
- **Auto-Scroll engine**: shared scrolling-lane and collision logic underneath Obstacle Dodge and Sort the Species.
- Platformer, Snake, Digital Ring Toss, and Bug Net Swipe are distinct enough mechanically to stay standalone builds.

### 2.14 Favorite Photo (Day/Week/Month)
- Guests submit favorite park photos.
- Staff-curated shortlist for voting (rather than fully open submission-to-vote) to avoid moderation issues.
- Top photo per period shared to Cobb's website.

---

## 3. Cross-Feature Integration Points

These are the connective threads that make the app feel like one product:

- **Cobb Coins** as the shared reward currency across Scavenger Hunt, Scoring Sheet wins, Puzzle Timer challenge-beats, and Bingo tiles.
- **Bingo tiles auto-marking** from Scavenger Hunt, Puzzle Timer, and QR scan completions.
- **Shared Minigame Library** (10 games — see section 2.13) used by both Scavenger Hunt (2 random slots per character) and Bingo (1, or 3 on a milestone-connecting fill).
- **Map as launcher** — tapping a node can deep-link into the relevant feature (tap mini golf node → open Scoring Sheet for that game).
- **Family Passport** as the single end-of-visit rollup of everything above.

---

## 4. Proposed Tech Stack

**Long-term / post-weekend:**
- **Frontend:** React
- **Backend:** FastAPI
- **Database:** Supabase
- **Minigames:** Godot, exported to HTML5/WebGL and embedded in the React app (used for platformer, whack-a-mole, snake, and any future minigames)
- **QR codes:** static codes per pen linking to a route/ID in-app

**Weekend Demo Sprint tooling — resolved:** the Base44 experiment concluded. It produced a decent first pass overall, but had real problems with the Map's node handling, minigame randomization logic, and some individual minigames (Snake specifically). Per the fallback plan, **the build now moves to Claude Code and the long-term stack above** — Base44's output is treated as disposable exploration, not something to migrate from; the app gets built fresh. Base44 remains something to keep experimenting with separately/on the side, just not as the vehicle for this project.

Notes given this is Base44's first real use on this project:
- **Treat anything built in Base44 as disposable exploration**, not a foundation to build on top of. Base44 doesn't support code export, so if the fallback triggers, the plan is to re-architect fresh in Claude Code/React — not migrate or extract code from the Base44 build.
- **Credits are the practical constraint to watch.** Base44's pricing is credit-based (message credits for building, integration credits for the app running), and free-tier limits are tight for a build this size — worth confirming which paid tier is in use before sinking a full weekend into it.
- **Minigames are the highest-risk piece to build in Base44** — they need custom timing/collision logic, which is a documented weak spot for no-code builders generally. Map and Bingo (data-model-and-state-driven) are a much safer bet for Base44 to handle well.


---

## 5. Deliberate POC Scope Limits

To keep this buildable as a proof of concept rather than a launch-ready product:

- No multi-tenant architecture — Cobb's only.
- QR Encyclopedia: 3–5 cards per animal, not a full archive.
- Cobb Coins: digital collectibles only, no real redemption logic.
- Favorite Photo: staff-curated shortlist, not open public submission.
- **Centerpiece animation resolved**: the Bingo milestone animations (line/X/blackout) are the demo centerpiece — these get full polish first.
- **Scavenger Hunt, Scoring Sheet, and QR Encyclopedia ship as navigation skeletons only** for the weekend demo (the screens exist and are reachable, but their real content/game logic isn't built yet) — priority is Map + Bingo + Minigames, since those are the features Mike hasn't seen in any form.
- Minigame pool starts with 5 (the logic/grid-based ones) and grows to the full 10 afterward — Bingo's random-draw logic doesn't care how many are in the pool, so this costs nothing structurally.

---

## 6. Open Items to Investigate

- **Archery and Mini Golf** scoring rules — no rule sheet found yet for either; deferred from POC scope for now.
- **Map node list**: the photographed physical map is outdated (missing the new Capybara Area, Cornhole/Cornhole Extreme/Horse Hoops/Tiki Toss, and all 6 park puzzles) — good enough as a starting skeleton for the weekend build, but the final node set and positions should be confirmed against the current park layout before this goes past the demo stage.
- **Halloween/Fall nodes**: decide whether these show year-round, are seasonally toggled, or are left out of the app entirely.
- **Tractor Ride schedule discrepancy**: the original plan assumed rides "every half hour," but the posted signage shows two separate locations, each running hourly, offset by 30 minutes from each other — East location on the half-hour (11:30, 12:30, 1:30, 2:30, 3:30, 4:30), West location on the hour (11:00, 12:00, 1:00, [2:00 slot unclear/blacked out on sign], 3:00, 4:00). This means the schedule feature needs a **location field** per ride, not just a time — worth confirming which locations are active and what the 2:00 PM West slot actually is before building the Daily Event Schedule.
- Puzzle challenge times — need official/target times per puzzle *and per challenge variant* (see section 2.3) for pyramid, hop dots, red white and blue, math maze, right turn maze, big mystery maze.
- Physical Family Passport print fulfillment options.
- Staff-facing dashboard for Contact Staff button — scope as its own mini deliverable.
- Giant Pool rules (house rules only, if any) — revisit if it's ever wanted beyond a Map node.

---

## 7. Development Timeline

**Priority shift**: Map + Bingo + the shared Minigame Library now come first, ahead of Scavenger Hunt/Scoring Sheet/Encyclopedia content — those three ship as reachable-but-empty navigation skeletons for now. Reasoning: Map and Bingo are entirely new to Mike, while Scavenger Hunt already exists in a prior form he's seen — the new features are where the demo impact is.

**Honest scope note on "this weekend":** the full list (interactive Map, 25-tile Bingo with milestone animations, 10 minigames, and full map/bingo interconnectivity) is genuinely a lot to land end-to-end in ~3-4 days, even at this pace — four of the ten minigames (Mini Platformer, Digital Ring Toss, Bug Net Swipe, Obstacle Dodge) need real physics/collision tuning that doesn't compress well under time pressure. The plan below is scoped to be **genuinely demoable by the weekend** by shipping 5 of the 10 minigames (the logic/grid-based ones, which don't need physics tuning) rather than rushing all 10 to a rough state. The remaining 4 physics-based minigames plus Sort the Species follow immediately after.

### Weekend Demo Sprint (Day 1 – Foundation)
- App shell / navigation, including reachable-but-empty skeleton screens for Scavenger Hunt, Scoring Sheet, and QR Encyclopedia
- Map data model: nodes, states (visited / not visited / closed), section-to-Bingo-tile linkage
- Bingo data model: 25-tile grid, randomization, line/X/blackout detection logic
- Godot → HTML5/WebGL export pipeline confirmed working and embedded in the React shell (de-risks the minigame work before building any of them)

### Weekend Demo Sprint (Day 2 – Map & Bingo Core)
- Interactive Park Map: nodes, states, tap interactions, node detail popup
- Bingo Card: 25-tile grid UI, tile-fill interaction, milestone detection wired to actual gameplay (not just the animation)
- Map ↔ Bingo interconnectivity: tapping a node shows available/uncompleted tile count for that section; marking a node visited prompts the "was this challenge completed?" popup and marks the linked tile on confirmation

**Checkpoint (end of Day 2): go/no-go on Base44.** This is the natural decision point — Map and Bingo are done, minigames haven't started yet, so it's the cheapest moment to redirect. If Base44 is handling the data-model/state/interconnectivity work well, continue into Day 3's minigames there. If it's fighting you already at this stage (before the harder minigame work even starts), that's the signal to fall back to Claude Code now rather than deeper into the weekend — sunk Base44 time in Day 1-2 is not a reason to push forward if it's not working.

### Weekend Demo Sprint (Day 3 – Minigames)
- Build the 5 non-physics minigames: **Whack-a-Capybara, Pattern Repeat, Card Flip Pairs, Mini Maze, Mini Snake** — all grid/logic/timing-based, no collision or trajectory physics required, ~30 seconds each
- Wire minigame pool into Bingo's tile-completion trigger (1 random draw, or 3 on a milestone-connecting fill)

### Weekend Demo Sprint (Day 4 – Milestone Animations & Polish)
- Bingo milestone animations: tile highlight + "BINGO" / "X MARKS THE SPOT" / "BLACKOUT" reveal — this is the demo centerpiece, gets the most polish time
- Integration pass: Map ↔ Bingo flow end-to-end, bug sweep
- Demo script/flow prepared for Mike — likely walking through: mark a few map nodes visited → pop the linked Bingo tiles → trigger a couple of minigames → complete a line/X for the milestone animation payoff

### Following Week: Round Out the Minigame Pool & Puzzle Timer (if time allows)
- Build the remaining 5 minigames: **Mini Platformer (kangaroo), Digital Ring Toss, Bug Net Swipe, Obstacle Dodge (alpaca), Sort the Species**
- Puzzle Solving Timer (all 6 puzzles + challenge variants, progressive hints, leaderboard) — explicitly lower priority than the minigame pool, only if time remains

### Later Sprints (unchanged in substance, resume after the above)
- **Scoring Sheet**: all documented games (Farm Toss, Horse Hoops, Cornhole, Cornhole Extreme, Tiki Toss/Ring & Hook), per-game point-value animations, win animation, downloadable sheet; mini golf/archery once rules are found
- **QR Encyclopedia**: card-based animal pages, photo integration, completionist badge
- **Scavenger Hunt full content**: all 3 characters with their 5 challenges each (MC, T/F, Matching, 2 random minigame draws), species reveal animation
- **Digital Family Passport, Cobb Coins full loop, Contact Staff + staff dashboard, Favorite Photo**
- **Full integration & polish pass** across all features once everything above exists

The exact week count past the weekend sprint is intentionally left open — the weekend is the fixed point that matters; everything after resumes at a sustainable pace once Mike has seen the new stuff.
