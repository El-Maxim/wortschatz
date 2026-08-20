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
