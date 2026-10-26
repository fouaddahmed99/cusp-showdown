import { describe, expect, it } from "vitest";
import {
  applyDelta,
  clampWager,
  DEFAULT_SCORING,
  maxWager,
  rank,
  scoreResponse,
  scoreWager,
  winners,
} from "@/game/scoring";

describe("tile scoring", () => {
  it("adds the tile value for a correct response", () => {
    expect(scoreResponse(600, "correct")).toEqual({ points: 600, reason: "correct" });
  });

  it("subtracts the tile value for a wrong response when penalties are on", () => {
    expect(scoreResponse(600, "incorrect", DEFAULT_SCORING)).toEqual({
      points: -600,
      reason: "incorrect",
    });
  });

  it("costs nothing for a wrong response when penalties are off", () => {
    const rules = { penalizeIncorrect: false, penalizeTimeout: false };
    expect(scoreResponse(1000, "incorrect", rules).points).toBe(0);
  });

  it("does not penalise a timeout by default, but can be told to", () => {
    expect(scoreResponse(400, "timeout").points).toBe(0);
    expect(
      scoreResponse(400, "timeout", { penalizeIncorrect: true, penalizeTimeout: true }).points,
    ).toBe(-400);
  });

  it("lets a score go negative and climb back out", () => {
    let score = 0;
    score = applyDelta(score, scoreResponse(800, "incorrect"));
    expect(score).toBe(-800);
    score = applyDelta(score, scoreResponse(1000, "correct"));
    expect(score).toBe(200);
  });
});

describe("final challenge wagers", () => {
  it("caps a wager at the player's score once they are ahead", () => {
    expect(maxWager(2400)).toBe(2400);
    expect(clampWager(5000, 2400)).toBe(2400);
    expect(clampWager(1200, 2400)).toBe(1200);
  });

  it("still allows a wager up to the largest tile when the score is zero or negative", () => {
    expect(maxWager(0)).toBe(1000);
    expect(clampWager(1000, 0)).toBe(1000);
    expect(clampWager(1500, -600)).toBe(1000);
  });

  it("refuses negative, fractional and non-numeric wagers", () => {
    expect(clampWager(-50, 2000)).toBe(0);
    expect(clampWager(750.9, 2000)).toBe(750);
    expect(clampWager(Number.NaN, 2000)).toBe(0);
    expect(clampWager(Number.POSITIVE_INFINITY, 2000)).toBe(0);
  });

  it("pays the wager on a correct final and takes it on a wrong one", () => {
    expect(scoreWager(1800, true)).toEqual({ points: 1800, reason: "wager-correct" });
    expect(scoreWager(1800, false)).toEqual({ points: -1800, reason: "wager-incorrect" });
    expect(applyDelta(2000, scoreWager(1800, false))).toBe(200);
  });

  it("can take a leader below zero on a wrong final", () => {
    expect(applyDelta(600, scoreWager(1000, false))).toBe(-400);
  });
});

describe("standings", () => {
  it("ranks high to low and shares a place on a tie", () => {
    const placed = rank([
      { name: "a", score: 1200 },
      { name: "b", score: 2400 },
      { name: "c", score: 1200 },
      { name: "d", score: -200 },
    ]);
    expect(placed.map((p) => [p.name, p.place])).toEqual([
      ["b", 1],
      ["a", 2],
      ["c", 2],
      ["d", 4],
    ]);
  });

  it("returns every tied leader as a winner", () => {
    expect(winners([{ score: 10 }, { score: 10 }, { score: 4 }])).toHaveLength(2);
    expect(winners([])).toEqual([]);
  });

  it("can crown a negative leader when everyone is under water", () => {
    expect(winners([{ score: -100 }, { score: -400 }])).toEqual([{ score: -100 }]);
  });
});
