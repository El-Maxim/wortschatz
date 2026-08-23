# Decisions

Deviations from `BUILD_PROMPT_german_app.md`, and the reasoning behind judgement
calls the spec left open.

## Toolchain installed into `~/.local` (Phase 0)

The machine had no Node, npm, `gh` or Homebrew. Rather than require a Homebrew
install (sudo, system-wide), Node 24 LTS and GitHub CLI 2.97 were unpacked into
`~/.local/opt` and symlinked into `~/.local/bin`, which was already on `PATH`.
Reversible by deleting those two folders. Approved by the user before running.

## Routing without a router dependency

The spec fixed the stack but said nothing about routing. A ~60-line History-API
router (`src/lib/router.ts`) covers the eight routes this app has, so
`react-router` was not added. Deep links work via the standard GitHub Pages
`404.html` redirect trick, as the spec asked.

## Markdown rendered without a dependency

`src/ui/Markdown.tsx` renders the subset the grammar theory uses (headings,
lists, pipe tables, blockquotes, bold/italic/code). It builds React elements
rather than HTML strings, so coach-authored theory cannot inject markup — worth
more here than full CommonMark coverage.

## Generated exercises are not persisted

Exercises derived from the user's own words (article drills, cloze from context
sentences, conjugation, word order) are rebuilt on demand instead of stored.
They are cheap to regenerate and would otherwise grow the synced dataset without
adding information. Only curated and coach-written exercises live in Dexie and
Supabase. Attempts *are* stored, so topic progress survives.

## Sync conflict policy

Last-write-wins per row on `updated_at`, as specified. With one user on two
devices, genuine concurrent edits to the same row are rare, and the loss in a
conflict is at most one edit to one word. Soft deletes (`deleted: true`) rather
than row removal, so a delete on the phone propagates to the desktop instead of
being resurrected by it.

## Screenshots use the installed Chrome

There was no preinstalled Chromium and no Playwright browser cache. Playwright
drives the system Google Chrome (`channel: 'chrome'`) instead of downloading a
~150 MB browser — same automation, no extra disk.

## Repository is public, not private (Phase 0)

The spec asked for a private repo, GitHub Pages hosting, and zero recurring cost.
On GitHub's free plan those three cannot all hold: Pages refuses to serve a
private repository (HTTP 422, "Your current plan does not support GitHub Pages
for this repository"). Zero cost was the non-negotiable constraint, so the repo
is public. Nothing sensitive is exposed — `.env` is gitignored, and all user data
lives in Supabase and IndexedDB, never in git. The user chose this over the
alternative of hosting elsewhere.

## Auxiliary verb when Wiktionary lists both

Wiktionary gives some verbs two auxiliaries ("auxiliary haben or sein", e.g.
*aufstehen*). The pipeline stores `sein` in that case. It is the marked form a
learner has to remember, and it matches the everyday motion/change-of-state
reading — *ich bin aufgestanden*, not *ich habe aufgestanden*.

## Long glosses are shortened, not dropped

Entries are capped at 90 characters per gloss, but Wiktionary's *primary* sense is
often its most verbose ("to get up (move from a sitting or lying position…)").
Discarding over-long glosses left words showing only their marginal senses, so a
gloss that overruns is cut at its trailing parenthetical instead.

## Deep links return HTTP 404 by design

GitHub Pages has no server-side rewrite, so `/wortschatz/ueben` returns 404 and
`404.html` redirects into the SPA. The page renders correctly, but the browser
still logs the 404 — expected, and filtered out of the e2e error assertion.

## Seeded content uses deterministic ids

The six curated topics are created independently on every device, so a random
uuid gave the same topic a different id on the phone and on the laptop. The
second device to sync then tried to hold two rows with one slug and hit the
unique index — `ConstraintError` in Dexie, and `unique (user_id, slug)` on
Postgres — which failed the whole sync, not just that row.

Seeded topics and exercises now derive their id from their slug (RFC 4122 v5,
fixed namespace) in `src/db/seed.ts`, so every device computes the same id and
the rows merge. `pull()` additionally self-heals a unique-index clash by
dropping the stale local row, so installs that already seeded with random ids
recover instead of being permanently stuck.

Caught by the Phase 6 acceptance run, which is the only test that exercises two
devices against one account.

## Explicit table grants in the migration

Newer Supabase projects do not automatically grant new tables in `public` to the
API roles, so RLS policies alone left `authenticated` and `service_role` with no
access at all (`permission denied for table words`). The migration now grants
explicitly and sets default privileges, rather than relying on project defaults.

## Sheets render through a portal

`backdrop-filter` on the sticky header makes it a containing block for
`position: fixed` descendants. The sign-in sheet was rendered from inside the
header, so its "full-screen" backdrop was only as tall as the header and the
sheet was pushed off the top of the screen — the email field sat at y = -68px
and could not be reached on a phone.

`src/ui/Sheet.tsx` now portals every sheet into `<body>`, making it independent
of where it is mounted from, and both the capture and account sheets use it.
Sheet height also moved from `vh` to `dvh`, since iOS counts browser chrome in
`vh` and would otherwise put the buttons below the visible area.

## Password sign-in alongside magic links

An installed PWA on iOS gets its own storage sandbox, and a magic link always
opens in Safari — so the session it creates is invisible to the home-screen app,
which can therefore never be signed in by email. Supabase's shared SMTP also
caps sign-in emails at two per hour on the free tier, which the repeated
attempts hit.

Password sign-in is now the primary path (`signInWithPassword`), with the magic
link kept as a fallback and as the way to bootstrap an account that has no
password yet. The account panel gained a "set a password" section, since an
account created by a magic link has none.

## Bundled content is never synced

The six curated topics and their 72 exercises ship inside the app, so every
device seeds an identical copy. Syncing them added no information and could not
be made to converge:

- topics collided on `unique (user_id, slug)` — each device generated its own
  random id for the same slug, so the second device's push failed permanently
  ("duplicate key value violates unique constraint")
- exercises have no natural key at all, so an upsert could not merge them; each
  device's copy inserted alongside the other's and the pool doubled to 144

`seedGrammar` now writes them straight to Dexie without queueing, and `sync`
skips them in both directions. Their ids are still derived from the slug (uuid
v5), because `exercise_attempts` do sync and reference an exercise by id — a
drill answered on the phone has to mean the same thing on the laptop.

Grammar topics and exercises the *coach* writes (`generated` / `coach`) are real
data and sync normally. `grammar_topics` also upserts on `(user_id, slug)` as a
safety net.

Note that the seed ids are global rather than per-account, which is fine for the
single-user app this is specified to be, but would let two accounts in one
project collide on the primary key.

## The sync watermark comes from the data, not the clock

`pull()` originally recorded `lastSyncAt` as `new Date().toISOString()` — this
device's clock — and then asked for rows with `updated_at` greater than it. But
`updated_at` is stamped by whichever device *wrote* the row. A laptop that
finished a sync at its own 22:30 would thereafter ignore a word the phone had
stamped 22:28, permanently, because the watermark only moves forward. The same
hole swallowed anything written between the pull query and the stamp.

The watermark is now the newest `updated_at` actually received from the server,
which is immune to both. `syncWatermarkVersion` forces one full re-pull on
devices still holding a clock-derived watermark, so they recover the rows that
scheme skipped.

`scripts/e2e-clockskew.mjs` reproduces it: device B's watermark is pushed ten
minutes into the future, device A writes a word, and B must still receive it.

## A cold start re-reads everything

The incremental watermark is an optimisation, and every bug in it has looked the
same from the outside: sync reports success and quietly serves stale data. That
is the worst possible failure mode, because there is nothing for the user to
notice and nothing for me to debug from.

So the watermark is no longer trusted as the only path to correctness. A full
re-read runs on every cold start, and once a day for an app left open. For one
user with a few hundred rows that is one small request per table; in exchange,
any drift — from any cause, including ones not yet found — is repaired by
opening the app. Pulls are also paged now, so `review_log` cannot outgrow a
single response and be silently truncated.

## The app reloads itself when a new build lands

`skipWaiting` + `clientsClaim` swap the *service worker* immediately, but a page
already open keeps running the JavaScript it loaded. A tab left open since
before a deploy, or an app resumed from the home screen, therefore keeps
executing the old bundle indefinitely — and keeps reporting "Synced", because
the old sync code still runs and still succeeds.

That is how a shipped fix can fail to reach a device that never looks broken.
`src/lib/updates.ts` reloads once when a new worker takes control, guarded so
the first-ever load (where `clientsClaim` fires the same event) does not flash.

## The build stamp is visible in the app

The Sync panel shows the build timestamp. A device stuck on an old bundle is
indistinguishable from a healthy one otherwise, which turned a five-minute
diagnosis into several rounds of guessing.
