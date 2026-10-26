import type { OptionId } from "@/contract/lrn-public-v1";
import type { PointValue } from "@/content/difficulty";
import type { GeneratedBoard } from "@/content/board";
import type { ShowdownAnswer, ShowdownQuestion } from "@/content/types";
import { applyDelta, clampWager, scoreResponse, scoreWager } from "./scoring";
import {
  DEFAULT_SOLO_SETTINGS,
  type ActiveQuestion,
  type AnsweredTile,
  type CategoryAccuracy,
  type SoloGameState,
  type SoloSettings,
} from "./types";

/**
 * The solo game as a reducer: every transition is a pure function of state and
 * action, so the rules can be tested without a browser.
 */
export type SoloAction =
  | { type: "board-ready"; board: GeneratedBoard }
  | { type: "load-failed"; message: string }
  | { type: "settings-changed"; settings: Partial<SoloSettings> }
  | { type: "question-opened"; question: ShowdownQuestion; points: PointValue; at: number }
  | { type: "option-selected"; option: OptionId }
  | { type: "response-locked"; at: number }
  | { type: "timer-expired"; at: number }
  | { type: "answer-loaded"; answer: ShowdownAnswer }
  | { type: "grading-failed"; message: string }
  | { type: "returned-to-board" }
  | { type: "final-started"; itemId: string }
  | { type: "wager-set"; amount: number }
  | { type: "wager-locked" }
  | { type: "final-question-opened"; question: ShowdownQuestion; at: number }
  | { type: "final-answer-loaded"; answer: ShowdownAnswer }
  | { type: "game-ended" };

export function initialSoloState(settings: SoloSettings = DEFAULT_SOLO_SETTINGS): SoloGameState {
  return {
    phase: "loading",
    settings,
    board: null,
    score: 0,
    answered: [],
    consumedItemIds: [],
    active: null,
    final: null,
    error: null,
  };
}

/** Study mode forces the no-pressure settings rather than merely suggesting them. */
export function normalizeSettings(settings: SoloSettings): SoloSettings {
  if (!settings.studyMode) return settings;
  return {
    ...settings,
    timerSeconds: 0,
    feedback: "immediate",
    scoring: { penalizeIncorrect: false, penalizeTimeout: false },
  };
}

/** A response can be given on a board tile or on the final challenge. */
function isAnswering(state: SoloGameState): boolean {
  return state.phase === "question" || state.phase === "final-question";
}

function gradeOutcome(
  active: ActiveQuestion,
  answer: ShowdownAnswer,
): "correct" | "incorrect" | "timeout" {
  if (active.outcome === "timeout" && active.selected === null) return "timeout";
  if (active.selected === null) return "timeout";
  return active.selected === answer.key ? "correct" : "incorrect";
}

export function soloReducer(state: SoloGameState, action: SoloAction): SoloGameState {
  switch (action.type) {
    case "board-ready":
      return { ...state, phase: "board", board: action.board, error: null };

    case "load-failed":
      return { ...state, phase: "error", error: action.message };

    case "settings-changed": {
      const merged = normalizeSettings({ ...state.settings, ...action.settings });
      return { ...state, settings: merged };
    }

    case "question-opened":
      if (state.phase !== "board") return state;
      return {
        ...state,
        phase: "question",
        active: {
          question: action.question,
          points: action.points,
          selected: null,
          startedAt: action.at,
        },
      };

    case "option-selected":
      if (!isAnswering(state) || !state.active || state.active.lockedAt) return state;
      return { ...state, active: { ...state.active, selected: action.option } };

    case "response-locked": {
      if (!isAnswering(state) || !state.active || state.active.lockedAt) return state;
      return { ...state, active: { ...state.active, lockedAt: action.at } };
    }

    case "timer-expired": {
      if (!isAnswering(state) || !state.active || state.active.lockedAt) return state;
      return {
        ...state,
        active: { ...state.active, lockedAt: action.at, outcome: "timeout", selected: null },
      };
    }

    case "answer-loaded": {
      const active = state.active;
      if (!active || active.question.id !== action.answer.id) return state;
      const outcome = gradeOutcome(active, action.answer);
      const delta = scoreResponse(active.points, outcome, state.settings.scoring);
      const answeredTile: AnsweredTile = {
        itemId: active.question.id,
        domainId: active.question.domainId,
        domainName: active.question.domainName,
        points: active.points,
        selected: active.selected,
        correctKey: action.answer.key,
        outcome,
        pointsDelta: delta.points,
        elapsedMs: Math.max(0, (active.lockedAt ?? active.startedAt) - active.startedAt),
      };
      return {
        ...state,
        phase: "revealed",
        score: applyDelta(state.score, delta),
        answered: [...state.answered, answeredTile],
        consumedItemIds: [...state.consumedItemIds, active.question.id],
        active: { ...active, answer: action.answer, outcome },
      };
    }

    case "grading-failed": {
      // The item could not be graded (bundle drift, network). It is not scored
      // and not recorded as missed; the player is told and sent back.
      return { ...state, phase: "board", active: null, error: action.message };
    }

    case "returned-to-board":
      return { ...state, phase: "board", active: null, error: null };

    case "final-started":
      return {
        ...state,
        phase: "final-wager",
        final: { itemId: action.itemId, wager: 0, locked: false, selected: null },
      };

    case "wager-set": {
      if (!state.final || state.final.locked) return state;
      return {
        ...state,
        final: { ...state.final, wager: clampWager(action.amount, state.score) },
      };
    }

    case "wager-locked": {
      if (!state.final || state.final.locked) return state;
      return { ...state, final: { ...state.final, locked: true } };
    }

    case "final-question-opened": {
      if (!state.final?.locked) return state;
      return {
        ...state,
        phase: "final-question",
        active: {
          question: action.question,
          points: 1000,
          selected: null,
          startedAt: action.at,
        },
      };
    }

    case "final-answer-loaded": {
      const active = state.active;
      const final = state.final;
      if (!active || !final || active.question.id !== action.answer.id) return state;
      const correct = active.selected === action.answer.key;
      const delta = scoreWager(final.wager, correct);
      const answeredTile: AnsweredTile = {
        itemId: active.question.id,
        domainId: active.question.domainId,
        domainName: active.question.domainName,
        points: 1000,
        selected: active.selected,
        correctKey: action.answer.key,
        outcome: correct ? "correct" : "incorrect",
        pointsDelta: delta.points,
        elapsedMs: Math.max(0, (active.lockedAt ?? active.startedAt) - active.startedAt),
      };
      return {
        ...state,
        phase: "final-revealed",
        score: applyDelta(state.score, delta),
        answered: [...state.answered, answeredTile],
        consumedItemIds: [...state.consumedItemIds, active.question.id],
        active: { ...active, answer: action.answer, outcome: answeredTile.outcome },
        final: {
          ...final,
          selected: active.selected,
          outcome: answeredTile.outcome === "correct" ? "correct" : "incorrect",
          pointsDelta: delta.points,
        },
      };
    }

    case "game-ended":
      return { ...state, phase: "summary", active: null };

    default:
      return state;
  }
}

/** Per-category accuracy over the tiles actually answered. */
export function categoryAccuracy(answered: AnsweredTile[]): CategoryAccuracy[] {
  const byDomain = new Map<string, CategoryAccuracy>();
  for (const tile of answered) {
    const entry = byDomain.get(tile.domainId) ?? {
      domainId: tile.domainId,
      domainName: tile.domainName,
      answered: 0,
      correct: 0,
      accuracy: null,
    };
    entry.answered += 1;
    if (tile.outcome === "correct") entry.correct += 1;
    entry.accuracy = entry.answered ? entry.correct / entry.answered : null;
    byDomain.set(tile.domainId, entry);
  }
  return [...byDomain.values()].sort((a, b) => a.domainName.localeCompare(b.domainName));
}

export function overallAccuracy(answered: AnsweredTile[]): number {
  if (!answered.length) return 0;
  return answered.filter((a) => a.outcome === "correct").length / answered.length;
}

export function missedTiles(answered: AnsweredTile[]): AnsweredTile[] {
  return answered.filter((a) => a.outcome !== "correct");
}

/** True when every filled tile on the board has been played. */
export function boardComplete(state: SoloGameState): boolean {
  if (!state.board) return false;
  return state.answered.length >= state.board.filledTiles;
}
