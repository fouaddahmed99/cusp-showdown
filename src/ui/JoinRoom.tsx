import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { multiplayerStatus } from "@/multiplayer/config";
import { toMultiplayerError } from "@/multiplayer/client";
import {
  fetchCurrentRound,
  fetchPlayers,
  fetchRoom,
  fetchTeams,
  forgetPlayer,
  joinRoom,
  playerApi,
  storedPlayer,
  subscribeToRoom,
  type PlayerRow,
  type RoomRow,
  type RoundRow,
  type TeamRow,
} from "@/multiplayer/room";
import { rank } from "@/game/scoring";
import { sfx } from "@/audio/sfx";
import { MultiplayerSetup } from "./MultiplayerSetup";
import { Badge, Button, Panel, Spinner } from "./primitives";

interface JoinRoomProps {
  initialCode?: string | undefined;
  onExit: () => void;
}

export function JoinRoom({ initialCode, onExit }: JoinRoomProps) {
  const status = multiplayerStatus();
  if (!status.configured) return <MultiplayerSetup onExit={onExit} />;
  return <PlayerClient initialCode={initialCode} onExit={onExit} />;
}

interface Session {
  code: string;
  token: string;
  playerId: string;
  displayName: string;
}

function PlayerClient({ initialCode, onExit }: JoinRoomProps) {
  const stored = storedPlayer();
  const [session, setSession] = useState<Session | null>(() =>
    stored && (!initialCode || stored.code === initialCode) ? stored : null,
  );
  const [code, setCode] = useState(initialCode ?? stored?.code ?? "");
  const [name, setName] = useState(stored?.displayName ?? "");
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const join = useCallback(
    async (event?: React.FormEvent) => {
      event?.preventDefault();
      setJoining(true);
      setError(null);
      try {
        const joined = await joinRoom(code, name);
        setSession({
          code: joined.code,
          token: joined.playerToken,
          playerId: joined.playerId,
          displayName: joined.displayName,
        });
      } catch (err) {
        setError(toMultiplayerError(err).message);
      } finally {
        setJoining(false);
      }
    },
    [code, name],
  );

  if (!session) {
    return (
      <div className="mx-auto max-w-md">
        <Panel className="p-6 sm:p-8">
          <h1 className="display text-3xl">Join a game</h1>
          <p className="mt-2 text-ink-200">No account needed. Your host has the code.</p>

          <form className="mt-6 space-y-4" onSubmit={join}>
            <label className="block">
              <span className="text-sm font-semibold text-ink-200">Room code</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
                placeholder="ABCDE"
                autoComplete="off"
                autoCapitalize="characters"
                inputMode="text"
                className="cusp cusp-sm mt-1.5 w-full border border-[rgba(154,166,204,0.25)] bg-navy-800 px-4 py-3 text-center text-3xl tracking-[0.3em] outline-none focus:border-electric"
              />
            </label>

            <label className="block">
              <span className="text-sm font-semibold text-ink-200">Your name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, 24))}
                placeholder="Alex R."
                autoComplete="off"
                className="cusp cusp-sm mt-1.5 w-full border border-[rgba(154,166,204,0.25)] bg-navy-800 px-4 py-3 text-lg outline-none focus:border-electric"
              />
            </label>

            {error ? <p className="text-sm text-wrong">{error}</p> : null}

            <Button
              tone="primary"
              size="lg"
              type="submit"
              disabled={joining || code.trim().length < 4 || !name.trim()}
              className="w-full"
            >
              {joining ? "Joining…" : "Join the game"}
            </Button>
            <Button tone="ghost" onClick={onExit} className="w-full" type="button">
              Back
            </Button>
          </form>
        </Panel>
      </div>
    );
  }

  return <PlayerBoard session={session} onLeave={() => {
    forgetPlayer();
    setSession(null);
  }} onExit={onExit} />;
}

type Connection = "connected" | "connecting" | "offline";

function PlayerBoard({
  session,
  onLeave,
  onExit,
}: {
  session: Session;
  onLeave: () => void;
  onExit: () => void;
}) {
  const [room, setRoom] = useState<RoomRow | null>(null);
  const [round, setRound] = useState<RoundRow | null>(null);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [buzzing, setBuzzing] = useState(false);
  const [wager, setWager] = useState("");
  const [wagerLocked, setWagerLocked] = useState(false);
  const api = useMemo(() => playerApi(session.token), [session.token]);
  const lastRoundRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const roomRow = await fetchRoom(session.code);
      if (!roomRow) {
        setError("This room has closed.");
        setConnection("offline");
        return;
      }
      setRoom(roomRow);
      const [currentRound, playerRows, teamRows] = await Promise.all([
        fetchCurrentRound(roomRow.id),
        fetchPlayers(roomRow.id),
        fetchTeams(roomRow.id),
      ]);
      setRound(currentRound);
      setPlayers(playerRows);
      setTeams(teamRows);
      setConnection("connected");
      setError(null);
    } catch (err) {
      setError(toMultiplayerError(err).message);
      setConnection("offline");
    }
  }, [session.code]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!room) return;
    return subscribeToRoom(room.id, () => void refresh(), setConnection);
  }, [refresh, room?.id]);

  // Heartbeat so the host can see who is still in the room.
  useEffect(() => {
    const id = setInterval(() => void api.heartbeat().catch(() => undefined), 20_000);
    return () => clearInterval(id);
  }, [api]);

  // Slow poll as a backstop for a dropped Realtime message.
  useEffect(() => {
    const id = setInterval(() => void refresh(), 7000);
    return () => clearInterval(id);
  }, [refresh]);

  // A new round resets the local wager draft.
  useEffect(() => {
    if (!round || lastRoundRef.current === round.id) return;
    lastRoundRef.current = round.id;
    setWager("");
    setWagerLocked(false);
  }, [round]);

  const me = players.find((p) => p.id === session.playerId);
  const myTeam = me?.team_id ? teams.find((t) => t.id === me.team_id) : undefined;
  const iWon = round?.winner_player_id === session.playerId;
  const someoneElseWon = Boolean(round?.winner_player_id) && !iWon;

  const buzz = useCallback(async () => {
    if (!round || !round.buzz_open || buzzing) return;
    setBuzzing(true);
    sfx.play("buzz");
    try {
      await api.buzz(round.id);
      await refresh();
    } catch (err) {
      setError(toMultiplayerError(err).message);
    } finally {
      setBuzzing(false);
    }
  }, [api, buzzing, refresh, round]);

  const standings = rank(
    teams.length
      ? teams.map((t) => ({ id: t.id, name: t.name, score: t.score }))
      : players.map((p) => ({ id: p.id, name: p.display_name, score: p.score })),
  );

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Panel className="flex flex-wrap items-center gap-4 p-4">
        <div>
          <p className="text-xs text-ink-300">You</p>
          <p className="font-semibold">{session.displayName}</p>
        </div>
        <div>
          <p className="text-xs text-ink-300">{myTeam ? myTeam.name : "Your score"}</p>
          <p className="display tnum text-2xl text-gold">
            {(myTeam?.score ?? me?.score ?? 0).toLocaleString()}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Badge tone={connection === "connected" ? "good" : connection === "connecting" ? "neutral" : "bad"}>
            {connection === "connected" ? "Live" : connection === "connecting" ? "Connecting" : "Reconnecting"}
          </Badge>
          <Badge tone="neutral">{session.code}</Badge>
        </div>
      </Panel>

      {error ? <Panel className="border-wrong/40 p-4 text-sm text-wrong">{error}</Panel> : null}

      {!round ? (
        <Panel className="p-6 text-center">
          <h1 className="display text-2xl">You're in</h1>
          <p className="mt-2 text-ink-200">
            {room?.status === "lobby"
              ? "Waiting for the host to start the game."
              : "Waiting for the next question."}
          </p>
          <div className="mt-4 flex justify-center">
            <Spinner label="Standing by" />
          </div>
        </Panel>
      ) : (
        <>
          <Panel className="p-5">
            <div className="flex items-center gap-3">
              <span className="display tnum text-2xl text-gold">{round.points}</span>
              <p className="min-w-0 truncate text-sm text-ink-300">{round.category_name}</p>
              {round.question.origin === "demo-sample" ? <Badge tone="demo">Demo</Badge> : null}
            </div>

            {round.question.vignette ? (
              <p className="mt-4 text-base leading-relaxed text-ink-200">{round.question.vignette}</p>
            ) : null}
            <h1 className="mt-3 text-balance text-xl leading-snug sm:text-2xl">{round.question.stem}</h1>

            <ul className="mt-4 space-y-2">
              {round.question.options.map((option) => {
                const isKey = round.answer?.key === option.id;
                return (
                  <li
                    key={option.id}
                    className={`cusp flex items-start gap-3 border px-3 py-2.5 ${
                      isKey ? "border-correct bg-[rgba(52,211,153,0.12)]" : "border-[rgba(154,166,204,0.18)]"
                    }`}
                  >
                    <span className="display shrink-0 text-ink-300">{option.id}</span>
                    <span>{option.text}</span>
                  </li>
                );
              })}
            </ul>

            {round.answer ? (
              <div className="mt-4 border-t border-[rgba(154,166,204,0.18)] pt-4">
                <p className="text-sm">
                  Key <span className="font-semibold text-correct">{round.answer.key}</span>
                </p>
                <div className="mt-2 space-y-2 text-sm text-ink-200">
                  {round.answer.explanation.map((sentence, i) => (
                    <p key={i}>{sentence.text}</p>
                  ))}
                </div>
                {round.answer.sources?.length ? (
                  <ul className="mt-3 space-y-1 text-xs text-ink-300">
                    {round.answer.sources.map((s) => (
                      <li key={s.id}>
                        <a href={s.url} target="_blank" rel="noreferrer" className="text-electric hover:underline">
                          {s.title}
                        </a>{" "}
                        — {s.organization}, {s.year}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </Panel>

          {round.is_final ? (
            <Panel className="p-5">
              <h2 className="text-lg text-gold">Final challenge</h2>
              <p className="mt-1 text-sm text-ink-300">
                Wager up to {Math.max(me?.score ?? 0, 1000).toLocaleString()}. Once locked, it cannot
                change.
              </p>
              <div className="mt-3 flex gap-2">
                <input
                  type="number"
                  min={0}
                  value={wager}
                  disabled={wagerLocked}
                  onChange={(e) => setWager(e.target.value)}
                  onBlur={() => void api.setWager(round.id, Number(wager || 0)).catch(() => undefined)}
                  className="cusp cusp-sm min-w-0 flex-1 border border-[rgba(154,166,204,0.25)] bg-navy-800 px-3 py-2 text-xl tabular-nums outline-none focus:border-electric disabled:opacity-50"
                />
                <Button
                  tone="gold"
                  disabled={wagerLocked}
                  onClick={() =>
                    void api
                      .setWager(round.id, Number(wager || 0))
                      .then(() => api.lockWager(round.id))
                      .then(() => setWagerLocked(true))
                      .catch((err) => setError(toMultiplayerError(err).message))
                  }
                >
                  {wagerLocked ? "Locked" : "Lock it in"}
                </Button>
              </div>
            </Panel>
          ) : (
            <BuzzButton
              open={round.buzz_open}
              iWon={iWon}
              someoneElseWon={someoneElseWon}
              winnerName={
                someoneElseWon
                  ? players.find((p) => p.id === round.winner_player_id)?.display_name ?? "Another player"
                  : null
              }
              busy={buzzing}
              onBuzz={() => void buzz()}
            />
          )}
        </>
      )}

      <Panel className="p-4">
        <h2 className="text-sm font-semibold text-ink-200">Scores</h2>
        <ul className="mt-2 space-y-1.5 text-sm">
          {standings.map((entry) => (
            <li key={entry.id} className="flex items-center gap-3">
              <span className="display tnum w-5 text-ink-300">{entry.place}</span>
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              <span className="tnum text-gold">{entry.score.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      </Panel>

      <div className="flex gap-3">
        <Button tone="ghost" size="sm" onClick={onLeave}>
          Leave the room
        </Button>
        <Button tone="ghost" size="sm" onClick={onExit}>
          Back to the start
        </Button>
      </div>
    </div>
  );
}

/** The big target. Nothing else on a phone screen competes with it. */
function BuzzButton({
  open,
  iWon,
  someoneElseWon,
  winnerName,
  busy,
  onBuzz,
}: {
  open: boolean;
  iWon: boolean;
  someoneElseWon: boolean;
  winnerName: string | null;
  busy: boolean;
  onBuzz: () => void;
}) {
  if (iWon) {
    return (
      <div className="cusp buzz-flash flex min-h-40 flex-col items-center justify-center bg-gold text-abyss">
        <span className="display text-4xl">You buzzed first</span>
        <span className="mt-1 text-sm font-semibold">Answer out loud — the host is scoring it</span>
      </div>
    );
  }

  if (someoneElseWon) {
    return (
      <div className="cusp flex min-h-40 flex-col items-center justify-center border border-[rgba(154,166,204,0.2)] bg-navy-800">
        <span className="display text-2xl text-ink-200">{winnerName} got in first</span>
        <span className="mt-1 text-sm text-ink-300">Buzzers are locked until the host reopens them</span>
      </div>
    );
  }

  return (
    <button
      onClick={onBuzz}
      disabled={!open || busy}
      className={`cusp flex min-h-40 w-full flex-col items-center justify-center transition-colors ${
        open
          ? "bg-electric text-abyss active:bg-[color-mix(in_srgb,var(--color-electric)_80%,black)]"
          : "border border-[rgba(154,166,204,0.2)] bg-navy-800 text-ink-300"
      }`}
    >
      <span className="display text-5xl">BUZZ</span>
      <span className="mt-1 text-sm font-semibold">
        {open ? "Buzzers are open" : "Wait for the host to open the buzzers"}
      </span>
    </button>
  );
}
