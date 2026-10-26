import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { multiplayerStatus } from "./config";

/**
 * One Supabase client per page. Returns null when multiplayer is not
 * configured, which every caller is expected to handle by showing the setup
 * instructions rather than by pretending a room exists.
 */
let cached: SupabaseClient | null = null;
let cachedFor: string | null = null;

export function getClient(): SupabaseClient | null {
  const status = multiplayerStatus();
  if (!status.configured || !status.url || !status.anonKey) return null;
  if (cached && cachedFor === status.url) return cached;
  cached = createClient(status.url, status.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 20 } },
  });
  cachedFor = status.url;
  return cached;
}

export class MultiplayerError extends Error {
  constructor(
    message: string,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = "MultiplayerError";
  }
}

/** Turns a Postgres error into something a resident can act on. */
const MESSAGES: Record<string, string> = {
  ROOM_NOT_FOUND: "No open room has that code. Check it with your host.",
  ROOM_CLOSED: "That game has already finished.",
  ROOM_FULL: "That room is full.",
  LATE_JOIN_CLOSED: "The host has closed late joining for this game.",
  NAME_TAKEN: "Someone in the room is already using that name. Pick another.",
  EMPTY_NAME: "Enter a display name first.",
  NOT_HOST: "Only the host can do that.",
  BUZZ_CLOSED: "Buzzing is not open yet.",
  RATE_LIMITED: "Too many buzz attempts — wait a second and try again.",
  NO_BUZZ_WINNER: "Nobody has buzzed in yet.",
  ITEM_ALREADY_USED: "That question has already been played in this room.",
  KEY_IN_QUESTION: "Refused: the question payload must not carry the answer key.",
  WAGER_LOCKED: "Your wager is already locked in.",
  NO_WAGER: "Set a wager before locking it in.",
  UNKNOWN_PLAYER: "This device is not in the room any more. Rejoin with the room code.",
  WEAK_TOKEN: "This browser could not generate a secure token. Try reloading.",
};

export function toMultiplayerError(error: unknown): MultiplayerError {
  if (error instanceof MultiplayerError) return error;
  const raw =
    typeof error === "object" && error && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error);
  for (const [code, message] of Object.entries(MESSAGES)) {
    if (raw.includes(code)) return new MultiplayerError(message, code);
  }
  if (/Failed to fetch|NetworkError|fetch failed/i.test(raw)) {
    return new MultiplayerError(
      "Lost contact with the game server. Check the connection and try again.",
      "NETWORK",
    );
  }
  return new MultiplayerError(raw, null);
}

/** A 32-byte random token, used as the host or player credential. */
export function newToken(): string {
  const bytes = new Uint8Array(24);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
