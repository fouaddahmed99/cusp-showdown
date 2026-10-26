import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildTaxonomyIndex,
  indexSources,
  toShowdownAnswer,
  toShowdownQuestion,
  type TaxonomyIndex,
} from "@/content/adapter";
import { generateBoard, isPlayable, suggestCategories, type BoardTile, type GeneratedBoard } from "@/content/board";
import type { ContentPack } from "@/content/store";
import type { ContentCatalog, ShowdownSource } from "@/content/types";
import { multiplayerStatus } from "@/multiplayer/config";
import {
  createRoom,
  fetchCurrentRound,
  fetchPlayers,
  fetchRoom,
  fetchRounds,
  fetchTeams,
  fetchWagers,
  forgetHost,
  hostApi,
  storedHost,
  subscribeToRoom,
  type PlayerRow,
  type RoundRow,
  type TeamRow,
  type WagerRow,
} from "@/multiplayer/room";
import { toMultiplayerError } from "@/multiplayer/client";
import { rank } from "@/game/scoring";
import { sfx } from "@/audio/sfx";
import { absoluteUrl } from "@/lib/base";
import { Board } from "./Board";
import { MultiplayerSetup } from "./MultiplayerSetup";
import { Badge, Button, ErrorNote, Panel, Spinner, Stat } from "./primitives";

interface HostRoomProps {
  pack: ContentPack;
  catalog: ContentCatalog;
  categories: string[];
  isDemo: boolean;
  onExit: () => void;
}

type Connection = "connected" | "connecting" | "offline";

export function HostRoom({ pack, catalog, categories, isDemo, onExit }: HostRoomProps) {
  const status = multiplayerStatus();
  if (!status.configured) return <MultiplayerSetup onExit={onExit} />;
  return <HostConsole pack={pack} catalog={catalog} categories={categories} isDemo={isDemo} onExit={onExit} />;
}

function HostConsole({ pack, catalog, categories, isDemo, onExit }: HostRoomProps) {
  const [session, setSession] = useState<{ code: string; token: string; roomId: string } | null>(
    () => storedHost(),
  );
  const [board, setBoard] = useState<GeneratedBoard | null>(null);
  const [room, setRoom] = useState<Awaited<ReturnType<typeof fetchRoom>>>(null);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [round, setRound] = useState<RoundRow | null>(null);
  const [playedItemIds, setPlayedItemIds] = useState<Set<string>>(new Set());
  const [wagers, setWagers] = useState<WagerRow[]>([]);
  const [sources, setSources] = useState<Map<string, ShowdownSource>>(new Map());
  const [taxonomy, setTaxonomy] = useState<TaxonomyIndex | null>(null);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [projector, setProjector] = useState(false);
  /** Item ids this host has opened, by round id, so reveals can be graded. */
  const openedItems = useRef(new Map<string, string>());

  const api = useMemo(
    () => (session ? hostApi(session.code, session.token) : null),
    [session],
  );

  // Content scaffolding.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const manifest = await pack.getManifest();
        const sourceList = await pack.getSources().catch(() => []);
        if (cancelled) return;
        setTaxonomy(buildTaxonomyIndex(manifest));
        setSources(indexSources(sourceList));
        const chosen = categories.length ? categories : suggestCategories(catalog, 6);
        const generated = generateBoard(catalog, { categories: chosen, seed: `host-${Date.now().toString(36)}` });
        if (!isPlayable(generated)) {
          setError(
            "None of the chosen categories have an approved question available, so there is no board to host.",
          );
          return;
        }
        setBoard(generated);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [catalog, categories, pack]);

  const refresh = useCallback(async () => {
    if (!session) return;
    try {
      const roomRow = await fetchRoom(session.code);
      if (!roomRow) {
        setError("This room has expired or been closed. Start a new one.");
        forgetHost();
        setSession(null);
        return;
      }
      setRoom(roomRow);
      const [playerRows, teamRows, currentRound, allRounds] = await Promise.all([
        fetchPlayers(roomRow.id),
        fetchTeams(roomRow.id),
        fetchCurrentRound(roomRow.id),
        fetchRounds(roomRow.id),
      ]);
      setPlayers(playerRows);
      setTeams(teamRows);
      setRound(currentRound);
      setPlayedItemIds(
        new Set(
          allRounds
            .map((r) => openedItems.current.get(r.id))
            .filter((id): id is string => Boolean(id)),
        ),
      );
      if (currentRound?.is_final) setWagers(await fetchWagers(currentRound.id));
      setConnection("connected");
    } catch (err) {
      setError(toMultiplayerError(err).message);
      setConnection("offline");
    }
  }, [session]);

  useEffect(() => {
    if (!session) return;
    void refresh();
  }, [refresh, session]);

  useEffect(() => {
    if (!room) return;
    const unsubscribe = subscribeToRoom(room.id, () => void refresh(), setConnection);
    return unsubscribe;
  }, [refresh, room?.id]);

  // A safety net: Realtime can miss a message, so poll slowly as well.
  useEffect(() => {
    if (!session) return;
    const id = setInterval(() => void refresh(), 6000);
    return () => clearInterval(id);
  }, [refresh, session]);

  const startRoom = useCallback(async () => {
    if (!board) return;
    setCreating(true);
    setError(null);
    try {
      const created = await createRoom({
        board: {
          columns: board.columns.map((c) => ({
            domainId: c.domainId,
            domainName: c.domainName,
            tiles: c.tiles.map((t) => ({ points: t.points, state: t.state })),
          })),
        },
        allowLateJoin: true,
        contentVersion: catalog.contentVersion,
      });
      setSession({ code: created.code, token: created.hostToken, roomId: created.roomId });
    } catch (err) {
      setError(toMultiplayerError(err).message);
    } finally {
      setCreating(false);
    }
  }, [board, catalog.contentVersion]);

  const openTile = useCallback(
    async (tile: BoardTile, domainId: string) => {
      if (!api || !board || !taxonomy || !tile.itemId || busy) return;
      setBusy(true);
      setError(null);
      try {
        const column = board.columns.find((c) => c.domainId === domainId);
        const question = toShowdownQuestion(await pack.getQuestion(tile.itemId), {
          origin: catalog.origin,
          contentVersion: catalog.contentVersion,
          taxonomy,
        });
        const roundId = await api.openRound({
          categoryId: domainId,
          categoryName: column?.domainName ?? domainId,
          points: tile.points,
          itemId: tile.itemId,
          // No key, no rationales: only what players are allowed to see.
          question: {
            stem: question.stem,
            ...(question.vignette ? { vignette: question.vignette } : {}),
            options: question.options.map((o) => ({ id: o.id, text: o.text })),
            categoryName: question.domainName,
            cognitiveLevel: question.cognitiveLevel,
            origin: question.origin,
          },
        });
        openedItems.current.set(roundId, tile.itemId);
        await api.setStatus("playing");
        sfx.play("tile-open");
        await refresh();
      } catch (err) {
        setError(toMultiplayerError(err).message);
      } finally {
        setBusy(false);
      }
    },
    [api, board, busy, catalog.contentVersion, catalog.origin, pack, refresh, taxonomy],
  );

  const toggleBuzzing = useCallback(async () => {
    if (!api || !round) return;
    setBusy(true);
    try {
      await api.setBuzzing(round.id, !round.buzz_open);
      await refresh();
    } catch (err) {
      setError(toMultiplayerError(err).message);
    } finally {
      setBusy(false);
    }
  }, [api, refresh, round]);

  const judge = useCallback(
    async (correct: boolean) => {
      if (!api || !round) return;
      setBusy(true);
      try {
        await api.judge(round.id, correct, { penalize: true, reopen: !correct });
        sfx.play(correct ? "correct" : "incorrect");
        await refresh();
      } catch (err) {
        setError(toMultiplayerError(err).message);
      } finally {
        setBusy(false);
      }
    },
    [api, refresh, round],
  );

  const reveal = useCallback(async () => {
    if (!api || !round) return;
    const itemId = openedItems.current.get(round.id);
    if (!itemId) {
      setError(
        "This round was opened by a different device, so this console cannot look up its answer. " +
          "Reveal it from the device that opened it, or retire the question.",
      );
      return;
    }
    setBusy(true);
    try {
      const answer = toShowdownAnswer(await pack.getAnswer(itemId));
      const citedSources = [
        ...new Set(answer.explanation.flatMap((s) => s.cites.map((c) => c.sourceId))),
      ]
        .map((id) => sources.get(id))
        .filter((s): s is ShowdownSource => Boolean(s))
        .map((s) => ({
          id: s.id,
          title: s.title,
          organization: s.organization,
          year: s.year,
          url: s.url,
          licenseLabel: s.licenseLabel,
        }));
      await api.reveal(round.id, {
        key: answer.key,
        explanation: answer.explanation,
        sources: citedSources,
      });
      await refresh();
    } catch (err) {
      setError(toMultiplayerError(err).message);
    } finally {
      setBusy(false);
    }
  }, [api, pack, refresh, round, sources]);

  const backToBoard = useCallback(async () => {
    if (!api || !round) return;
    setBusy(true);
    try {
      if (round.buzz_open) await api.setBuzzing(round.id, false);
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [api, refresh, round]);

  // Keyboard shortcuts, so a host can run the room without hunting for buttons.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      const key = event.key.toLowerCase();
      if (key === "b" || event.code === "Space") {
        event.preventDefault();
        void toggleBuzzing();
      } else if (key === "y") void judge(true);
      else if (key === "n") void judge(false);
      else if (key === "r") void reveal();
      else if (key === "p") setProjector((p) => !p);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [judge, reveal, toggleBuzzing]);

  const winner = round?.winner_player_id
    ? players.find((p) => p.id === round.winner_player_id)
    : undefined;

  if (error && !session) {
    return (
      <ErrorNote
        title="This room could not be opened"
        detail={error}
        action={
          <div className="flex gap-3">
            <Button tone="primary" onClick={() => void startRoom()}>
              Try again
            </Button>
            <Button tone="ghost" onClick={onExit}>
              Back to the start
            </Button>
          </div>
        }
      />
    );
  }

  if (!session) {
    return (
      <div className="mx-auto max-w-2xl space-y-5">
        <Panel className="p-6 sm:p-8">
          <h1 className="display text-3xl">Host a game</h1>
          <p className="mt-3 text-ink-200">
            A room code appears for the residents to join from their phones. You keep the board, the
            timer, the buzzer and the scoring on this device.
          </p>
          {board ? (
            <p className="mt-4 text-sm text-ink-300">
              Board ready: {board.filledTiles} of {board.requestedTiles} tiles filled across{" "}
              {board.columns.length} categories
              {isDemo ? ", running on labelled demo content" : ""}.
            </p>
          ) : (
            <div className="mt-4">
              <Spinner label="Building the board…" />
            </div>
          )}
          <div className="mt-6 flex gap-3">
            <Button tone="gold" size="lg" disabled={!board || creating} onClick={() => void startRoom()}>
              {creating ? "Opening the room…" : "Open a room"}
            </Button>
            <Button tone="ghost" onClick={onExit}>
              Back
            </Button>
          </div>
        </Panel>
      </div>
    );
  }

  const joinLink = absoluteUrl(`#/join/${session.code}`);
  type Entry = { id: string; name: string; score: number; kind: "team" | "player" };
  const standings = rank<Entry>(
    teams.length
      ? teams.map((t) => ({ id: t.id, name: t.name, score: t.score, kind: "team" }))
      : players.map((p) => ({ id: p.id, name: p.display_name, score: p.score, kind: "player" })),
  );

  return (
    <div className="space-y-5">
      <Panel className="flex flex-wrap items-center gap-5 p-4 sm:p-5">
        <div>
          <p className="text-xs text-ink-300">Room code</p>
          <p className="display tnum text-4xl tracking-[0.2em] text-gold">{session.code}</p>
        </div>
        <div className="min-w-0">
          <p className="text-xs text-ink-300">Join link</p>
          <button
            onClick={() => void navigator.clipboard?.writeText(joinLink)}
            className="max-w-[26ch] truncate text-sm text-electric hover:underline sm:max-w-[40ch]"
            title="Copy the join link"
          >
            {joinLink}
          </button>
        </div>
        <Stat value={players.length} label="Players" />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Badge tone={connection === "connected" ? "good" : connection === "connecting" ? "neutral" : "bad"}>
            {connection === "connected" ? "Live" : connection === "connecting" ? "Connecting" : "Offline"}
          </Badge>
          {isDemo ? <Badge tone="demo">Demo content</Badge> : null}
          {room?.allow_late_join === false ? <Badge tone="neutral">Late join closed</Badge> : null}
          <Button tone="ghost" size="sm" onClick={() => setProjector((p) => !p)}>
            {projector ? "Leave projector mode" : "Projector mode"}
          </Button>
          <Button
            tone="ghost"
            size="sm"
            onClick={() => void api?.setLateJoin(!(room?.allow_late_join ?? true)).then(refresh)}
          >
            {room?.allow_late_join === false ? "Allow late joins" : "Close late joins"}
          </Button>
          <Button
            tone="ghost"
            size="sm"
            onClick={() => {
              void api?.close();
              forgetHost();
              onExit();
            }}
          >
            End game
          </Button>
        </div>
      </Panel>

      {error ? <Panel className="border-wrong/40 p-4 text-sm text-wrong">{error}</Panel> : null}

      {round && round.state !== "retired" ? (
        <Panel className="p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-4">
            <span className="display tnum text-3xl text-gold">{round.points}</span>
            <div className="min-w-0">
              <p className="truncate font-semibold">{round.category_name}</p>
              <p className="text-xs text-ink-300">
                Round {round.seq} · {round.state}
                {round.buzz_open ? " · buzzing open" : ""}
              </p>
            </div>
            <div className="ml-auto flex flex-wrap gap-2">
              <Button tone={round.buzz_open ? "danger" : "gold"} onClick={() => void toggleBuzzing()} disabled={busy}>
                {round.buzz_open ? "Lock buzzers (B)" : "Open buzzers (B)"}
              </Button>
              <Button tone="primary" onClick={() => void judge(true)} disabled={busy || !winner}>
                Correct (Y)
              </Button>
              <Button tone="secondary" onClick={() => void judge(false)} disabled={busy || !winner}>
                Incorrect (N)
              </Button>
              <Button tone="ghost" onClick={() => void reveal()} disabled={busy || round.state === "revealed"}>
                Reveal (R)
              </Button>
              <Button tone="ghost" onClick={() => void api?.retire(round.id).then(refresh)} disabled={busy}>
                Retire item
              </Button>
              <Button tone="ghost" onClick={() => void backToBoard()} disabled={busy}>
                Back to board
              </Button>
            </div>
          </div>

          <h2 className={`mt-5 text-balance ${projector ? "text-4xl sm:text-5xl" : "text-2xl sm:text-3xl"}`}>
            {round.question.vignette ? (
              <span className="mb-3 block text-lg font-normal text-ink-200 sm:text-xl">
                {round.question.vignette}
              </span>
            ) : null}
            {round.question.stem}
          </h2>

          <ul className={`mt-5 grid gap-2.5 ${projector ? "text-2xl" : "text-lg"} sm:grid-cols-2`}>
            {round.question.options.map((option) => {
              const isKey = round.answer?.key === option.id;
              return (
                <li
                  key={option.id}
                  className={`cusp flex items-start gap-3 border px-4 py-3 ${
                    isKey
                      ? "border-correct bg-[rgba(52,211,153,0.12)]"
                      : "border-[rgba(154,166,204,0.18)]"
                  }`}
                >
                  <span className="display shrink-0 text-ink-300">{option.id}</span>
                  <span>{option.text}</span>
                </li>
              );
            })}
          </ul>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            {winner ? (
              <Badge tone="live">
                {winner.display_name} buzzed in first
                {winner.team_id
                  ? ` · ${teams.find((t) => t.id === winner.team_id)?.name ?? "team"}`
                  : ""}
              </Badge>
            ) : round.buzz_open ? (
              <Badge tone="neutral">Waiting for a buzz…</Badge>
            ) : null}
          </div>

          {round.answer ? (
            <div className="mt-5 border-t border-[rgba(154,166,204,0.18)] pt-4">
              <p className="text-sm text-ink-300">
                Key <span className="font-semibold text-correct">{round.answer.key}</span>
              </p>
              <div className="mt-2 space-y-2">
                {round.answer.explanation.map((sentence, i) => (
                  <p key={i} className="text-ink-100">
                    {sentence.text}
                  </p>
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
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div>
          {board ? (
            <Board
              board={board}
              playedItemIds={playedItemIds}
              onPick={(tile, domainId) => void openTile(tile, domainId)}
              disabled={busy || Boolean(round && round.state !== "revealed" && round.state !== "retired")}
              showLevels
            />
          ) : (
            <Spinner label="Building the board…" />
          )}
        </div>

        <aside className="space-y-5">
          <Panel className="p-5">
            <h2 className="text-lg">Standings</h2>
            {standings.length ? (
              <ul className="mt-3 space-y-2">
                {standings.map((entry) => (
                  <li key={entry.id} className="flex items-center gap-3">
                    <span className="display tnum w-6 text-ink-300">{entry.place}</span>
                    <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                    <span className="tnum font-semibold text-gold">{entry.score.toLocaleString()}</span>
                    <span className="flex gap-1">
                      <button
                        onClick={() =>
                          void api
                            ?.adjust(
                              entry.kind === "team" ? { teamId: entry.id } : { playerId: entry.id },
                              100,
                            )
                            .then(refresh)
                        }
                        className="cusp cusp-sm bg-navy-600 px-1.5 text-xs hover:bg-navy-500"
                        title="Add 100"
                      >
                        +
                      </button>
                      <button
                        onClick={() =>
                          void api
                            ?.adjust(
                              entry.kind === "team" ? { teamId: entry.id } : { playerId: entry.id },
                              -100,
                            )
                            .then(refresh)
                        }
                        className="cusp cusp-sm bg-navy-600 px-1.5 text-xs hover:bg-navy-500"
                        title="Subtract 100"
                      >
                        −
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-ink-300">Nobody has joined yet.</p>
            )}
          </Panel>

          <Panel className="p-5">
            <h2 className="text-lg">Teams</h2>
            <form
              className="mt-3 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (!newTeamName.trim()) return;
                void api?.createTeam(newTeamName).then(() => {
                  setNewTeamName("");
                  return refresh();
                });
              }}
            >
              <input
                value={newTeamName}
                onChange={(e) => setNewTeamName(e.target.value)}
                placeholder="Team name"
                maxLength={40}
                className="cusp cusp-sm min-w-0 flex-1 border border-[rgba(154,166,204,0.25)] bg-navy-800 px-3 py-2 text-sm outline-none focus:border-electric"
              />
              <Button tone="secondary" size="sm" type="submit">
                Add
              </Button>
            </form>

            <ul className="mt-4 space-y-3">
              {players.map((player) => (
                <li key={player.id} className="flex items-center gap-2">
                  <span
                    className={`size-2 shrink-0 rounded-full ${player.connected ? "bg-correct" : "bg-navy-500"}`}
                    title={player.connected ? "Connected" : "Disconnected"}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">{player.display_name}</span>
                  <select
                    value={player.team_id ?? ""}
                    onChange={(e) =>
                      void api?.assignTeam(player.id, e.target.value || null).then(refresh)
                    }
                    className="cusp cusp-sm max-w-28 border border-[rgba(154,166,204,0.25)] bg-navy-800 px-2 py-1 text-xs outline-none focus:border-electric"
                  >
                    <option value="">No team</option>
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => void api?.kick(player.id).then(refresh)}
                    className="text-xs text-ink-300 hover:text-wrong"
                    title={`Remove ${player.display_name}`}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel className="p-5 text-sm text-ink-300">
            <h2 className="text-base text-ink-100">Keyboard</h2>
            <dl className="mt-2 space-y-1">
              <div className="flex gap-2">
                <dt className="font-semibold text-ink-200">B / Space</dt>
                <dd>open or lock the buzzers</dd>
              </div>
              <div className="flex gap-2">
                <dt className="font-semibold text-ink-200">Y / N</dt>
                <dd>score the buzz winner</dd>
              </div>
              <div className="flex gap-2">
                <dt className="font-semibold text-ink-200">R</dt>
                <dd>reveal the answer</dd>
              </div>
              <div className="flex gap-2">
                <dt className="font-semibold text-ink-200">P</dt>
                <dd>projector type size</dd>
              </div>
            </dl>
          </Panel>

          {round?.is_final && wagers.length ? (
            <Panel className="p-5">
              <h2 className="text-lg">Final wagers</h2>
              <ul className="mt-3 space-y-1.5 text-sm">
                {wagers.map((w) => (
                  <li key={w.player_id} className="flex gap-2">
                    <span className="min-w-0 flex-1 truncate">
                      {players.find((p) => p.id === w.player_id)?.display_name ?? w.player_id}
                    </span>
                    <span className="tnum">{w.amount.toLocaleString()}</span>
                    <Badge tone={w.locked ? "good" : "neutral"}>{w.locked ? "locked" : "open"}</Badge>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
