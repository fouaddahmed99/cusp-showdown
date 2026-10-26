import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { getClient, newToken, toMultiplayerError } from "./client";

export interface RoomRow {
  id: string;
  code: string;
  status: "lobby" | "playing" | "final" | "done";
  allow_late_join: boolean;
  board: unknown;
  content_version: string | null;
  expires_at: string;
  updated_at: string;
}

export interface PlayerRow {
  id: string;
  room_id: string;
  team_id: string | null;
  display_name: string;
  score: number;
  connected: boolean;
  last_seen: string;
}

export interface TeamRow {
  id: string;
  room_id: string;
  name: string;
  score: number;
}

/** The question payload players receive. It never contains the key. */
export interface RoundQuestionPayload {
  stem: string;
  vignette?: string;
  options: { id: string; text: string }[];
  categoryName: string;
  cognitiveLevel: string;
  origin: string;
}

/** The answer payload, written only when the host reveals. */
export interface RoundAnswerPayload {
  key: string;
  explanation: { text: string; cites: { sourceId: string; page: number | null; section: string }[] }[];
  sources?: {
    id: string;
    title: string;
    organization: string;
    year: number;
    url: string;
    licenseLabel: string;
  }[];
}

export interface RoundRow {
  id: string;
  room_id: string;
  seq: number;
  category_id: string;
  category_name: string;
  points: number;
  question: RoundQuestionPayload;
  answer: RoundAnswerPayload | null;
  state: "open" | "buzzing" | "locked" | "revealed" | "retired";
  buzz_open: boolean;
  buzz_epoch: number;
  winner_player_id: string | null;
  is_final: boolean;
  revealed_at: string | null;
}

export interface BuzzWinnerRow {
  round_id: string;
  epoch: number;
  player_id: string;
  won_at: string;
}

export interface WagerRow {
  round_id: string;
  player_id: string;
  amount: number;
  locked: boolean;
}

const HOST_KEY = "cusp-showdown:host:v1";
const PLAYER_KEY = "cusp-showdown:player:v1";

interface StoredHost {
  code: string;
  token: string;
  roomId: string;
}
interface StoredPlayer {
  code: string;
  token: string;
  playerId: string;
  displayName: string;
}

function readStored<T>(key: string): T | null {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeStored(key: string, value: unknown): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // Session recovery is a convenience; losing it only means retyping a code.
  }
}

export function storedHost(): StoredHost | null {
  return readStored<StoredHost>(HOST_KEY);
}
export function storedPlayer(): StoredPlayer | null {
  return readStored<StoredPlayer>(PLAYER_KEY);
}
export function forgetHost(): void {
  try {
    globalThis.localStorage?.removeItem(HOST_KEY);
  } catch {
    /* ignore */
  }
}
export function forgetPlayer(): void {
  try {
    globalThis.localStorage?.removeItem(PLAYER_KEY);
  } catch {
    /* ignore */
  }
}

function requireClient(): SupabaseClient {
  const client = getClient();
  if (!client) {
    throw new Error(
      "Live multiplayer is not configured for this build. See the README for the Supabase setup.",
    );
  }
  return client;
}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const client = requireClient();
  const { data, error } = await client.rpc(name, args);
  if (error) throw toMultiplayerError(error);
  return data as T;
}

// -------------------------------------------------------------------- host API

export interface CreatedRoom {
  roomId: string;
  code: string;
  hostToken: string;
  expiresAt: string;
}

export async function createRoom(options: {
  board: unknown;
  allowLateJoin: boolean;
  contentVersion: string;
  ttlHours?: number;
}): Promise<CreatedRoom> {
  const hostToken = newToken();
  const rows = await rpc<{ room_id: string; code: string; expires_at: string }[]>("create_room", {
    p_host_token: hostToken,
    p_board: options.board,
    p_allow_late_join: options.allowLateJoin,
    p_content_version: options.contentVersion,
    p_ttl_hours: options.ttlHours ?? 8,
  });
  const row = rows?.[0];
  if (!row) throw new Error("The server did not return a room.");
  const created = {
    roomId: row.room_id,
    code: row.code,
    hostToken,
    expiresAt: row.expires_at,
  };
  writeStored(HOST_KEY, { code: created.code, token: hostToken, roomId: created.roomId });
  // Opportunistic housekeeping so old rooms do not accumulate.
  void rpc("cleanup_expired_rooms", {}).catch(() => undefined);
  return created;
}

export const hostApi = (code: string, token: string) => ({
  createTeam: (name: string) =>
    rpc<string>("create_team", { p_code: code, p_host_token: token, p_name: name }),
  assignTeam: (playerId: string, teamId: string | null) =>
    rpc<void>("assign_player_team", {
      p_code: code,
      p_host_token: token,
      p_player_id: playerId,
      p_team_id: teamId,
    }),
  setStatus: (status: RoomRow["status"]) =>
    rpc<void>("set_room_status", { p_code: code, p_host_token: token, p_status: status }),
  setLateJoin: (allow: boolean) =>
    rpc<void>("set_late_join", { p_code: code, p_host_token: token, p_allow: allow }),
  updateBoard: (board: unknown) =>
    rpc<void>("update_board", { p_code: code, p_host_token: token, p_board: board }),
  openRound: (input: {
    categoryId: string;
    categoryName: string;
    points: number;
    itemId: string;
    question: RoundQuestionPayload;
    isFinal?: boolean;
  }) =>
    rpc<string>("open_round", {
      p_code: code,
      p_host_token: token,
      p_category_id: input.categoryId,
      p_category_name: input.categoryName,
      p_points: input.points,
      p_item_id: input.itemId,
      p_question: input.question,
      p_is_final: input.isFinal ?? false,
    }),
  setBuzzing: (roundId: string, open: boolean) =>
    rpc<number>("set_buzzing", {
      p_code: code,
      p_host_token: token,
      p_round_id: roundId,
      p_open: open,
    }),
  judge: (roundId: string, correct: boolean, opts?: { penalize?: boolean; reopen?: boolean }) =>
    rpc<{ delta: number; scored_player: string; reopened_epoch: number | null }[]>("judge_round", {
      p_code: code,
      p_host_token: token,
      p_round_id: roundId,
      p_correct: correct,
      p_penalize_incorrect: opts?.penalize ?? true,
      p_reopen_on_incorrect: opts?.reopen ?? true,
    }),
  reveal: (roundId: string, answer: RoundAnswerPayload) =>
    rpc<void>("reveal_round", {
      p_code: code,
      p_host_token: token,
      p_round_id: roundId,
      p_answer: answer,
    }),
  retire: (roundId: string) =>
    rpc<void>("retire_round", { p_code: code, p_host_token: token, p_round_id: roundId }),
  adjust: (target: { playerId?: string; teamId?: string }, delta: number) =>
    rpc<void>("adjust_score", {
      p_code: code,
      p_host_token: token,
      p_player_id: target.playerId ?? null,
      p_team_id: target.teamId ?? null,
      p_delta: delta,
    }),
  kick: (playerId: string) =>
    rpc<void>("kick_player", { p_code: code, p_host_token: token, p_player_id: playerId }),
  settleFinal: (roundId: string, correctPlayerIds: string[]) =>
    rpc<number>("settle_final", {
      p_code: code,
      p_host_token: token,
      p_round_id: roundId,
      p_correct_player_ids: correctPlayerIds,
    }),
  close: () => rpc<void>("close_room", { p_code: code, p_host_token: token }),
});

// ------------------------------------------------------------------ player API

export interface JoinedRoom {
  playerId: string;
  roomId: string;
  code: string;
  playerToken: string;
  displayName: string;
  status: RoomRow["status"];
  teamId: string | null;
}

/**
 * Joins, or rejoins. The token in localStorage is what preserves identity and
 * score across a refresh, a locked phone, or a dropped connection.
 */
export async function joinRoom(code: string, displayName: string): Promise<JoinedRoom> {
  const normalized = code.trim().toUpperCase();
  const existing = storedPlayer();
  const token =
    existing && existing.code === normalized ? existing.token : newToken();

  const rows = await rpc<
    { player_id: string; room_id: string; status: RoomRow["status"]; team_id: string | null }[]
  >("join_room", {
    p_code: normalized,
    p_display_name: displayName,
    p_player_token: token,
  });
  const row = rows?.[0];
  if (!row) throw new Error("The server did not return a player.");

  const joined: JoinedRoom = {
    playerId: row.player_id,
    roomId: row.room_id,
    code: normalized,
    playerToken: token,
    displayName: displayName.trim().slice(0, 24),
    status: row.status,
    teamId: row.team_id,
  };
  writeStored(PLAYER_KEY, {
    code: joined.code,
    token,
    playerId: joined.playerId,
    displayName: joined.displayName,
  });
  return joined;
}

export const playerApi = (token: string) => ({
  buzz: async (roundId: string) => {
    const rows = await rpc<{ won: boolean; winner_player_id: string; epoch: number }[]>(
      "claim_buzz",
      { p_player_token: token, p_round_id: roundId },
    );
    const row = rows?.[0];
    return { won: Boolean(row?.won), winnerPlayerId: row?.winner_player_id ?? null };
  },
  setWager: (roundId: string, amount: number) =>
    rpc<number>("set_wager", { p_player_token: token, p_round_id: roundId, p_amount: amount }),
  lockWager: (roundId: string) =>
    rpc<number>("lock_wager", { p_player_token: token, p_round_id: roundId }),
  heartbeat: () => rpc<void>("heartbeat", { p_player_token: token }),
});

// --------------------------------------------------------------------- reading

export async function fetchRoom(code: string): Promise<RoomRow | null> {
  const client = requireClient();
  const { data, error } = await client
    .from("rooms")
    .select("*")
    .eq("code", code.trim().toUpperCase())
    .maybeSingle();
  if (error) throw toMultiplayerError(error);
  return (data as RoomRow | null) ?? null;
}

export async function fetchPlayers(roomId: string): Promise<PlayerRow[]> {
  const client = requireClient();
  const { data, error } = await client
    .from("players")
    .select("*")
    .eq("room_id", roomId)
    .order("joined_at", { ascending: true });
  if (error) throw toMultiplayerError(error);
  return (data as PlayerRow[]) ?? [];
}

export async function fetchTeams(roomId: string): Promise<TeamRow[]> {
  const client = requireClient();
  const { data, error } = await client
    .from("teams")
    .select("*")
    .eq("room_id", roomId)
    .order("created_at", { ascending: true });
  if (error) throw toMultiplayerError(error);
  return (data as TeamRow[]) ?? [];
}

export async function fetchCurrentRound(roomId: string): Promise<RoundRow | null> {
  const client = requireClient();
  const { data, error } = await client
    .from("rounds")
    .select("*")
    .eq("room_id", roomId)
    .order("seq", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw toMultiplayerError(error);
  return (data as RoundRow | null) ?? null;
}

export async function fetchRounds(roomId: string): Promise<RoundRow[]> {
  const client = requireClient();
  const { data, error } = await client
    .from("rounds")
    .select("*")
    .eq("room_id", roomId)
    .order("seq", { ascending: true });
  if (error) throw toMultiplayerError(error);
  return (data as RoundRow[]) ?? [];
}

export async function fetchBuzzWinner(
  roundId: string,
  epoch: number,
): Promise<BuzzWinnerRow | null> {
  const client = requireClient();
  const { data, error } = await client
    .from("buzz_winners")
    .select("*")
    .eq("round_id", roundId)
    .eq("epoch", epoch)
    .maybeSingle();
  if (error) throw toMultiplayerError(error);
  return (data as BuzzWinnerRow | null) ?? null;
}

export async function fetchWagers(roundId: string): Promise<WagerRow[]> {
  const client = requireClient();
  const { data, error } = await client.from("wagers").select("*").eq("round_id", roundId);
  if (error) throw toMultiplayerError(error);
  return (data as WagerRow[]) ?? [];
}

/**
 * Subscribes to every table that drives the room. Realtime can drop messages
 * on a flaky connection, so callers also refetch on each event rather than
 * patching rows in place — the database stays the single source of truth.
 */
export function subscribeToRoom(
  roomId: string,
  onChange: (table: string) => void,
  onStatus?: (status: "connected" | "connecting" | "offline") => void,
): () => void {
  const client = getClient();
  if (!client) return () => undefined;

  const channel: RealtimeChannel = client.channel(`room:${roomId}`);
  for (const table of ["rooms", "rounds", "players", "teams", "buzz_winners", "wagers"]) {
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table },
      () => onChange(table),
    );
  }

  onStatus?.("connecting");
  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") onStatus?.("connected");
    else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
      onStatus?.("offline");
    }
  });

  return () => {
    void client.removeChannel(channel);
  };
}
