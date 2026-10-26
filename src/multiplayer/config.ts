/**
 * Live multiplayer runs on Supabase (Postgres + Realtime), which has a free
 * tier and needs no account from the people playing: a player types a room
 * code and a display name, nothing else.
 *
 * Two build-time values turn it on. Both are public by design — the anon key is
 * meant to ship to a browser, and every write it can reach goes through a
 * `security definer` function that checks a room token (see supabase/schema.sql).
 *
 *   VITE_SUPABASE_URL=https://<project>.supabase.co
 *   VITE_SUPABASE_ANON_KEY=<anon key>
 *
 * With them absent, hosting and joining are disabled with setup instructions,
 * and solo play is unaffected. Nothing is simulated locally and no screen
 * pretends a room exists.
 */
export interface MultiplayerStatus {
  configured: boolean;
  url: string | null;
  anonKey: string | null;
  reason: string | null;
}

export function multiplayerStatus(): MultiplayerStatus {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || null;
  const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || null;

  if (!url && !anonKey) {
    return {
      configured: false,
      url: null,
      anonKey: null,
      reason: "No Supabase project is configured for this build.",
    };
  }
  if (!url || !anonKey) {
    return {
      configured: false,
      url,
      anonKey,
      reason: `Half-configured: ${url ? "VITE_SUPABASE_ANON_KEY" : "VITE_SUPABASE_URL"} is missing.`,
    };
  }
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(url)) {
    return {
      configured: false,
      url,
      anonKey,
      reason: `VITE_SUPABASE_URL does not look like a Supabase project URL: ${url}`,
    };
  }
  return { configured: true, url, anonKey, reason: null };
}

/** Rooms self-expire so a free-tier database does not fill up with old games. */
export const ROOM_TTL_HOURS = 8;

/** Buzz attempts allowed per player in the window below. */
export const BUZZ_RATE_LIMIT = { attempts: 6, windowMs: 5_000 };

/** Join attempts allowed per device before the client backs off. */
export const JOIN_RATE_LIMIT = { attempts: 8, windowMs: 30_000 };
