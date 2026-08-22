#!/usr/bin/env node
/**
 * Interactive .env writer.
 *
 *   node scripts/setup-env.mjs
 *
 * Prompts for the three Supabase values, validates their shape, and writes
 * `.env` (which is gitignored). Nothing is sent anywhere — the file stays on
 * this machine, and only the two VITE_ values are ever bundled into the app.
 */
import { createInterface } from 'node:readline/promises'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { stdin, stdout } from 'node:process'

const rl = createInterface({ input: stdin, output: stdout })

const bold = (s) => `\x1b[1m${s}\x1b[0m`
const dim = (s) => `\x1b[2m${s}\x1b[0m`
const red = (s) => `\x1b[31m${s}\x1b[0m`
const green = (s) => `\x1b[32m${s}\x1b[0m`

console.log(`
${bold('Wortschatz — Supabase setup')}

Open your project at ${bold('https://supabase.com/dashboard')} and go to
${bold('Project Settings')} (the gear, bottom left) → ${bold('API')}.

Leave a field blank to keep whatever is already in .env.
`)

if (existsSync('.env')) {
  console.log(dim('An .env already exists; blank answers keep the current values.\n'))
}

const existing = existsSync('.env')
  ? Object.fromEntries(
      readFileSync('.env', 'utf8')
        .split('\n')
        .filter(l => l.includes('=') && !l.trim().startsWith('#'))
        .map(l => {
          const i = l.indexOf('=')
          return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
        }),
    )
  : {}

async function ask(key, label, hint, validate) {
  for (;;) {
    const current = existing[key]
    if (current) console.log(dim(`  current: ${current.slice(0, 18)}…`))
    const answer = (await rl.question(`${bold(label)}\n${dim(hint)}\n> `)).trim()
    console.log()

    if (!answer && current) return current
    if (!answer) { console.log(red('  Required.\n')); continue }

    const problem = validate(answer)
    if (problem) { console.log(red(`  ${problem}\n`)); continue }
    return answer
  }
}

const url = await ask(
  'VITE_SUPABASE_URL',
  '1. Project URL',
  'Labelled "Project URL" or "URL". Looks like https://abcdefgh.supabase.co',
  (v) => {
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/?$/i.test(v)) {
      return 'Expected something like https://abcdefgh.supabase.co'
    }
    return null
  },
)

const anon = await ask(
  'VITE_SUPABASE_ANON_KEY',
  '2. Anon / publishable key  (safe to ship in the app)',
  'Labelled "anon public", "publishable", or under "Legacy API keys" → anon.\nStarts with sb_publishable_ or eyJ',
  (v) => {
    if (v.startsWith('sb_secret_') || v.startsWith('service_role')) {
      return 'That is the SECRET key — this field wants the anon/publishable one.'
    }
    if (!/^(sb_publishable_|eyJ)/.test(v)) {
      return 'Expected a key starting with sb_publishable_ or eyJ'
    }
    return null
  },
)

const service = await ask(
  'SUPABASE_SERVICE_ROLE_KEY',
  '3. Service role / secret key  (NEVER shipped — used only by /coach)',
  'Labelled "service_role secret", or "Secret keys" → reveal.\nStarts with sb_secret_ or eyJ. You may have to click "Reveal".',
  (v) => {
    if (v.startsWith('sb_publishable_')) {
      return 'That is the publishable key — this field wants the secret/service_role one.'
    }
    if (!/^(sb_secret_|eyJ)/.test(v)) {
      return 'Expected a key starting with sb_secret_ or eyJ'
    }
    if (v === anon) return 'This is the same as the anon key — they must differ.'
    return null
  },
)

writeFileSync('.env', `# Supabase credentials for Wortschatz.
# Gitignored — never commit this file.

# Bundled into the app. Safe: row level security restricts every row to its owner.
VITE_SUPABASE_URL=${url.replace(/\/$/, '')}
VITE_SUPABASE_ANON_KEY=${anon}

# Used ONLY by the /coach Claude Code command, never bundled into the app.
# Deliberately has no VITE_ prefix so Vite cannot expose it to the client.
SUPABASE_SERVICE_ROLE_KEY=${service}
`)

console.log(green('Wrote .env'))
console.log(`
Next: tell Claude Code you are done, and it will run the migration check and
verify sync end to end.
`)

rl.close()
