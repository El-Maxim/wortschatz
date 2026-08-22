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
