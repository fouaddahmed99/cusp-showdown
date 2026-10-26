# CUSP Showdown

**Live: https://fouaddahmed99.github.io/cusp-showdown/**

A quiz-board game for pediatric dentistry board review. Six categories, thirty tiles, a buzzer on
every phone in the room — built on the approved CUSP LRN question bank, so every answer comes back
with its explanation and its guideline citation.

Solo practice needs nothing but a browser. Live multiplayer needs a free Supabase project (one-time
setup, below).

---

## Feature status

Honest status, not a wish list. "Verified" means a test in this repository exercises it.

| Area | Status |
| --- | --- |
| Solo game: board, timer, grading, explanations, citations, scoring | **Working, verified in a browser** |
| Board generator: difficulty spread, no repeats, honest shortfalls | **Working, unit tested** |
| Content adapter against the real published bundle | **Working, tested against the live bundle** |
| Final challenge with wagers | **Working, verified in a browser** |
| Study mode, immediate vs end-of-game feedback, timers, penalties | **Working** |
| Local progress, personal bests, review of missed questions | **Working, verified in a browser** |
| Game summary: score, accuracy, per-category breakdown, references | **Working, verified in a browser** |
| Multiplayer database: rooms, buzz order, scoring, permissions, RLS | **Working, verified against a real Postgres** |
| Multiplayer client: host console, join, buzzers, teams, reconnection | **Written and type-checked; not yet run against a live Supabase project** |
| Deployment to GitHub Pages | **Deployed and serving the approved bundle** |

The multiplayer client is the one part not yet exercised end to end, because that needs a Supabase
project. Its database half is verified, and a contract test checks that every RPC the client sends
matches a function in `supabase/schema.sql` with the same argument names. The first live game is
still the real test.

---

## Where the questions come from

Showdown never writes questions. It reads the bundle the CUSP LRN pipeline publishes:

```
cusp-lrn-content (private)  --publish workflow-->  cusp-lrn-web/content/  --sync-->  public/content-lrn/
```

Every item in that bundle has already passed automated verification and owner approval, and the
publish step strips internal fields by an explicit whitelist. Showdown reads only the already-public
bundle, so the private repository stays private and is never touched.

Two packs ship:

- **`public/content-lrn/`** — the approved bundle. Real questions, real citations. Refresh it with
  `pnpm content:sync`.
- **`public/content-demo/`** — generated placeholder content, every string prefixed `SAMPLE`, so the
  board can be played before the approved bank is large enough to fill thirty tiles. It carries no
  clinical content and the manifest flags it `sample: true`, which puts a demo badge on the board.

The app says which pack is in play on the home screen, on the board, and in the summary. Settings
lets you force either one.

**As of the last sync the approved bank holds 71 playable items** (44 MCQ, 27 vignette MCQ) across
9 domains, citing 31 sources — enough that a full six-category board fills with approved content
alone, which is what the live site serves. The demo pack now only appears if the bundle cannot be
read, or if you pick it in settings.

If the bank ever falls below a full board, "approved content only" says so plainly: the tiles it
cannot fill come back empty with the reason. Nothing is ever generated to fill a tile.

### Difficulty

The published contract has no difficulty score. The only reviewed difficulty signal on an item is
`tags.cognitiveLevel`, which has three values, so the five point rows are mapped onto them:

| Points | Cognitive level |
| --- | --- |
| 200, 400 | `remember` |
| 600, 800 | `understand_apply` |
| 1000 | `analyze_evaluate` |

When a row's own level has run out, the generator may fill it from an adjacent level, and the tile
carries a marker saying so. It never invents a difficulty.

Right now the bank has no `analyze_evaluate` items, so **every 1000-point row borrows an
`understand_apply` question** and is marked as borrowed. Publishing some `analyze_evaluate` items is
what would make the top row genuinely harder.

### What the adapter refuses

- A bundle built for a newer contract version — it stops rather than guessing at the shape.
- Any payload carrying an internal-only field, re-running the publish leak scan on the way in.
- A question whose version does not match its answer's: the item changed mid-game, so it is not
  graded and the player is told.
- Anything that is not an MCQ-like item. Flashcards and OCE vignettes are left alone.

---

## Running it locally

```bash
pnpm install
pnpm content:demo        # generate the labelled demo pack
pnpm content:sync        # pull the approved bundle (needs network)
pnpm dev                 # http://localhost:5173
```

Other commands:

```bash
pnpm test                # unit tests: adapter, board generator, scoring, game rules
pnpm typecheck
pnpm build
pnpm e2e                 # plays a whole solo game in a real browser against dist/
```

`pnpm e2e` needs Playwright. Either `pnpm add -D playwright` or have it installed in the
environment.

---

## Live multiplayer

### How it works

The **server is the authority**. Clients never report scores, buzz order, or timestamps:

- Buzz order is decided by a primary key on `(round_id, epoch)` in `buzz_winners`. The first
  transaction to commit wins; every later one conflicts and is told it lost. Timestamps come from
  `clock_timestamp()`.
- Score changes are computed inside `judge_round()` from the round's own point value.
- Host actions require the host token, stored only as a SHA-256 hash in a table the `anon` role has
  no policy for.
- The answer key is not in the database until the host reveals it, and the item id lives in a
  private table, so a player cannot resolve the item in the public bundle ahead of the reveal.
- Every public table is readable and writable by nobody directly: there are no insert, update or
  delete policies, so the only write path is a `security definer` function.
- Rooms expire (8 hours by default) and `cleanup_expired_rooms()` deletes them, so a free-tier
  database does not fill up.

Players need no account — a room code and a display name, nothing else.

### Setup

1. **Create a free Supabase project** at supabase.com.
2. **Run the schema.** SQL Editor → New query → paste `supabase/schema.sql` → Run. It is idempotent.
3. **Add two secrets** in GitHub under Settings → Secrets and variables → Actions:
   - `VITE_SUPABASE_URL` — `https://<project>.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` — the project's anon key

   Both are public by design; every write they can reach is checked server-side against a room token.
4. **Redeploy.** Push to `main` or run the Deploy workflow by hand.

For local development put the same two values in `.env.local` and restart `pnpm dev`.

Until this is done, Host and Join show the setup instructions and solo play is unaffected. Nothing
is simulated locally and no screen pretends a room exists.

### Testing the schema

```bash
CUSP_TEST_DATABASE_URL=postgres://user@host:5432/db pnpm test
```

Runs `schema.sql` against that database and exercises the buzz race with ten concurrent clients,
host permissions, score authority, rate limiting, reconnection, wagers, late-join rules and expiry.
Skipped when the variable is absent. **Use a scratch database — it drops and recreates `public`.**

### Running a game

The host opens **Host a game**, projects the board, and reads the room code off the screen.
Residents open the join link or type the code on their phones.

Host keyboard shortcuts: `B` or `Space` open and lock the buzzers, `Y` and `N` score the buzz
winner, `R` reveals the answer, `P` toggles projector type size.

A wrong answer reopens buzzing on a fresh epoch, so the player who already missed cannot win the
same race again. The host can adjust any score by hand, retire a questionable item without scoring
it, and close late joining.

---

## Deploying

The Deploy workflow builds on every push to `main` and publishes to GitHub Pages. It typechecks,
runs the unit tests, refreshes the content bundle, builds with the right base path, and checks that
`dist/` actually carries its content before uploading.

Pages is enabled and the first deployment succeeded. If you ever need to set it up again:
**Settings → Pages → Build and deployment → Source: GitHub Actions**.

The site is served from `/<repo>/`, which the build bakes in via `BASE_PATH`. Deep links use hash
routing (`#/join/ABCDE`) because Pages serves static files only and would 404 on a real path — this
matters because a join link is the thing people paste into a group chat.

For a custom domain, set `BASE_PATH=/` in the build step.

---

## Project layout

```
src/contract/      a read-only copy of the CUSP LRN public contract (zod)
src/content/       the versioned adapter: packs, catalog, board generator, difficulty mapping
src/game/          solo game rules as a pure reducer, scoring, local progress
src/multiplayer/   Supabase client, room API, configuration detection
src/ui/            screens and components
supabase/          schema.sql: tables, RLS, and the functions that own the game
scripts/           content sync and demo-pack generation
tests/             unit tests, schema tests, and the browser playthrough
```

## Content rules this repository follows

The CUSP LRN project forbids writing clinical content anywhere outside its source-grounded
pipeline, and requires demo data to be obviously fake. Accordingly:

- No clinical facts, questions, answers or explanations are written here, in code, tests, fixtures
  or commit messages.
- Demo and fixture content is non-clinical and prefixed `SAMPLE`.
- Real questions arrive only through `pnpm content:sync` from the published bundle.
- `public/content-lrn/` is generated. Never hand-edit it.

## Credits

Original artwork, sound and typography. Sound effects are synthesised in the browser with the Web
Audio API, so the repository ships no audio files. The game takes its board mechanic from the
general quiz-board format; none of the presentation is borrowed from any television production.
