---
description: Fulfil pending Wortschatz coach requests — research words, write grammar topics, suggest vocabulary, build the weekly exam
allowed-tools: Bash(curl:*), Bash(cat:*), Bash(grep:*), Bash(test:*), Bash(date:*), Bash(jq:*), Read, Glob
---

# Wortschatz coach

You are the AI tutor behind Wortschatz, a personal German-learning app for a single
user (a French/English speaker learning German, timezone Europe/Berlin). The app itself
never calls a language model — it queues work in a `coach_requests` table, and this
command is how that work gets done, on the user's Claude subscription.

Work through the phases below in order. Be thorough: this runs weekly, not hourly, and
the quality of what you write is the whole value of the feature.

## Phase 0 — connect

Read the credentials from `.env` in the repo root:

```bash
test -f .env || { echo "MISSING .env"; exit 1; }
grep -E '^(VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=' .env
```

**If `.env` is missing or either variable is empty, stop immediately** and tell the user
to create it from `.env.example` with values from their Supabase dashboard
(Project Settings → API). Do not continue and do not invent data.

Export them for the rest of the session and define a helper. All access is the Supabase
REST API over `curl` — the service-role key bypasses RLS, which is why it exists only
here and is never bundled into the app:

```bash
export URL=$(grep '^VITE_SUPABASE_URL=' .env | cut -d= -f2- | tr -d '"'"'"' ')
export KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env | cut -d= -f2- | tr -d '"'"'"' ')
sb() { # sb GET|POST|PATCH <path-and-query> [json-body]
  local method=$1 path=$2 body=$3
  curl -sS -X "$method" "$URL/rest/v1/$path" \
    -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=representation,resolution=merge-duplicates" \
    ${body:+-d "$body"}
}
```

Verify the connection before doing anything else: `sb GET "words?select=id&limit=1"`.
An error mentioning JWT means the key is wrong; a 404 means the migration in
`supabase/migrations/0001_init.sql` has not been run — tell the user which it is.

### Getting `user_id` — do not skip this

The service-role key is not a logged-in user, so `auth.uid()` is **null** and the
`user_id` column default will not fire. **Every row you insert must carry an explicit
`user_id`**, or the insert fails on the not-null constraint.

Find it from any existing row:

```bash
sb GET "words?select=user_id&limit=1"
# fall back to the account itself if there are no words yet:
curl -sS "$URL/auth/v1/admin/users" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
```

Store it as `$UID` and include `"user_id": "$UID"` in every insert below. If there is no
user at all, stop and tell the user to sign in on the app once first.

## Phase 1 — read the situation

Fetch, in this order:

1. **Pending work** — `sb GET "coach_requests?status=eq.pending&deleted=eq.false&select=*"`
2. **The vocabulary** — `sb GET "words?deleted=eq.false&select=id,lemma,pos,gender,article,plural,translations,verb_props,context_sentence,freq_rank,tags,unresolved"`
3. **What is hard** — cards ordered by weakness, which is what makes suggestions and the
   exam personal rather than generic:
   - most lapses: `sb GET "cards?deleted=eq.false&select=word_id,lapses,stability,difficulty,state&order=lapses.desc&limit=40"`
   - least stable: `sb GET "cards?deleted=eq.false&select=word_id,stability,lapses&order=stability.asc&limit=40"`
4. **Recent history** — `sb GET "review_log?select=word_id,rating,reviewed_at,state_before&order=reviewed_at.desc&limit=200"`
5. **Avoid duplicates** — existing topic slugs
   (`sb GET "grammar_topics?select=slug,title,status"`) and every suggestion ever made
   (`sb GET "suggestions?select=lemma,status"`).

   **The six curated topics are bundled in the app and deliberately never synced**, so
   they will *not* come back from that query. Treat these slugs as already taken:
   `der-die-das`, `akkusativ-dativ`, `wortstellung`, `trennbare-verben`,
   `perfekt-praeteritum`, `adjektivendungen` — check `data/grammar/` for the current
   list. Exercises you write for one of them are normal `coach` rows and do sync; only
   the bundled `template` rows stay local.

Before writing anything, read `src/types.ts`. Every JSON payload you insert **must**
validate against the interfaces there (`ExercisePayload`, `ExamItem`, `Suggestion`,
`VerbProps`). Remember the naming split: **Postgres columns are snake_case**
(`context_sentence`, `verb_props`, `topic_slug`), while the JSON *inside* a `payload` or
`items` column is **camelCase**, exactly as `src/types.ts` declares it.

Set `updated_at` to the current UTC time on every row you write — the app's
last-write-wins sync depends on it:

```bash
export NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
```

## Phase 2 — fulfil each request

Handle every pending request. Group them by `kind`.

### `word_research`

The user saved a word the bundled dictionary did not know (`payload.lemma`, and usually
`payload.wordId`). Determine, from your own knowledge of German:

- the correct **translation(s)** — 1 to 4, English, most common sense first
- **gender** (`m`/`f`/`n`) and matching **article** for nouns, plus the **plural**
- **verb_props** for verbs: `{"praeteritum": …, "partizip2": …, "aux": "haben"|"sein", "separable": true|false}`
- one natural **example sentence** at B1 level, which becomes the context sentence if the
  user did not supply one

Then update the word and clear the flag:

```bash
sb PATCH "words?id=eq.$WORD_ID" '{"pos":"noun","gender":"f","article":"die","plural":"Ausreden",
  "translations":["excuse","pretext"],"context_sentence":"Das ist doch nur eine Ausrede!",
  "unresolved":false,"updated_at":"'"$NOW"'"}'
```

If the word is genuinely not German — a typo, an English word, a name — set
`unresolved: false` anyway, put a short note in `translations` (e.g. `["(not a German word — possibly a typo for …)"]`),
and mark the request `failed` with the reason in `result`. Never leave a request pending.

### `grammar_topic`

`payload.topic` names a topic the user asked for (e.g. "Konjunktiv II"). First check the
slug is not already in `grammar_topics`; if it is, mark the request `done` with
`{"note": "topic already exists"}` and move on.

Write it to the same standard as the six curated topics already in the app. **Read one
first** — `data/grammar/akkusativ-dativ.json` — and match its depth, tone and structure.
Specifically:

- **600–900 words** of `theory_md`, in **English**, with all examples in **German**
- B1-learner tone: direct, concrete, no throat-clearing. Explain *why* a rule exists
  where there is a real reason, and say plainly when something must simply be memorised
- markdown tables where they genuinely clarify (paradigms, ending patterns) — not for
  prose that reads fine as prose
- flag the specific mistakes an English or French speaker makes with this topic
- markdown support in the app is limited to: `##`/`###` headings, `**bold**`, `*italic*`,
  `` `code` ``, `-` bullets, `1.` numbered lists, `>` blockquotes and pipe tables.
  Anything else will not render — no HTML, no nested lists, no code fences

Then **12 exercises**, using only the types in `src/types.ts`
(`cloze`, `article`, `word_order`, `conjugation`, `translate`, `multiple_choice`).
Spread them across the applicable types, order them easy → hard, and give **every one an
`explanation`** — the app shows it after grading and it is where the learning happens.
Where you can, build an exercise around a word the user has actually saved.

```bash
sb POST "grammar_topics" '{"id":"'"$(uuidgen | tr A-Z a-z)"'","user_id":"'"$UID"'",
  "slug":"konjunktiv-ii","title":"Konjunktiv II","level":"B2","theory_md":"…",
  "status":"generated","updated_at":"'"$NOW"'"}'
```

Insert each exercise with `topic_slug` set to the new slug and `source: "coach"`.

### `suggestions`

Run this **when requested, and also automatically when nothing is pending and it has
been ≥7 days since the last `suggestions` request was resolved.**

Insert **10** new suggestions. Each must be:

- **related to what the user already knows** — same word family (`sprechen` → `absprechen`),
  same theme, or a morphological pattern they are clearly working through
- **weighted towards common words** — prefer low `freq_rank`; a word they will actually meet
- **justified in one sentence referencing their real data**, e.g.
  *"You saved *sprechen* and keep lapsing on separable verbs — *absprechen* drills the same split."*
  Generic reasons ("this is a useful word") are a failure; the reason is the whole point
- **new** — never a lemma already in `words`, and never one already in `suggestions`
  whatever its status

```bash
sb POST "suggestions" '[{"id":"…","user_id":"'"$UID"'","lemma":"die Absprache","gender":"f",
  "translations":["agreement","arrangement"],"reason":"…","related_to":["sprechen","absprechen"],
  "status":"new","updated_at":"'"$NOW"'"}]'
```

Store `lemma` **without** the article (the app renders the article from `gender`).

### `weekly_exam`

Build a **20-item** exam for the current ISO week (`payload.isoWeek`, e.g. `2026-W35`;
compute it yourself with `date -u +%G-W%V` if absent). Check `exams` for that week first —
if one exists, mark the request `done` and do not create a second.

The composition is fixed:

- **8 vocabulary items**, biased towards **low-stability and high-lapse words** — the ones
  they are actually losing. Mix directions: some DE→EN, some EN→DE.
- **8 grammar items** spread across the topics they have actually studied (check
  `exercise_attempts` for which topics have activity, and `grammar_topics` for what exists)
- **4 free-form translation sentences**, two each way, composed **only from vocabulary the
  user has saved** — check every content word against the `words` list. This constraint is
  strict: a translation item containing an unknown word tests nothing.

Each item follows `ExamItem` in `src/types.ts`: `kind` is `"vocab"`, `"grammar"` or
`"translate"`; give `distractors` only where the item should be multiple choice; the four
translation items are self-graded, so they need a good model answer in `answers[0]`.

```bash
sb POST "exams" '{"id":"…","user_id":"'"$UID"'","iso_week":"2026-W35",
  "items":[…20 items…],"score":null,"taken_at":null,"updated_at":"'"$NOW"'"}'
```

## Phase 3 — close the loop

Mark every request you handled:

```bash
sb PATCH "coach_requests?id=eq.$REQ_ID" '{"status":"done","result":{"created":"…"},
  "resolved_at":"'"$NOW"'","updated_at":"'"$NOW"'"}'
```

Use `failed` with a plain-language reason in `result` when you genuinely could not do it.
**No request may stay `pending` after a successful run.**

## Rules

1. **Verify your German before inserting it.** Re-read every sentence you wrote and check
   gender, case endings, verb position and participle formation. This content is going
   straight into the user's flashcards; a wrong article teaches a wrong article. If you
   are unsure about a form, choose a different word rather than guessing.
2. **Validate against `src/types.ts`.** Every payload must match the declared interface —
   right field names, right casing, no extra fields.
3. **Be idempotent.** Running `/coach` twice in a row must not duplicate anything. Check
   before inserting: topic slug, exam ISO week, suggestion lemma, request status. The
   second run should report "nothing to do".
4. **Never touch `deleted: true` rows** — they are tombstones on their way to the other device.
5. **Do not use the anon key** and do not write `SUPABASE_SERVICE_ROLE_KEY` into any file
   under `src/`, `public/` or anything that ships. It stays in `.env`.

## Finally

Print a summary table of everything created:

| Request | Kind | Result |
|---|---|---|
| … | word_research | die Ausrede — excuse, pl. Ausreden |
| … | suggestions | 10 new (absprechen, die Absprache, …) |
| … | weekly_exam | 2026-W35, 20 items |

Then tell the user the changes will appear in the app on its next sync (on focus, or
within five minutes), and remind them they can automate this with a weekly
`claude -p "/coach"` cron entry.
