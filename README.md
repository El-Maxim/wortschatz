# Wortschatz

A personal German vocabulary and grammar trainer. One installable web app for phone
and desktop, fully usable offline, with **no recurring cost of any kind**.

**Live: https://el-maxim.github.io/wortschatz/**

Capture a word the moment you meet it, review it on an FSRS schedule, drill grammar
built from your own vocabulary, and sit a weekly exam. The AI parts run through Claude
Code on your own machine, so there is no API bill.

## Daily use

| | |
|---|---|
| **Met a new word** | Tap **+**, type it. The article, translation, plural and verb forms appear. Paste the sentence you saw it in. Save. |
| **Every day** | Open **Üben**. Cards are due or they are not; when the list empties, you are done. Ten new words a day, commonest first. |
| **When stuck on a rule** | **Grammatik** — six written topics, plus drills generated from words you have actually saved. |
| **Once a week** | Run `/coach` (below), then take the exam in **Prüfung**. |

Every word gets two cards: **DE→EN** first (recognise the meaning, grade yourself), and
**EN→DE** three days later (type the German — nouns must include the right article).

## Running the coach

The app never calls a language model. It queues requests, and you fulfil them by running
Claude Code in this folder:

```bash
cd wortschatz
claude
/coach
```

That one command researches words the dictionary did not know, writes any grammar topic
you requested, proposes ten new words tied to your actual data, and builds the week's
exam. It is covered by your Claude subscription — no API key exists anywhere in this
repo.

To automate it, `claude -p "/coach"` runs non-interactively, so a weekly cron entry works:

```cron
0 9 * * 1 cd ~/wortschatz && claude -p "/coach"
```

## Zero-cost architecture

| Concern | How | Cost |
|---|---|---|
| Hosting | GitHub Pages, static `dist/` | free |
| Dictionary | 69,264 entries bundled as sharded JSON | free |
| Local storage | IndexedDB via Dexie | free |
| Scheduling | `ts-fsrs` in the browser | free |
| Pronunciation | Web Speech API, the device's own voices | free |
| Sync | Supabase free tier | free |
| AI | Claude Code `/coach` on your subscription | already paid |

**Local-first.** Everything works offline — lookup, capture, review, exercises. Supabase
mirrors your data so phone and laptop agree; it is never required for daily use. Signed
out, the app is fully functional and your words simply stay on the device.

## Install it

- **iPhone** — open the link in **Safari** → Share → **Add to Home Screen**.
  For capture from the share sheet, see [docs/ios-shortcut.md](docs/ios-shortcut.md).
- **Android** — open in Chrome → **Install app**. Sharing selected text into Wortschatz
  works natively via the manifest's share target.
- **Desktop** — install icon in the address bar.

## Development

```bash
npm install
npm run dev        # dev server
npm run build      # production build into dist/
npm run typecheck
npm run sim        # scheduler simulation: 30 days of reviews, article grading
npm run icons      # regenerate the icon set
npm run dict       # rebuild the dictionary (streams ~1 GB, takes a few minutes)
node scripts/e2e.mjs [url]    # browser acceptance suite (needs a preview server)
node scripts/shots.mjs [url]  # screenshots at 390px and 1280px
```

Pushing to `main` builds and deploys to GitHub Pages automatically.

### Sync setup

1. Create a free project at [supabase.com](https://supabase.com) (EU region)
2. Copy `.env.example` to `.env` and fill in the three values from
   Project Settings → API
3. Paste `supabase/migrations/0001_init.sql` into the Supabase SQL editor and run it
4. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as repository secrets so the
   deployed build can sync too
5. Open the app, click the sync dot in the header, and sign in by email

`SUPABASE_SERVICE_ROLE_KEY` is used **only** by `/coach`. It has no `VITE_` prefix
precisely so that Vite cannot bundle it into the client.

## Layout

```
src/
  types.ts          the data model — shared by Dexie, Postgres and /coach
  db/               Dexie store, capture, review queue, curated-topic seeding
  lib/              dictionary, scheduler, sync, TTS, router, exercise generator
  screens/          Wörter · Üben · Grammatik · Prüfung · Coach · Über
  ui/               shell, capture sheet, exercise runner, markdown, sync badge
scripts/            dictionary pipeline, icon generator, simulation, e2e, screenshots
data/grammar/       the six curated topics
supabase/           SQL migration
.claude/commands/   the /coach command
```

Judgement calls and deviations from the original spec are recorded in
[DECISIONS.md](DECISIONS.md).

## Attribution and licences

- Dictionary data extracted from the [English Wiktionary](https://en.wiktionary.org/)
  via [kaikki.org](https://kaikki.org/dictionary/German/) (Wiktextract), licensed
  [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The generated shards
  in `public/dict/` are a derivative work and carry the same licence.
- Frequency ranks from
  [hermitdave/FrequencyWords](https://github.com/hermitdave/FrequencyWords)
  (OpenSubtitles-derived), CC BY-SA 4.0.
- Scheduling by [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) (MIT),
  implementing [FSRS](https://github.com/open-spaced-repetition).

Application code is MIT. The bundled dictionary is CC BY-SA 4.0 as above.
