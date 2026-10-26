import { describe, expect, it } from "vitest";
import { generateBoard } from "@/content/board";
import type { ShowdownAnswer, ShowdownQuestion } from "@/content/types";
import {
  boardComplete,
  categoryAccuracy,
  initialSoloState,
  missedTiles,
  normalizeSettings,
  overallAccuracy,
  soloReducer,
  type SoloAction,
} from "@/game/solo";
import { DEFAULT_SOLO_SETTINGS, type SoloGameState } from "@/game/types";
import { fullCatalog, makeCatalog } from "./fixtures";

function question(id: string, domainId = "alpha"): ShowdownQuestion {
  return {
    id,
    version: 1,
    origin: "demo-sample",
    contentVersion: "test-1",
    domainId,
    domainName: `SAMPLE category ${domainId}`,
    subtopicId: "sample-sub",
    subtopicName: "SAMPLE subtopic",
    taskStatementId: "ts-sample",
    cognitiveLevel: "remember",
    stem: "SAMPLE: which demo tile is lit?",
    options: [
      { id: "A", text: "SAMPLE option A" },
      { id: "B", text: "SAMPLE option B" },
      { id: "C", text: "SAMPLE option C" },
      { id: "D", text: "SAMPLE option D" },
    ],
    lastVerifiedAt: "2026-01-01T00:00:00.000Z",
  };
}

function answer(id: string, key: "A" | "B" | "C" | "D" = "B"): ShowdownAnswer {
  return {
    id,
    version: 1,
    key,
    explanation: [
      { text: "SAMPLE explanation.", cites: [{ sourceId: "src_sample", page: null, section: "SAMPLE" }] },
    ],
    rationales: {},
  };
}

function run(state: SoloGameState, actions: SoloAction[]): SoloGameState {
  return actions.reduce(soloReducer, state);
}

function started(): SoloGameState {
  const board = generateBoard(fullCatalog(), { categories: ["alpha", "beta"], seed: "solo" });
  return soloReducer(initialSoloState(), { type: "board-ready", board });
}

describe("solo game flow", () => {
  it("opens a tile, grades a correct answer and banks the points", () => {
    const state = run(started(), [
      { type: "question-opened", question: question("q1"), points: 600, at: 1_000 },
      { type: "option-selected", option: "B" },
      { type: "response-locked", at: 4_000 },
      { type: "answer-loaded", answer: answer("q1", "B") },
    ]);
    expect(state.phase).toBe("revealed");
    expect(state.score).toBe(600);
    expect(state.answered).toHaveLength(1);
    expect(state.answered[0]).toMatchObject({
      itemId: "q1",
      outcome: "correct",
      pointsDelta: 600,
      elapsedMs: 3_000,
    });
  });

  it("subtracts on a wrong answer and records what was picked", () => {
    const state = run(started(), [
      { type: "question-opened", question: question("q2"), points: 400, at: 0 },
      { type: "option-selected", option: "A" },
      { type: "response-locked", at: 2_000 },
      { type: "answer-loaded", answer: answer("q2", "C") },
    ]);
    expect(state.score).toBe(-400);
    expect(state.answered[0]).toMatchObject({
      outcome: "incorrect",
      selected: "A",
      correctKey: "C",
    });
  });

  it("treats an expired timer as a timeout with no selection", () => {
    const state = run(started(), [
      { type: "question-opened", question: question("q3"), points: 800, at: 0 },
      { type: "option-selected", option: "D" },
      { type: "timer-expired", at: 45_000 },
      { type: "answer-loaded", answer: answer("q3", "D") },
    ]);
    expect(state.answered[0]!.outcome).toBe("timeout");
    expect(state.answered[0]!.selected).toBeNull();
    expect(state.score).toBe(0);
  });

  it("ignores a late selection once the response is locked", () => {
    const locked = run(started(), [
      { type: "question-opened", question: question("q4"), points: 200, at: 0 },
      { type: "option-selected", option: "A" },
      { type: "response-locked", at: 1_000 },
    ]);
    const after = soloReducer(locked, { type: "option-selected", option: "B" });
    expect(after.active!.selected).toBe("A");
  });

  it("ignores an answer that belongs to a different question", () => {
    const state = run(started(), [
      { type: "question-opened", question: question("q5"), points: 200, at: 0 },
      { type: "option-selected", option: "B" },
      { type: "response-locked", at: 500 },
      { type: "answer-loaded", answer: answer("other-item", "B") },
    ]);
    expect(state.phase).toBe("question");
    expect(state.answered).toHaveLength(0);
  });

  it("does not open a tile while a question is already open", () => {
    const open = run(started(), [
      { type: "question-opened", question: question("q6"), points: 200, at: 0 },
    ]);
    const again = soloReducer(open, {
      type: "question-opened",
      question: question("q7"),
      points: 400,
      at: 10,
    });
    expect(again.active!.question.id).toBe("q6");
  });

  it("scores nothing and explains itself when an item cannot be graded", () => {
    const state = run(started(), [
      { type: "question-opened", question: question("q8"), points: 1000, at: 0 },
      { type: "option-selected", option: "B" },
      { type: "response-locked", at: 900 },
      { type: "grading-failed", message: "Item q8 changed while the game was open." },
    ]);
    expect(state.phase).toBe("board");
    expect(state.score).toBe(0);
    expect(state.answered).toHaveLength(0);
    expect(state.error).toContain("changed while the game was open");
  });

  it("never serves the same item twice in one game", () => {
    const board = generateBoard(makeCatalog([{ domainId: "alpha", remember: 5 }]), {
      categories: ["alpha"],
      seed: "unique",
    });
    let state = soloReducer(initialSoloState(), { type: "board-ready", board });
    const ids = ["i1", "i2", "i3"];
    for (const [index, id] of ids.entries()) {
      state = run(state, [
        { type: "question-opened", question: question(id), points: 200, at: index * 1_000 },
        { type: "option-selected", option: "B" },
        { type: "response-locked", at: index * 1_000 + 500 },
        { type: "answer-loaded", answer: answer(id, "B") },
        { type: "returned-to-board" },
      ]);
    }
    expect(state.consumedItemIds).toEqual(ids);
    expect(new Set(state.consumedItemIds).size).toBe(ids.length);
  });
});

describe("final challenge", () => {
  function reachFinal(score: number): SoloGameState {
    const base = started();
    return { ...base, score, phase: "board" };
  }

  it("locks a wager, then pays it out on a correct response", () => {
    const state = run(reachFinal(2000), [
      { type: "final-started", itemId: "final-1" },
      { type: "wager-set", amount: 1500 },
      { type: "wager-locked" },
      { type: "final-question-opened", question: question("final-1"), at: 0 },
      { type: "option-selected", option: "B" },
      { type: "response-locked", at: 5_000 },
      { type: "final-answer-loaded", answer: answer("final-1", "B") },
    ]);
    expect(state.phase).toBe("final-revealed");
    expect(state.score).toBe(3500);
    expect(state.final).toMatchObject({ wager: 1500, outcome: "correct", pointsDelta: 1500 });
  });

  it("takes the wager on a wrong response", () => {
    const state = run(reachFinal(2000), [
      { type: "final-started", itemId: "final-2" },
      { type: "wager-set", amount: 2000 },
      { type: "wager-locked" },
      { type: "final-question-opened", question: question("final-2"), at: 0 },
      { type: "option-selected", option: "A" },
      { type: "response-locked", at: 3_000 },
      { type: "final-answer-loaded", answer: answer("final-2", "C") },
    ]);
    expect(state.score).toBe(0);
    expect(state.final!.outcome).toBe("incorrect");
  });

  it("will not open the final question before the wager is locked", () => {
    const state = run(reachFinal(1000), [
      { type: "final-started", itemId: "final-3" },
      { type: "wager-set", amount: 500 },
      { type: "final-question-opened", question: question("final-3"), at: 0 },
    ]);
    expect(state.phase).toBe("final-wager");
    expect(state.active).toBeNull();
  });

  it("refuses to change a wager after it is locked", () => {
    const state = run(reachFinal(1000), [
      { type: "final-started", itemId: "final-4" },
      { type: "wager-set", amount: 400 },
      { type: "wager-locked" },
      { type: "wager-set", amount: 1000 },
    ]);
    expect(state.final!.wager).toBe(400);
  });

  it("caps the wager at what the player can put up", () => {
    const state = run(reachFinal(700), [
      { type: "final-started", itemId: "final-5" },
      { type: "wager-set", amount: 99_999 },
    ]);
    expect(state.final!.wager).toBe(1000);
  });
});

describe("settings and reporting", () => {
  it("study mode drops the timer and the penalties", () => {
    const normalized = normalizeSettings({
      ...DEFAULT_SOLO_SETTINGS,
      studyMode: true,
      timerSeconds: 30,
    });
    expect(normalized.timerSeconds).toBe(0);
    expect(normalized.scoring).toEqual({ penalizeIncorrect: false, penalizeTimeout: false });
    expect(normalized.feedback).toBe("immediate");
  });

  it("keeps end-of-game feedback when the player asked for it", () => {
    const state = soloReducer(started(), {
      type: "settings-changed",
      settings: { feedback: "end-of-game" },
    });
    expect(state.settings.feedback).toBe("end-of-game");
  });

  it("reports accuracy per category and overall", () => {
    const answered = [
      { domainId: "alpha", domainName: "SAMPLE category alpha", outcome: "correct" as const },
      { domainId: "alpha", domainName: "SAMPLE category alpha", outcome: "incorrect" as const },
      { domainId: "beta", domainName: "SAMPLE category beta", outcome: "correct" as const },
    ].map((partial, i) => ({
      itemId: `i${i}`,
      points: 200 as const,
      selected: "A" as const,
      correctKey: "A" as const,
      pointsDelta: 0,
      elapsedMs: 0,
      ...partial,
    }));

    const byCategory = categoryAccuracy(answered);
    expect(byCategory).toHaveLength(2);
    expect(byCategory.find((c) => c.domainId === "alpha")).toMatchObject({
      answered: 2,
      correct: 1,
      accuracy: 0.5,
    });
    expect(overallAccuracy(answered)).toBeCloseTo(2 / 3);
    expect(missedTiles(answered)).toHaveLength(1);
    expect(overallAccuracy([])).toBe(0);
  });

  it("knows when every filled tile has been played", () => {
    const board = generateBoard(makeCatalog([{ domainId: "alpha", remember: 2 }]), {
      categories: ["alpha"],
      seed: "complete",
    });
    let state = soloReducer(initialSoloState(), { type: "board-ready", board });
    expect(board.filledTiles).toBe(2);
    expect(boardComplete(state)).toBe(false);
    for (const id of ["a", "b"]) {
      state = run(state, [
        { type: "question-opened", question: question(id), points: 200, at: 0 },
        { type: "option-selected", option: "B" },
        { type: "response-locked", at: 100 },
        { type: "answer-loaded", answer: answer(id, "B") },
        { type: "returned-to-board" },
      ]);
    }
    expect(boardComplete(state)).toBe(true);
  });
});
