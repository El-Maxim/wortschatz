import { createClient, type SupabaseClient, type Session } from '@supabase/supabase-js'

/**
 * Supabase is a sync layer, never a dependency for daily use. If the env vars
 * are absent (a fork, a local build, the very first run) the app must still work
 * completely — so `client` is null and every sync call becomes a no-op.
 *
 * Only the anon key is ever bundled. It is safe to ship: RLS restricts every
 * row to its owner. The service-role key lives in .env for the /coach command
 * alone and deliberately carries no VITE_ prefix, so Vite cannot expose it.
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isConfigured = Boolean(url && anonKey && url.startsWith('http'))

export const client: SupabaseClient | null = isConfigured
  ? createClient(url!, anonKey!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null

export async function currentSession(): Promise<Session | null> {
  if (!client) return null
  const { data } = await client.auth.getSession()
  return data.session
}

/** Magic-link sign-in. The link returns to whatever page asked for it. */
export async function signIn(email: string): Promise<{ error: string | null }> {
  if (!client) return { error: 'Sync is not configured in this build.' }
  const { error } = await client.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: location.origin + import.meta.env.BASE_URL },
  })
  return { error: error?.message ?? null }
}

export async function signOut(): Promise<void> {
  await client?.auth.signOut()
}
