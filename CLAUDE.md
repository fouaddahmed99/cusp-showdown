# CLAUDE.md — cusp-showdown

A quiz-board game built on the CUSP LRN approved question bank. It is a **consumer** of content,
never an author of it.

## Hard rules

- **Never write clinical content** anywhere in this repo — not in code, tests, fixtures, demo packs,
  comments or commit messages. Real questions arrive only from the published CUSP LRN bundle via
  `pnpm content:sync`. This repeats the rule in `cusp-lrn-content/CLAUDE.md`, which governs here too.
- **Demo and fixture content must be obviously fake and non-clinical**, prefixed `SAMPLE`. It exists
  so the interface can be exercised, nothing more.
- **Never hand-edit `public/content-lrn/`** or `src/contract/lrn-public-v1.ts` to make content fit.
  The contract is a mirror of the upstream public contract; change it only to track an upstream
  change, and bump `SUPPORTED_CONTRACT_VERSION` when upstream's version moves.
- **Never fabricate a question to fill a tile.** A category without enough approved content gets
  empty tiles and a stated reason.
- **Never show an answer key before the response is locked in.** `a/<id>.json` is fetched at grading
  time, and in multiplayer the key reaches the database only in `reveal_round()`.
- **Never modify `cusp-lrn-content` or `cusp-lrn-web`** from here.

## Multiplayer

The database is the authority for buzz order, scoring and permissions. Any new feature that changes
score or decides who was first belongs in a `security definer` function in `supabase/schema.sql`,
not in the client. Public tables carry select policies only; there is no direct write path.

Test schema changes with `CUSP_TEST_DATABASE_URL=... pnpm test` before shipping them — plpgsql
variable/column ambiguity in particular does not show up until the function runs.

## Commands

```bash
pnpm dev · pnpm test · pnpm typecheck · pnpm build · pnpm e2e
pnpm content:sync     # refresh the approved bundle
pnpm content:demo     # regenerate the SAMPLE demo pack
```
