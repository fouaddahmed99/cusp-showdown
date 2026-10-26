import type { PointValue } from "@/content/difficulty";

/**
 * SCORING
 *
 * A correct response adds the tile's value; an incorrect response subtracts it
 * when penalties are on. Scores may go negative, and a negative score is kept
 * as-is rather than clamped — a team can dig a hole and climb out of it.
 */
export interface ScoreDelta {
  points: number;
  reason: "correct" | "incorrect" | "timeout" | "host-adjustment" | "wager-correct" | "wager-incorrect";
}

export interface ScoringRules {
  /** Subtract the tile value for a wrong answer. */
  penalizeIncorrect: boolean;
  /** Subtract the tile value when the timer runs out with no response. */
  penalizeTimeout: boolean;
}

export const DEFAULT_SCORING: ScoringRules = {
  penalizeIncorrect: true,
  penalizeTimeout: false,
};

export function scoreResponse(
  points: PointValue,
  outcome: "correct" | "incorrect" | "timeout",
  rules: ScoringRules = DEFAULT_SCORING,
): ScoreDelta {
  if (outcome === "correct") return { points, reason: "correct" };
  if (outcome === "incorrect") {
    return { points: rules.penalizeIncorrect ? -points : 0, reason: "incorrect" };
  }
  return { points: rules.penalizeTimeout ? -points : 0, reason: "timeout" };
}

/**
 * A wager is bounded by what the player can actually put up. With a positive
 * score the ceiling is that score; at zero or below, the player may still
 * wager up to the largest tile value on the board so the round is not dead.
 */
export function maxWager(score: number, largestTileValue = 1000): number {
  return Math.max(score, largestTileValue);
}

export function clampWager(requested: number, score: number, largestTileValue = 1000): number {
  const ceiling = maxWager(score, largestTileValue);
  if (!Number.isFinite(requested)) return 0;
  const whole = Math.floor(requested);
  if (whole < 0) return 0;
  return Math.min(whole, ceiling);
}

export function scoreWager(wager: number, correct: boolean): ScoreDelta {
  return correct
    ? { points: wager, reason: "wager-correct" }
    : { points: -wager, reason: "wager-incorrect" };
}

export function applyDelta(score: number, delta: ScoreDelta): number {
  return score + delta.points;
}

/** Ranks scores high to low; equal scores share a place. */
export function rank<T extends { score: number }>(entries: T[]): (T & { place: number })[] {
  const sorted = [...entries].sort((a, b) => b.score - a.score);
  let place = 0;
  let lastScore: number | null = null;
  return sorted.map((entry, index) => {
    if (lastScore === null || entry.score !== lastScore) {
      place = index + 1;
      lastScore = entry.score;
    }
    return { ...entry, place };
  });
}

/** Everyone sharing first place. A tie has more than one winner. */
export function winners<T extends { score: number }>(entries: T[]): T[] {
  if (!entries.length) return [];
  const top = Math.max(...entries.map((e) => e.score));
  return entries.filter((e) => e.score === top);
}
