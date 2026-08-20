# Wortschatz — Claude Code build prompt

## How to use this file (for Maxim — Claude Code skips this section)

1. Create an empty folder on your computer (e.g. `wortschatz/`) and put this file in it.
2. Before starting, do the three one-time setup steps in the "Manual steps" section at the bottom (GitHub login, Supabase project, `.env` file). ~10 minutes.
3. Open a terminal in the folder, run `claude`, and type:
   `Read BUILD_PROMPT_german_app.md and execute it phase by phase. Complete each phase's acceptance checks before moving to the next. Only stop to ask me something if a "PAUSE" instruction in the file says to.`
4. Expect it to run for a while. Between phases it will commit and deploy, so you can open the app on your phone at any point and see progress.

---

# INSTRUCTIONS FOR CLAUDE CODE — READ FULLY BEFORE WRITING ANY CODE

You are building **Wortschatz**, a personal German-vocabulary and grammar learning app for a single user (Maxim, a French/English speaker learning German, timezone Europe/Berlin). It is a **Progressive Web App**: one codebase, installable and fully usable on both an iPhone/Android phone and a desktop browser. It must be **responsive** (design mobile-first, then verify desktop layout ≥1024px uses the extra width sensibly — e.g. sidebar navigation instead of bottom tabs).

## Non-negotiable constraints

- **Zero recurring cost.** Static hosting on GitHub Pages, Supabase free tier for sync/auth, bundled open-data dictionary, Web Speech API for audio. No paid API of any kind. No OpenAI/Anthropic/DeepL/Google API keys anywhere in the app code.
- **AI features run through Claude Code itself**, via a `/coach` slash command you will create in this repo (spec below). The app never calls an LLM; it queues requests, and the user fulfills them by running `/coach` in Claude Code (covered by their Claude subscription).
- **Local-first.** The app must be fully usable offline (lookup, capture, review, exercises). Supabase is a sync layer, not a dependency for daily use.
- **Single user.** No multi-tenancy, no public signup. Auth exists only so phone and computer share one account.
- **Autonomy.** Make all micro-decisions yourself (naming, styling details, file layout). Do not ask the user questions except at the explicit PAUSE points. If something in this spec is impossible as written, implement the closest working alternative and note it in `DECISIONS.md` at the repo root — do not stop.

## Stack (use exactly this)

- Vite + React + TypeScript, `vite-plugin-pwa` (Workbox) for service worker + manifest.
- Dexie.js over IndexedDB for all local data.
- `ts-fsrs` (npm, from the open-spaced-repetition project) for review scheduling. Do not write a custom scheduler.
- Supabase JS client for auth (email magic link) + Postgres sync.
- Plain CSS or Tailwind (your choice), light + dark theme following `prefers-color-scheme`.
- GitHub Actions workflow deploying `dist/` to GitHub Pages on every push to `main`.
- Node scripts in `scripts/` (run at build time on the dev machine, not in the app) for the dictionary pipeline.

## Data model

Use these entities both in Dexie and in Supabase (same shapes; snake_case in Postgres). Every row has `id` (uuid), `updated_at` (ISO string), `deleted` (bool, soft delete) to support sync.

- **words**: lemma, pos (`noun|verb|adj|adv|phrase|other`), gender (`m|f|n|null`), article (`der|die|das|null`, derived from gender), plural, translations (string[], English), verb_props `{praeteritum, partizip2, aux: 'haben'|'sein', separable: bool} | null`, context_sentence (string, the sentence where the user met the word — optional but prompted for at capture), source_note (where they saw it — optional), freq_rank (int|null, from the frequency list), tags (string[]), created_at.
- **cards**: word_id, plus the full FSRS card state from `ts-fsrs` (due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review). One card per word, direction DE→EN; also a second card EN→DE created automatically 3 days after the first is introduced.
- **review_log**: card_id, rating (1–4), reviewed_at, state before/after. Needed for coach analytics.
- **grammar_topics**: slug, title, level (A1–C1), theory_md (markdown), status (`curated|generated`), created_at.
- **exercises**: topic_slug (nullable), type (`cloze|article|word_order|conjugation|translate|multiple_choice`), payload (JSON — prompt, answer(s), distractors, explanation), source (`template|coach`), created_at.
- **coach_requests**: kind (`grammar_topic|suggestions|weekly_exam|word_research`), payload (JSON, e.g. `{topic: "Konjunktiv II"}` or `{lemma: "die Ausrede"}`), status (`pending|done|failed`), result (JSON|null), created_at, resolved_at.
- **exams**: iso_week (e.g. `2026-W35`), items (JSON array of exercise refs + user answers), score, taken_at (nullable until taken).
- **suggestions**: lemma, gender, translations, reason (one sentence: why this word, tied to the user's data), related_to (lemma[]), status (`new|accepted|dismissed`). Accepting a suggestion creates a word + card.

Supabase: create all tables via a SQL migration file committed to the repo (`supabase/migrations/…`), with RLS enabled and policies restricting every table to `auth.uid() = user_id` (add `user_id` column defaulted to the authenticated uid). Print the migration and tell the user to paste it into the Supabase SQL editor at the PAUSE in Phase 4 (the free tier dashboard is the simplest path; do not require the Supabase CLI).

Sync strategy: last-write-wins on `updated_at`, per row. A `syncQueue` in Dexie records dirty ids; sync runs on app focus, on network regain, and every 5 minutes while open. Show a subtle sync-status dot in the header. Conflicts are unlikely (single user); LWW is acceptable — document this in DECISIONS.md.

## Phase 0 — environment check

Verify: Node ≥ 20, `git`, `gh` CLI authenticated (`gh auth status`), and a `.env` file in the repo root containing `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` (this last one is used ONLY by the `/coach` command, never bundled into the app — enforce this by keeping it out of any `VITE_`-prefixed name). Add `.env` to `.gitignore` immediately, and commit a `.env.example`. **PAUSE only if `gh` is unauthenticated or `.env` is missing**, and tell the user exactly what to do (the Manual steps section below is written for them — point them to it).

Then: `git init`, create a private GitHub repo named `wortschatz` with `gh repo create`, first commit.

## Phase 1 — app shell + deploy pipeline

Scaffold the Vite React TS PWA. Build the responsive shell: bottom tab bar on mobile / sidebar on desktop with five sections — **Wörter** (word list + capture), **Üben** (daily review), **Grammatik**, **Prüfung** (weekly exam), **Coach** (suggestions + pending AI requests). PWA manifest (name, icons — generate a simple typographic "W" icon set with a script, all required sizes), service worker precaching the app shell.

Set up the GitHub Pages deployment: Actions workflow building and publishing `dist/`, `base` path configured for project pages, SPA-fallback 404.html trick. Push, enable Pages via `gh api`, and verify the deployed URL returns the app (curl it).

**Acceptance:** deployed URL loads; Lighthouse PWA installability criteria pass locally (`npx lighthouse` or manual manifest/SW checks); layout verified at 390px and 1280px widths (use Playwright with the preinstalled Chromium to screenshot both and inspect the screenshots yourself).

## Phase 2 — dictionary pipeline + word capture

Build `scripts/build-dictionary.mjs`, run it once now, and commit its **output** (not the raw downloads):

1. Download the German-language extract from kaikki.org (Wiktextract data from English Wiktionary, German words — the JSONL "kaikki.org-dictionary-German" file; find the current URL on kaikki.org). It is large; stream-parse it, never load it whole.
2. Download the German frequency list from the `hermitdave/FrequencyWords` GitHub repo (OpenSubtitles-derived, `de_full.txt` or `de_50k.txt`).
3. Keep entries whose lemma is in the top ~45,000 by frequency, plus ALL nouns regardless of rank (gender lookup should rarely miss). For each entry keep only: lemma, pos, gender, English glosses (max 4, sense-level, strip wiki markup), plural, verb forms (Präteritum, Partizip II, auxiliary, separable-prefix flag), IPA if present, and one example sentence if present.
4. Emit compact JSON shards keyed by the first two letters of the normalized lemma (`dict/aa.json`, `dict/sc.json`, …) into `public/dict/`, plus a small `dict/index.json` with shard names and a bloom-filter or sorted key list for fast "is this word known" checks. Target: total ≤ 15 MB uncompressed. If over, cut glosses to 2 and drop IPA.
5. Service worker: cache dictionary shards with a cache-first strategy after first use, so lookups the user has made work offline.

Capture flow (this is the heart of the app — make it fast): a persistent "+" button on every screen → input field, auto-focused. As the user types, live-lookup against the shards (debounced, normalized for case/umlauts). On match: show article + lemma (e.g. **die Ausrede**), translations, plural, verb parts if verb, and a 🔊 button using `speechSynthesis` with a `de-DE` voice. One optional field: "Where did you see it? Paste the sentence." Save = word + FSRS card created, two taps total from opening the app. On NO match: save the word anyway with status "unresolved" and auto-create a `coach_requests` row of kind `word_research` — the coach fills in translation/gender later. Never block capture on a failed lookup.

Word list view: searchable, sortable by date/frequency/due, each row shows article-colored lemma (consistent color coding: der=blue, die=red, das=green — an established mnemonic convention), translation, and a small badge if unresolved. Detail view shows everything incl. context sentence and review history.

Add attribution in an About screen: Wiktionary data (CC-BY-SA, link), FrequencyWords (link), and license note in the repo README.

**Acceptance:** `Haus`, `laufen`, `schön`, `Ausrede`, `verabreden` all resolve with correct gender/verb data; a nonsense word saves as unresolved and enqueues a coach request; TTS speaks; total `public/dict/` ≤ 15 MB; capture works with dev server offline (after shards cached).

## Phase 3 — daily review (FSRS)

Wire `ts-fsrs` with default parameters and desired retention 0.9. **Üben** screen: shows count due today; card front is either the German lemma (DE→EN: recall meaning, then self-grade Again/Hard/Good/Easy) or the English translation with a text input (EN→DE: must type the German word; grade automatically — exact match after normalization = Good, minor diacritic/case error = Hard, wrong = Again, plus a "was actually correct" override button). For noun cards EN→DE, the typed answer must include the correct article to count as fully correct; missing/wrong article = Hard, with the article shown in the feedback. Show the context sentence (if any) on the card back. Daily new-card introduction capped at 10, prioritized by freq_rank (commonest first). A small stats panel: reviews done today, streak, retention over last 30 days (from review_log).

**Acceptance:** simulate 30 days of reviews with a seed script (fake clock via injected `now()` — make the scheduler clock injectable) and verify intervals grow for Good and reset toward relearning for Again; the EN→DE article rule works for der/die/das cases.

## Phase 4 — auth + sync

Supabase email magic-link auth (single user). First-run screen asks for email; after login, everything syncs per the strategy above. **PAUSE:** print the SQL migration and ask the user to paste it into the Supabase SQL editor, then continue and verify by writing and reading back a test row. App must remain fully usable when logged out or offline (sync simply queues).

**Acceptance:** create a word locally → appears in Supabase table; edit `updated_at`-newer row in Supabase → wins locally on next sync; airplane-mode simulation (Playwright offline mode) queues and flushes.

## Phase 5 — grammar section + exercise templates

Two parts:

1. **Curated topics — write these yourself, now, at build time** (this is free AI work through the subscription, done once): produce `theory_md` + 12 template exercises each for six topics: *Der/die/das & noun gender patterns*, *Akkusativ vs. Dativ*, *Word order & verb-second*, *Separable verbs*, *Perfekt vs. Präteritum*, *Adjective endings*. Theory: ~600–900 words each, in English, examples in German, B1-learner tone, tables where they genuinely help. Store as seed data loaded into Dexie on first run and committed as JSON in the repo. Mark `status: curated`.
2. **Template exercise engine** that also generates exercises from the user's OWN words: article drills (pick der/die/das for a noun you saved), cloze from saved context sentences (blank the saved word), conjugation drills from verb_props, word-order shuffles from context sentences. These regenerate endlessly at zero cost.

Grammatik screen: topic list with progress (exercises attempted/correct), topic page = theory + "Üben" button running its exercise pool. A "Request new topic" button: free-text topic name → creates `coach_requests` of kind `grammar_topic` and shows it as "waiting for coach".

**Acceptance:** all six topics render with working exercises of every applicable type; an article drill correctly pulls only the user's saved nouns; requesting a topic enqueues correctly.

## Phase 6 — the `/coach` command (AI via Claude subscription)

Create `.claude/commands/coach.md`. This is a prompt file; when the user types `/coach` in Claude Code inside this repo, Claude Code executes it. Write it to instruct the following, precisely:

1. Read `SUPABASE_SERVICE_ROLE_KEY` and `VITE_SUPABASE_URL` from `.env`; talk to Supabase over its REST API with `curl` (service role bypasses RLS — this key exists only in `.env`, never in app code; refuse to run if `.env` is missing).
2. Fetch all `coach_requests` with status `pending`, plus analytics: words with highest lapses, lowest FSRS stability, unresolved words, tags, last 200 review_log rows, list of existing grammar topics and suggestion lemmas (to avoid duplicates).
3. Fulfill each request:
   - `word_research`: determine translation(s), gender/article, plural, verb props, one example sentence; update the word row, mark resolved.
   - `grammar_topic`: write theory_md (same quality bar as the curated six) + 12 exercises tailored to the requested topic, insert into grammar_topics/exercises with `status: generated` / `source: coach`.
   - `suggestions` (also run automatically if none pending and it's been ≥7 days since last run): insert 10 new suggestion rows — thematically/morphologically related to the user's words, weighted toward common words (low freq_rank), each with a one-sentence reason referencing the user's actual data ("You saved *sprechen* and struggle with separable verbs — *absprechen*…"). Never suggest an already-saved or already-suggested lemma.
   - `weekly_exam`: build a 20-item exam JSON for the current ISO week — 8 vocab items biased toward low-stability words, 8 grammar items across studied topics, 4 free-form translation sentences (DE→EN and EN→DE) composed ONLY from vocabulary the user has saved; insert into `exams`.
4. Mark requests `done` (or `failed` with a reason in `result`), print a summary table of everything created.
5. Constraints to write into the command: German content must be grammatically verified by the model before insert; JSON payloads must validate against the shapes in `src/types.ts` (tell it to read that file); idempotent — re-running must not duplicate.

Coach screen in the app: pending requests with status, suggestion cards (accept → becomes a word+card / dismiss), and a "How to run the coach" help box telling the user: *open a terminal in the project folder, run `claude`, type `/coach`* — plus a note that they can schedule it weekly (e.g., a recurring reminder, or a cron entry that runs `claude -p "/coach"`; mention `claude -p` runs it non-interactively).

**Prüfung screen** (completes the exam feature): shows this week's exam if the coach has generated one — taking it walks through the 20 items, auto-grades what's auto-gradable, self-grade for translations, stores score; history chart of weekly scores. If no exam exists for the current week, show one button: "Request exam" (enqueues `weekly_exam`) and the coach help box.

**Acceptance:** run `/coach` yourself now against the real Supabase project — seed a few test words and one request of each kind first, verify every kind fulfills correctly and idempotently (run twice, no duplicates), then clean up test data.

## Phase 7 — capture ergonomics + polish

- **Android/Chrome:** add a Web Share Target to the manifest so selecting a word in any app → Share → Wortschatz opens capture pre-filled.
- **iOS:** Share Target is unsupported in Safari PWAs. Instead: support a `?add=WORD` URL parameter that opens capture pre-filled, and write `docs/ios-shortcut.md` with step-by-step instructions (with the app's real URL) for creating an Apple Shortcut "Add to Wortschatz" that accepts shared/selected text and opens that URL — so capture from the iOS share sheet works in two taps.
- Verify offline end-to-end with Playwright: load app, go offline, capture a known word, review a due card, do a grammar exercise.
- Final Playwright screenshot pass at 390px and 1280px of all five sections; inspect each screenshot yourself and fix anything that looks broken or cramped.
- Update README: what the app is, the zero-cost architecture, how to run the coach, attribution, and a one-page "daily use" guide.

**Acceptance:** everything above verified; final commit pushed; deployed URL confirmed working; print the URL and iOS/Android install instructions as the final message.

---

## Manual steps (for Maxim — the only things Claude Code can't do for you)

1. **GitHub** (free): install the `gh` CLI if missing, run `gh auth login` once.
2. **Supabase** (free tier): create an account at supabase.com → New project (any name, EU region, free plan). In Project Settings → API, copy three values into a file named `.env` in the project folder:
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   SUPABASE_SERVICE_ROLE_KEY=eyJ...
   ```
3. **During Phase 4** Claude Code will hand you a SQL block — paste it into Supabase → SQL Editor → Run, then tell it to continue.
4. **On your phone**, once deployed: open the URL → browser menu → "Add to Home Screen". Same on desktop via the install icon in the address bar.
5. **Weekly habit:** open a terminal in the project folder and run `claude -p "/coach"` (or just `/coach` inside an interactive session) — this fulfills word research, new grammar topics, fresh suggestions, and the weekly exam, all on your Claude subscription. Ask Claude Code to set up a weekly reminder or cron entry for this if you want it automatic.
