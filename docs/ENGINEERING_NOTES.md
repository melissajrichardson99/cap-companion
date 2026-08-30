# Engineering notes

Deeper dives that didn't fit the README's four-story highlights reel. Same
project, same solo build — these are additional specific bugs, proofs, and
diagnoses worth showing the reasoning behind, not just the fix.

## Deploying to a real, multi-service, zero-budget production stack

Getting this app onto free-tier infrastructure (Cloudflare + Render +
Supabase, [`DEPLOYMENT.md`](../DEPLOYMENT.md)) surfaced enough real problems
that it's worth its own section rather than a single line item.

**A migration-ordering bug, confirmed the hard way.** Migration
`017_grant_service_role_privileges.sql` grants the backend's `service_role`
Postgres user table privileges — a fresh Supabase project grants it none by
default — and also sets `alter default privileges` so *future* migrations'
tables inherit those grants automatically. That makes numeric order load-
bearing: run later migrations before 017 and their tables never get the
default-privilege grant either, silently reproducing the same failure one
migration was supposed to fix. Rather than trust that reasoning, I confirmed
it against a fresh Docker Postgres instance — ran the migrations out of
order, reproduced the exact `42501: permission denied for table X` failure,
applied the fix, then spun up a *second* fresh instance and reproduced the
original failure again before reapplying the fix there too. That second
reproduction is the part that actually matters: without it, "it works now"
and "it was ever broken for the reason I think" are two different claims,
and only a repeatable before/after on a clean instance proves the second
one.

**An architecture pivot forced mid-deployment.** The deployment plan was
written around Cloudflare Pages. By the time I actually deployed, Cloudflare
had moved its entire static-hosting story to Workers with Static Assets —
Pages wasn't gone, but it was no longer the product's forward path. That
meant re-deriving the deployment plan against a materially different
platform (routing config, asset serving, the `run_worker_first` mechanism
for `/games/*`) instead of executing the one that had already been
designed, mid-deployment, not in advance.

**A 25MiB asset cap blocked every minigame.** Cloudflare's static-assets
layer caps individual files at 25MiB; Godot's HTML5/WebGL exports ship
`.wasm` binaries around 38MB each. Two real options existed: rebuild each
Godot export stripped-down enough to fit under the cap, or move the
minigames to storage without a per-file limit. I treated it as a genuine
build-vs-buy call rather than defaulting to whichever fix looked closer at
hand — shrinking ten separate Godot web exports is repeated, fragile,
per-export work with no guarantee of staying under the cap as games grow,
against standing up Cloudflare R2 once and writing a small edge Worker to
stream objects out of it. R2 won on that tradeoff, at the cost of requiring
a credit card on the account even for free-tier usage.

**A Node version change silently broke an upload script.** The R2 upload
script (`scripts/upload-games-to-r2.mjs`) shells out to Wrangler's `.cmd`
shim on Windows, which requires `shell: true`. As of Node 20, `spawn`/
`execSync` stopped auto-escaping array args under `shell: true` (Node
DEP0190) — any arg containing a space or shell metacharacter just silently
splits into multiple argv entries instead of erroring. Root-caused by
isolating the exact `spawn` call in a throwaway script and comparing its
actual argv against what was intended, rather than guessing from the
Wrangler error output. The fix is a small `shellQuote()` helper the script
now runs every arg through.

**A "CORS regression" that was actually a Render outage.** Every frontend
API call started failing with a missing `Access-Control-Allow-Origin`
header, with zero config changes on my end — the textbook signature of a
CORS misconfiguration, and the easy wrong move would've been to start
editing `CORS_ALLOWED_ORIGINS`. Instead of assuming the obvious explanation,
I `curl -i`'d the backend directly: the response carried an
`x-render-routing: hibernate-wake-error` header and returned near-instantly
rather than after a normal cold-start delay, meaning Render's own edge proxy
was rejecting the request before it ever reached FastAPI's `CORSMiddleware`
— which is also why the response had no CORS headers at all. Render's
status page confirmed an active platform incident. The evidence (routing
header, response timing, third-party status page) pointed at the real cause
before I touched a single environment variable that didn't need touching.

## Proving a game-design constraint mathematically before building around it

Bingo's milestone system originally had to account for a "triple bingo" —
three lines completing on the same tile placement. It can't actually happen
on a 5×5 grid: every tile belongs to exactly one row and exactly one
column, so a single newly-filled tile can complete at most one row and one
column simultaneously — two lines, never three. Proving that up front
(rather than discovering it empirically) collapsed the milestone system to
a clean four-tier hierarchy — line, double bingo, X, blackout — with no
dead "triple" branch to maintain, backed by 9 unit tests covering the
genuinely reachable simultaneous-completion cases (a shared-tile double
line, three lines resolving to one double-bingo display, and the single
final tile that closes every row, column, the X, and the blackout at once).

## Solving two real physical puzzles computationally

Two of the park's actual physical puzzles — a numbered-tile jump maze and a
directional automaton — got transcribed from photographs into
problem-specific state-space representations, then solved with dedicated
BFS search rather than worked out by hand. The hardest maze variant
resolved to a verified 39-move full-board traversal. Because the input was
a photo transcription and not a spec, the transcriptions themselves got
cross-validated before trusting the computed answer — a wrong transcription
would still produce a confident, exact-looking, and completely wrong
solution, so the solver's output is only as trustworthy as the state space
it was handed.

## Catching a false negative in a load-testing methodology before trusting the result

An HTTP/2 connection bug needed a before/after comparison to confirm, and
the first attempt showed no difference between the two runs — which looked
like the fix (or the bug) didn't exist. It didn't exist in the *test*: a
failed background process bind had left a zombie process still listening on
the target port, so both "before" and "after" runs were silently hitting
the same stale process instead of the code under test. Checking actual
bound PIDs via `netstat` before re-running exposed it. A clean re-run
against the right process reproduced the real bug and then confirmed the
fix — the methodology bug would have produced a confident, false "no
regression" result if it had gone unchecked.

## Diagnosing a React bug by understanding why a dev-mode safety feature exists

A UI state bug ([`App.tsx`](../frontend/src/App.tsx) —
`handleMinigameOverlayClose`) only reliably reproduced under React
StrictMode: closing a minigame overlay could double-queue the milestone
banner and the "Play Bonus Minigame" prompt, making the app look stuck
after a minigame had already been played once. StrictMode double-invokes
functional state updaters in dev specifically to catch updaters that aren't
pure — so instead of treating the double-fire as a dev-only quirk to
suppress, I traced it to the actual cause: a `setState` updater with side
effects (further `setState` calls) nested inside it. The fix moved those
side effects out to plain statements after the updater rather than inside
it — fixing the impure pattern StrictMode exists to catch, not just the
symptom that happened to be visible in dev.

## A bug where the code was locally correct but the state machine made it unreachable

The Scoring Sheet's "bonus round on tie" rule had passing unit tests and
was, in isolation, correctly implemented — and yet it was mathematically
impossible to trigger during real play. The session locked as soon as the
first player crossed the win threshold, which meant no second player could
ever catch up far enough to create a tie; the game was already over by the
time a tie became possible. The fix wasn't in the tie-detection logic at
all — it was recognizing that a different, earlier design decision (locking
eagerly on first "won" rather than only on a monotonically final win type)
had made a correctly-written code path permanently dead in practice. A
passing unit test proves a function is correct; it doesn't prove the
function is ever reachable.

## A real bug invisible to the entire existing test suite

Answering a Scavenger Hunt challenge correctly stopped advancing to the
next character — but only when reached the way an actual guest reaches it,
by scanning a physical QR code. Every existing test drove the same screen
through the app's in-app navigation instead, and that path happened not to
exercise the bug at all. A technically green, otherwise-thorough suite had
a blind spot for a common real-world path simply because nothing in it ever
took that path — a reminder that test coverage is a claim about the paths
you wrote tests for, not about the paths users actually take.

## A subtle race condition in the QR camera scanner

Camera permission granted, the barcode decode loop running, and the screen
stayed black. The `<video>` element was originally only mounted once
`cameraState` flipped to `"active"` — but the media stream was assigned to
the video ref *before* that state update landed, while the ref was still
null, so `video.srcObject = stream` silently no-opped against an element
that didn't exist yet. The fix ([`ScanEntryModal.tsx`](../frontend/src/components/ScanEntryModal.tsx))
mounts the `<video>` element unconditionally so the ref is guaranteed to
exist before the stream is ever assigned to it — the permission grant and
decode loop had been working correctly the entire time, and there was
nothing about the failure that pointed at "camera" as the actual cause.

## Institutionalizing a recurring cross-cutting gotcha instead of re-diagnosing it each time

Editing `schema.sql` or `seed.sql` in the repo does nothing to an
already-provisioned Supabase project — those files only run once, by hand,
at initial setup. I hit this same gap more than once while adding new
features before turning it into a standing process instead of relearning it
each time: verify what's actually live via the Supabase REST API before
assuming a bug is code-side, and ship every schema change as a new numbered
migration in `backend/supabase/migrations/`, never as an edit to
`seed.sql` that assumes it'll be re-run. `004_phase2_minigames.sql` exists
specifically because that assumption failed once already — its own header
comment documents why.
