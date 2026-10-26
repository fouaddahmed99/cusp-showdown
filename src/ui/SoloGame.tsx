import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { OptionId } from "@/contract/lrn-public-v1";
import {
  assertPairedVersions,
  buildTaxonomyIndex,
  indexSources,
  toShowdownAnswer,
  toShowdownQuestion,
  type TaxonomyIndex,
} from "@/content/adapter";
import {
  boardItemIds,
  generateBoard,
  isPlayable,
  suggestCategories,
  type BoardTile,
} from "@/content/board";
import type { ContentPack } from "@/content/store";
import type { ContentCatalog, ShowdownSource } from "@/content/types";
import {
  boardComplete,
  initialSoloState,
  normalizeSettings,
  soloReducer,
} from "@/game/solo";
import { loadProgress, recordGame, saveProgress, saveSettings } from "@/game/persist";
import type { SoloSettings } from "@/game/types";
import { sfx } from "@/audio/sfx";
import { Board } from "./Board";
import { QuestionView } from "./QuestionView";
import { Summary } from "./Summary";
import { FinalChallenge } from "./FinalChallenge";
import { Badge, Button, ErrorNote, Panel, Spinner, Stat } from "./primitives";

interface SoloGameProps {
  pack: ContentPack;
  catalog: ContentCatalog;
  categories: string[];
  settings: SoloSettings;
  onSettingsChange: (settings: SoloSettings) => void;
  onExit: () => void;
  isDemo: boolean;
}

export function SoloGame({
  pack,
  catalog,
  categories,
  settings,
  onSettingsChange,
  onExit,
  isDemo,
}: SoloGameProps) {
  const [state, dispatch] = useReducer(soloReducer, initialSoloState(normalizeSettings(settings)));
  const [sources, setSources] = useState<Map<string, ShowdownSource>>(new Map());
  const [taxonomy, setTaxonomy] = useState<TaxonomyIndex | null>(null);
  const [busy, setBusy] = useState(false);
  const [seed, setSeed] = useState(() => `solo-${Date.now().toString(36)}`);
  const recordedRef = useRef(false);

  // Keep the reducer's copy of the settings in step with the parent's.
  useEffect(() => {
    dispatch({ type: "settings-changed", settings });
  }, [settings]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const manifest = await pack.getManifest();
        const index = buildTaxonomyIndex(manifest);
        const sourceList = await pack.getSources().catch(() => []);
        if (cancelled) return;
        setTaxonomy(index);
        setSources(indexSources(sourceList));

        const chosen = categories.length ? categories : suggestCategories(catalog, 6);
        const board = generateBoard(catalog, { categories: chosen, seed });
        if (!isPlayable(board)) {
          dispatch({
            type: "load-failed",
            message:
              "None of the chosen categories have an approved question available, so there is no board to play. " +
              "Pick different categories, or switch the content source in settings.",
          });
          return;
        }
        dispatch({ type: "board-ready", board });
      } catch (error) {
        if (!cancelled) {
          dispatch({
            type: "load-failed",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pack, catalog, categories, seed]);

  const playedItemIds = useMemo(() => new Set(state.consumedItemIds), [state.consumedItemIds]);

  const openTile = useCallback(
    async (tile: BoardTile) => {
      if (!taxonomy || !tile.itemId || busy) return;
      setBusy(true);
      sfx.play("tile-open");
      try {
        const question = toShowdownQuestion(await pack.getQuestion(tile.itemId), {
          origin: catalog.origin,
          contentVersion: catalog.contentVersion,
          taxonomy,
        });
        dispatch({ type: "question-opened", question, points: tile.points, at: Date.now() });
      } catch (error) {
        dispatch({
          type: "grading-failed",
          message: `That tile could not be opened: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      } finally {
        setBusy(false);
      }
    },
    [busy, catalog.contentVersion, catalog.origin, pack, taxonomy],
  );

  /** Grades a locked response. The answer file is fetched only at this point. */
  const grade = useCallback(
    async (kind: "tile" | "final") => {
      const active = state.active;
      if (!active) return;
      setBusy(true);
      try {
        const answer = toShowdownAnswer(await pack.getAnswer(active.question.id));
        assertPairedVersions(active.question, answer);
        dispatch(
          kind === "final" ? { type: "final-answer-loaded", answer } : { type: "answer-loaded", answer },
        );
      } catch (error) {
        dispatch({
          type: "grading-failed",
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setBusy(false);
      }
    },
    [pack, state.active],
  );

  const lockIn = useCallback(() => {
    dispatch({ type: "response-locked", at: Date.now() });
  }, []);

  const timeOut = useCallback(() => {
    dispatch({ type: "timer-expired", at: Date.now() });
  }, []);

  // Once a response is locked (by the player or by the timer), grade it.
  useEffect(() => {
    const active = state.active;
    if (!active?.lockedAt || active.answer) return;
    void grade(state.phase === "final-question" ? "final" : "tile");
  }, [grade, state.active, state.phase]);

  // When the board is exhausted, offer the final challenge if an item remains.
  const finalCandidateId = useMemo(() => {
    const onBoard = new Set(state.board ? boardItemIds(state.board) : []);
    const spare = catalog.items.find((i) => !onBoard.has(i.id) && !playedItemIds.has(i.id));
    return spare?.id ?? null;
  }, [catalog.items, playedItemIds, state.board]);

  const startFinal = useCallback(async () => {
    if (!finalCandidateId) {
      dispatch({ type: "game-ended" });
      return;
    }
    dispatch({ type: "final-started", itemId: finalCandidateId });
  }, [finalCandidateId]);

  const openFinalQuestion = useCallback(async () => {
    const itemId = state.final?.itemId;
    if (!itemId || !taxonomy) return;
    setBusy(true);
    try {
      const question = toShowdownQuestion(await pack.getQuestion(itemId), {
        origin: catalog.origin,
        contentVersion: catalog.contentVersion,
        taxonomy,
      });
      dispatch({ type: "final-question-opened", question, at: Date.now() });
    } catch (error) {
      dispatch({
        type: "grading-failed",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  }, [catalog.contentVersion, catalog.origin, pack, state.final?.itemId, taxonomy]);

  // Record the finished game once.
  useEffect(() => {
    if (state.phase !== "summary" || recordedRef.current) return;
    recordedRef.current = true;
    const progress = loadProgress();
    saveProgress(
      recordGame(progress, {
        score: state.score,
        answered: state.answered,
        contentVersion: catalog.contentVersion,
      }),
    );
  }, [catalog.contentVersion, state.answered, state.phase, state.score]);

  const replay = useCallback(() => {
    recordedRef.current = false;
    setSeed(`solo-${Date.now().toString(36)}`);
    dispatch({ type: "returned-to-board" });
  }, []);

  if (state.phase === "error") {
    return (
      <ErrorNote
        title="This board could not be built"
        detail={state.error ?? undefined}
        action={
          <Button tone="primary" onClick={onExit}>
            Back to the start
          </Button>
        }
      />
    );
  }

  if (state.phase === "loading" || !state.board) {
    return <Spinner label="Dealing the board…" />;
  }

  const complete = boardComplete(state);

  if (state.phase === "summary") {
    return (
      <Summary
        score={state.score}
        answered={state.answered}
        sources={sources}
        pack={pack}
        contentVersion={catalog.contentVersion}
        isDemo={isDemo}
        onReplay={replay}
        onExit={onExit}
      />
    );
  }

  if (state.phase === "final-wager" || state.phase === "final-question" || state.phase === "final-revealed") {
    return (
      <FinalChallenge
        state={state}
        sources={sources}
        busy={busy}
        onWager={(amount) => dispatch({ type: "wager-set", amount })}
        onLockWager={() => {
          dispatch({ type: "wager-locked" });
          void openFinalQuestion();
        }}
        onSelect={(option: OptionId) => dispatch({ type: "option-selected", option })}
        onLockAnswer={lockIn}
        onTimeout={timeOut}
        onFinish={() => dispatch({ type: "game-ended" })}
      />
    );
  }

  if ((state.phase === "question" || state.phase === "revealed") && state.active) {
    return (
      <QuestionView
        question={state.active.question}
        points={state.active.points}
        answer={state.active.answer}
        selected={state.active.selected}
        onSelect={(option) => dispatch({ type: "option-selected", option })}
        onLock={lockIn}
        onTimeout={timeOut}
        onNext={() => dispatch({ type: "returned-to-board" })}
        timerSeconds={state.settings.timerSeconds}
        holdFeedback={state.settings.feedback === "end-of-game"}
        revealed={state.phase === "revealed"}
        sources={sources}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-6">
        <Stat value={state.score.toLocaleString()} label="Score" tone="gold" />
        <Stat
          value={`${state.answered.length}/${state.board.filledTiles}`}
          label="Tiles played"
        />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {isDemo ? <Badge tone="demo">Demo content</Badge> : null}
          {state.settings.studyMode ? <Badge tone="neutral">Study mode</Badge> : null}
          {state.settings.feedback === "end-of-game" ? (
            <Badge tone="neutral">Feedback at the end</Badge>
          ) : null}
          <Button
            tone="ghost"
            size="sm"
            onClick={() => {
              const next = normalizeSettings({ ...settings, studyMode: !settings.studyMode });
              onSettingsChange(next);
              saveSettings(next);
            }}
          >
            {settings.studyMode ? "Leave study mode" : "Study mode"}
          </Button>
          <Button tone="ghost" size="sm" onClick={onExit}>
            Leave game
          </Button>
        </div>
      </div>

      {state.error ? (
        <Panel className="border-wrong/40 p-4 text-sm text-wrong">{state.error}</Panel>
      ) : null}

      <Board
        board={state.board}
        playedItemIds={playedItemIds}
        onPick={(tile) => void openTile(tile)}
        disabled={busy}
        showLevels={state.settings.studyMode}
      />

      {complete ? (
        <Panel className="flex flex-wrap items-center gap-4 p-5">
          <p className="text-lg">
            Board cleared with{" "}
            <span className="display tnum text-gold">{state.score.toLocaleString()}</span>.
          </p>
          <div className="ml-auto flex gap-3">
            {finalCandidateId ? (
              <Button tone="gold" onClick={() => void startFinal()}>
                Final challenge
              </Button>
            ) : null}
            <Button tone="primary" onClick={() => dispatch({ type: "game-ended" })}>
              See the summary
            </Button>
          </div>
          {!finalCandidateId ? (
            <p className="w-full text-sm text-ink-300">
              No unused approved item is left for a final challenge, so this game ends on the board.
            </p>
          ) : null}
        </Panel>
      ) : null}
    </div>
  );
}
