import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { boardItemIds, generateBoard, suggestCategories } from "@/content/board";
import { loadCatalog } from "@/content/adapter";
import { StaticJsonContentPack } from "@/content/store";
import { MIN_APPROVED_FOR_AUTO } from "@/content/source";

/**
 * Plays the vendored approved bundle through the board generator, so a content
 * sync that breaks board building fails here rather than in a seminar room.
 *
 * It adapts to the size of the bank: once there are enough approved items for a
 * full board, a full board is required.
 */
const root = path.resolve(import.meta.dirname, "..");

function approvedPack() {
  return new StaticJsonContentPack({
    origin: "lrn-approved",
    baseUrl: "pack://",
    fetcher: async (url) => {
      const rel = url.replace("pack://", "");
      try {
        const text = await readFile(path.join(root, "public", "content-lrn", rel), "utf8");
        return { ok: true, status: 200, json: async () => JSON.parse(text) as unknown };
      } catch {
        return { ok: false, status: 404, json: async () => ({}) };
      }
    },
  });
}

describe("the vendored approved bundle on a real board", () => {
  it("builds a six-category board without duplicates or fabrication", async () => {
    const catalog = await loadCatalog(approvedPack());
    const categories = suggestCategories(catalog, 6);
    const board = generateBoard(catalog, { categories, seed: "approved-board" });
    const ids = boardItemIds(board);

    // No item is ever on the board twice, whatever the bank's size.
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(board.filledTiles);

    // Any tile that could not be filled says why, rather than being padded.
    for (const column of board.columns) {
      for (const tile of column.tiles) {
        if (tile.state === "empty") {
          expect(tile.itemId).toBeUndefined();
          expect(tile.emptyReason ?? "").not.toBe("");
        } else {
          expect(tile.itemId).toBeTruthy();
        }
      }
    }

    // Once the bank is big enough for the app to pick approved content by
    // default, a full board must actually fill.
    if (catalog.items.length >= MIN_APPROVED_FOR_AUTO) {
      expect(board.filledTiles).toBe(30);
      expect(board.shortfalls).toEqual([]);
      expect(board.droppedCategories).toEqual([]);
    }
  });

  it("keeps every approved item playable: a key among its options, and cited sources", async () => {
    const pack = approvedPack();
    const catalog = await loadCatalog(pack);
    const sourceIds = new Set((await pack.getSources()).map((s) => s.id));

    for (const item of catalog.items) {
      const question = await pack.getQuestion(item.id);
      const answer = await pack.getAnswer(item.id);
      expect(question.version).toBe(answer.version);
      if (question.type === "flashcard" || question.type === "oce_vignette") continue;
      if (answer.type === "flashcard" || answer.type === "oce_vignette") continue;

      expect(question.options.map((o) => o.id)).toContain(answer.key);
      expect(answer.explanation.length).toBeGreaterThan(0);
      for (const sentence of answer.explanation) {
        expect(sentence.cites.length).toBeGreaterThan(0);
        for (const cite of sentence.cites) expect(sourceIds.has(cite.sourceId)).toBe(true);
      }
    }
  });
});
