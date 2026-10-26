import { describe, expect, it } from "vitest";
import {
  boardItemIds,
  generateBoard,
  isPlayable,
  seededRandom,
  shuffled,
  suggestCategories,
} from "@/content/board";
import { ROW_SPECS } from "@/content/difficulty";
import { DOMAIN_FIXTURES, fullCatalog, makeCatalog } from "./fixtures";

const ALL_CATEGORIES = DOMAIN_FIXTURES.map((d) => d.id);

describe("board generation", () => {
  it("fills every tile when the bank has enough approved items", () => {
    const board = generateBoard(fullCatalog(), { categories: ALL_CATEGORIES, seed: "s1" });
    expect(board.columns).toHaveLength(ALL_CATEGORIES.length);
    expect(board.filledTiles).toBe(ALL_CATEGORIES.length * ROW_SPECS.length);
    expect(board.requestedTiles).toBe(board.filledTiles);
    expect(board.shortfalls).toEqual([]);
    for (const column of board.columns) {
      expect(column.tiles.map((t) => t.points)).toEqual([200, 400, 600, 800, 1000]);
      expect(column.tiles.every((t) => t.state === "filled")).toBe(true);
    }
  });

  it("never places the same item id twice on one board", () => {
    const board = generateBoard(fullCatalog(), { categories: ALL_CATEGORIES, seed: "dupes" });
    const ids = boardItemIds(board);
    expect(ids).toHaveLength(board.filledTiles);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives each row its own reviewed cognitive level when stock allows", () => {
    const catalog = makeCatalog([
      { domainId: "alpha", remember: 2, understand_apply: 2, analyze_evaluate: 1 },
    ]);
    const board = generateBoard(catalog, { categories: ["alpha"], seed: "levels" });
    const column = board.columns[0]!;
    expect(column.tiles.every((t) => t.state === "filled")).toBe(true);
    expect(column.tiles.every((t) => t.substitutedLevel === undefined)).toBe(true);
    const levels = column.tiles.map((t) => t.rowLevel);
    expect(levels).toEqual([
      "remember",
      "remember",
      "understand_apply",
      "understand_apply",
      "analyze_evaluate",
    ]);
  });

  it("marks a tile when it had to borrow from an adjacent level", () => {
    // Four 'remember' items and nothing else: the harder rows must borrow.
    const catalog = makeCatalog([{ domainId: "alpha", remember: 5 }]);
    const board = generateBoard(catalog, { categories: ["alpha"], seed: "borrow" });
    const column = board.columns[0]!;
    expect(column.tiles.filter((t) => t.state === "filled")).toHaveLength(5);
    const borrowed = column.tiles.filter((t) => t.substitutedLevel);
    expect(borrowed).toHaveLength(3);
    expect(borrowed.every((t) => t.substitutedLevel === "remember")).toBe(true);
  });

  it("leaves tiles empty with a reason rather than padding a thin category", () => {
    const catalog = makeCatalog([
      { domainId: "alpha", remember: 6, understand_apply: 6, analyze_evaluate: 6 },
      { domainId: "beta", remember: 2 },
    ]);
    const board = generateBoard(catalog, { categories: ["alpha", "beta"], seed: "thin" });
    const beta = board.columns.find((c) => c.domainId === "beta")!;
    expect(beta.tiles.filter((t) => t.state === "filled")).toHaveLength(2);
    const empty = beta.tiles.filter((t) => t.state === "empty");
    expect(empty).toHaveLength(3);
    expect(empty.every((t) => t.itemId === undefined)).toBe(true);
    expect(empty.every((t) => (t.emptyReason ?? "").length > 0)).toBe(true);

    const shortfall = board.shortfalls.find((s) => s.domainId === "beta")!;
    expect(shortfall).toMatchObject({ requested: 5, filled: 2, available: 2 });
    expect(board.filledTiles).toBe(7);
    expect(board.requestedTiles).toBe(10);
  });

  it("reports a category with no approved content at all", () => {
    const catalog = makeCatalog([
      { domainId: "alpha", remember: 6, understand_apply: 6, analyze_evaluate: 6 },
      { domainId: "beta" },
    ]);
    const board = generateBoard(catalog, { categories: ["alpha", "beta"], seed: "empty" });
    const beta = board.columns.find((c) => c.domainId === "beta")!;
    expect(beta.tiles.every((t) => t.state === "empty")).toBe(true);
    const shortfall = board.shortfalls.find((s) => s.domainId === "beta")!;
    expect(shortfall.filled).toBe(0);
    expect(shortfall.detail).toContain("no approved items");
  });

  it("drops a category that is not in the published taxonomy", () => {
    const board = generateBoard(fullCatalog(), {
      categories: ["alpha", "not-a-real-domain"],
      seed: "unknown",
    });
    expect(board.columns.map((c) => c.domainId)).toEqual(["alpha"]);
    expect(board.droppedCategories).toHaveLength(1);
    expect(board.droppedCategories[0]!.domainId).toBe("not-a-real-domain");
  });

  it("honours a difficulty filter and reports what it cost", () => {
    const catalog = makeCatalog([
      { domainId: "alpha", remember: 6, understand_apply: 6, analyze_evaluate: 1 },
    ]);
    const board = generateBoard(catalog, {
      categories: ["alpha"],
      levels: ["analyze_evaluate"],
      seed: "filtered",
    });
    const column = board.columns[0]!;
    expect(column.tiles.filter((t) => t.state === "filled")).toHaveLength(1);
    expect(board.shortfalls[0]!.available).toBe(1);
  });

  it("excludes items already used earlier in the session", () => {
    const catalog = fullCatalog();
    const first = generateBoard(catalog, { categories: ALL_CATEGORIES, seed: "a" });
    const used = boardItemIds(first);
    const second = generateBoard(catalog, {
      categories: ALL_CATEGORIES,
      seed: "b",
      exclude: used,
    });
    const overlap = boardItemIds(second).filter((id) => used.includes(id));
    expect(overlap).toEqual([]);
  });

  it("is reproducible from its seed and varies across seeds", () => {
    const catalog = fullCatalog();
    const a = generateBoard(catalog, { categories: ALL_CATEGORIES, seed: "same" });
    const b = generateBoard(catalog, { categories: ALL_CATEGORIES, seed: "same" });
    const c = generateBoard(catalog, { categories: ALL_CATEGORIES, seed: "different" });
    expect(boardItemIds(a)).toEqual(boardItemIds(b));
    expect(boardItemIds(a)).not.toEqual(boardItemIds(c));
  });

  it("treats a board with no questions as unplayable", () => {
    const board = generateBoard(makeCatalog([{ domainId: "alpha" }]), {
      categories: ["alpha"],
      seed: "none",
    });
    expect(isPlayable(board)).toBe(false);
  });

  it("suggests the categories with the most approved content", () => {
    const catalog = makeCatalog([
      { domainId: "alpha", remember: 1 },
      { domainId: "beta", remember: 9 },
      { domainId: "gamma", remember: 4 },
      { domainId: "delta" },
    ]);
    expect(suggestCategories(catalog, 2)).toEqual(["beta", "gamma"]);
    // A category with nothing approved is never suggested.
    expect(suggestCategories(catalog, 10)).not.toContain("delta");
  });
});

describe("seeded shuffling", () => {
  it("permutes without losing or duplicating members", () => {
    const input = Array.from({ length: 50 }, (_, i) => i);
    const out = shuffled(input, seededRandom("shuffle"));
    expect(out).toHaveLength(input.length);
    expect([...out].sort((a, b) => a - b)).toEqual(input);
    expect(out).not.toEqual(input);
  });

  it("produces the same sequence for the same seed", () => {
    const a = seededRandom("seed-1");
    const b = seededRandom("seed-1");
    const left = [a(), a(), a()];
    const right = [b(), b(), b()];
    expect(left).toEqual(right);
    expect(left.every((n) => n >= 0 && n < 1)).toBe(true);
  });
});
