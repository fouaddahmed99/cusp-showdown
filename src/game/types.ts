import type { OptionId } from "@/contract/lrn-public-v1";
import type { PointValue } from "@/content/difficulty";
import type { GeneratedBoard } from "@/content/board";
import type { ShowdownAnswer, ShowdownQuestion } from "@/content/types";
import type { ScoringRules } from "./scoring";

export type FeedbackTiming = "immediate" | "end-of-game";

export interface SoloSettings {
  /** Show the verdict as each tile is answered, or hold it all to the end. */
  feedback: FeedbackTiming;
  /** Seconds per question. 0 means no timer (study mode). */
  timerSeconds: number;
  scoring: ScoringRules;
  /** Study mode: no timer, no penalties, explanation always shown. */
  studyMode: boolean;
}

export const DEFAULT_SOLO_SETTINGS: SoloSettings = {
  feedback: "immediate",
  timerSeconds: 45,
  scoring: { penalizeIncorrect: true, penalizeTimeout: false },
  studyMode: false,
};

export interface AnsweredTile {
  itemId: string;
  domainId: string;
  domainName: string;
  points: PointValue;
  selected: OptionId | null;
  correctKey: OptionId;
  outcome: "correct" | "incorrect" | "timeout";
  pointsDelta: number;
  /** Milliseconds from question shown to response locked. */
  elapsedMs: number;
}

export interface CategoryAccuracy {
  domainId: string;
  domainName: string;
  answered: number;
  correct: number;
  /** 0–1, or null when nothing was answered in this category. */
  accuracy: number | null;
}

export interface FinalChallengeState {
  itemId: string;
  wager: number;
  locked: boolean;
  selected: OptionId | null;
  outcome?: "correct" | "incorrect";
  pointsDelta?: number;
}

export type SoloPhase =
  | "loading"
  | "board"
  | "question"
  | "revealed"
  | "final-wager"
  | "final-question"
  | "final-revealed"
  | "summary"
  | "error";

export interface ActiveQuestion {
  question: ShowdownQuestion;
  points: PointValue;
  /** Present only after a response is locked in. */
  answer?: ShowdownAnswer;
  selected: OptionId | null;
  startedAt: number;
  lockedAt?: number;
  outcome?: "correct" | "incorrect" | "timeout";
}

export interface SoloGameState {
  phase: SoloPhase;
  settings: SoloSettings;
  board: GeneratedBoard | null;
  score: number;
  answered: AnsweredTile[];
  /** Item ids consumed in this browser session, so a replay brings new ones. */
  consumedItemIds: string[];
  active: ActiveQuestion | null;
  final: FinalChallengeState | null;
  error: string | null;
}

export interface PersonalBest {
  score: number;
  accuracy: number;
  answered: number;
  at: string;
  contentVersion: string;
}

export interface StoredProgress {
  version: 1;
  personalBest: PersonalBest | null;
  gamesPlayed: number;
  /** Lifetime per-category tallies. */
  categoryTotals: Record<string, { answered: number; correct: number }>;
  /** Items answered incorrectly, for the review list. */
  missedItemIds: string[];
  settings: SoloSettings;
}
