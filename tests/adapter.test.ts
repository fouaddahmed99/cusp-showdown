import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertPairedVersions,
  buildTaxonomyIndex,
  loadCatalog,
  toShowdownAnswer,
  toShowdownQuestion,
} from "@/content/adapter";
import {
  ContentError,
  ContractVersionError,
  StaticJsonContentPack,
} from "@/content/store";
import { PublicAnswer, PublicManifest, PublicQuestion } from "@/contract/lrn-public-v1";
import { generateBoard } from "@/content/board";

const repoRoot = path.resolve(import.meta.dirname, "..");

/** Serves a pack from disk, so the adapter is exercised against real bundles. */
function diskPack(dir: string, origin: "lrn-approved" | "demo-sample") {
  return new StaticJsonContentPack({
    origin,
    baseUrl: "pack://",
    fetcher: async (url) => {
      const rel = url.replace("pack://", "");
      try {
        const text = await readFile(path.join(repoRoot, dir, rel), "utf8");
        return { ok: true, status: 200, json: async () => JSON.parse(text) as unknown };
      } catch {
        return { ok: false, status: 404, json: async () => ({}) };
      }
    },
  });
}

/** Serves whatever JSON the test hands it, for the failure cases. */
function stubPack(files: Record<string, unknown>, origin: "lrn-approved" | "demo-sample" = "lrn-approved") {
  return new StaticJsonContentPack({
    origin,
    baseUrl: "stub://",
    fetcher: async (url) => {
      const rel = url.replace("stub://", "");
      if (!(rel in files)) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => files[rel] };
    },
  });
}

const minimalManifest = (over: Record<string, unknown> = {}) => ({
  contractVersion: 1,
  contentVersion: "test-1",
  builtAt: "2026-01-01T00:00:00.000Z",
  sample: false,
  exam: {
    qe: { totalItems: 240, unscoredPretestItems: 40, durationMinutes: 240, miniMockSizes: [50] },
    oce: { sessions: 2, sessionMinutes: 60, examinersPerSession: 2 },
  },
  domains: [{ id: "alpha", name: "SAMPLE alpha", qeWeightPct: 10, oceWeightPct: 10 }],
  subtopics: [{ id: "sub", domainId: "alpha", name: "SAMPLE sub" }],
  taskStatements: [{ id: "ts", domainId: "alpha", text: "SAMPLE ts" }],
  counts: { mcq: 1 },
  stubFiles: ["stubs/alpha.json"],
  noteSubtopics: [],
  forms: [],
  ...over,
});

const sampleStub = {
  id: "itm_sample",
  version: 1,
  type: "mcq",
  tags: { domainId: "alpha", subtopicId: "sub", taskStatementId: "ts", cognitiveLevel: "remember" },
  hasMedia: false,
};

describe("the demo pack", () => {
  it("validates against the published contract and fills a 6x5 board", async () => {
    const pack = diskPack("public/content-demo", "demo-sample");
    const catalog = await loadCatalog(pack);

    expect(catalog.sample).toBe(true);
    expect(catalog.origin).toBe("demo-sample");
    expect(catalog.domains.length).toBeGreaterThanOrEqual(6);

    const categories = catalog.domains.slice(0, 6).map((d) => d.id);
    const board = generateBoard(catalog, { categories, seed: "demo-board" });
    expect(board.filledTiles).toBe(30);
    expect(board.shortfalls).toEqual([]);
  });

  it("is obviously labelled as demonstration content throughout", async () => {
    const pack = diskPack("public/content-demo", "demo-sample");
    const catalog = await loadCatalog(pack);
    const manifest = await pack.getManifest();
    const taxonomy = buildTaxonomyIndex(manifest);

    for (const item of catalog.items.slice(0, 12)) {
      const q = toShowdownQuestion(await pack.getQuestion(item.id), {
        origin: catalog.origin,
        contentVersion: catalog.contentVersion,
        taxonomy,
      });
      expect(q.stem).toContain("SAMPLE");
      expect(q.options.every((o) => o.text.includes("SAMPLE"))).toBe(true);
      expect(q.id.startsWith("demo_")).toBe(true);
    }
  });

  it("grades a demo item against its own published key", async () => {
    const pack = diskPack("public/content-demo", "demo-sample");
    const catalog = await loadCatalog(pack);
    const manifest = await pack.getManifest();
    const taxonomy = buildTaxonomyIndex(manifest);
    const first = catalog.items[0]!;

    const q = toShowdownQuestion(await pack.getQuestion(first.id), {
      origin: catalog.origin,
      contentVersion: catalog.contentVersion,
      taxonomy,
    });
    const a = toShowdownAnswer(await pack.getAnswer(first.id));
    assertPairedVersions(q, a);

    expect(q.options.map((o) => o.id)).toContain(a.key);
    expect(a.explanation.length).toBeGreaterThan(0);
    expect(a.explanation.every((s) => s.cites.length > 0)).toBe(true);
  });
});

describe("the vendored CUSP LRN bundle", () => {
  it("validates against the contract and reports exactly what is approved", async () => {
    const pack = diskPack("public/content-lrn", "lrn-approved");
    const catalog = await loadCatalog(pack);

    expect(catalog.contractVersion).toBe(1);
    expect(catalog.sample).toBe(false);
    // The real bank is small; the adapter must report its true size, whatever it is.
    expect(catalog.items.length).toBe(
      catalog.domains.reduce((sum, d) => sum + d.total, 0),
    );
    for (const item of catalog.items) {
      expect(catalog.domains.some((d) => d.id === item.domainId)).toBe(true);
    }
  });

  it("carries citations and a matching key for every approved item it plays", async () => {
    const pack = diskPack("public/content-lrn", "lrn-approved");
    const catalog = await loadCatalog(pack);
    const manifest = await pack.getManifest();
    const taxonomy = buildTaxonomyIndex(manifest);
    const sources = await pack.getSources();
    const sourceIds = new Set(sources.map((s) => s.id));

    for (const item of catalog.items) {
      const q = toShowdownQuestion(await pack.getQuestion(item.id), {
        origin: catalog.origin,
        contentVersion: catalog.contentVersion,
        taxonomy,
      });
      const a = toShowdownAnswer(await pack.getAnswer(item.id));
      assertPairedVersions(q, a);

      expect(q.stem.length).toBeGreaterThan(0);
      expect(q.options.length).toBeGreaterThanOrEqual(4);
      expect(q.options.map((o) => o.id)).toContain(a.key);
      // Every displayed sentence must cite a source that the bundle ships.
      for (const sentence of a.explanation) {
        expect(sentence.cites.length).toBeGreaterThan(0);
        for (const cite of sentence.cites) expect(sourceIds.has(cite.sourceId)).toBe(true);
      }
      expect(q.domainName).not.toBe(q.domainId);
    }
  });
});

describe("adapter safety", () => {
  it("refuses a bundle built for a newer contract version", async () => {
    const pack = stubPack({ "manifest.json": minimalManifest({ contractVersion: 2 }) });
    await expect(pack.getManifest()).rejects.toBeInstanceOf(ContractVersionError);
  });

  it("refuses a bundle that leaks an internal-only field", async () => {
    const pack = stubPack({
      "manifest.json": minimalManifest(),
      "stubs/alpha.json": [sampleStub],
      "q/itm_sample.json": {
        id: "itm_sample",
        version: 1,
        tags: sampleStub.tags,
        lastVerifiedAt: "2026-01-01T00:00:00.000Z",
        type: "mcq",
        stem: "SAMPLE stem",
        options: [
          { id: "A", text: "SAMPLE A" },
          { id: "B", text: "SAMPLE B" },
          { id: "C", text: "SAMPLE C" },
          { id: "D", text: "SAMPLE D" },
        ],
        supportingQuote: "an internal field that must never ship",
      },
    });
    await expect(pack.getQuestion("itm_sample")).rejects.toThrow(/internal-only field/);
  });

  it("refuses a question with an unexpected extra field", async () => {
    const pack = stubPack({
      "manifest.json": minimalManifest(),
      "q/itm_sample.json": {
        id: "itm_sample",
        version: 1,
        tags: sampleStub.tags,
        lastVerifiedAt: "2026-01-01T00:00:00.000Z",
        type: "mcq",
        stem: "SAMPLE stem",
        options: [
          { id: "A", text: "SAMPLE A" },
          { id: "B", text: "SAMPLE B" },
          { id: "C", text: "SAMPLE C" },
          { id: "D", text: "SAMPLE D" },
        ],
        difficulty: 4,
      },
    });
    await expect(pack.getQuestion("itm_sample")).rejects.toThrow(
      /does not match the published content contract/,
    );
  });

  it("refuses an MCQ with fewer than four options", () => {
    expect(() =>
      PublicQuestion.parse({
        id: "itm_sample",
        version: 1,
        tags: sampleStub.tags,
        lastVerifiedAt: "2026-01-01T00:00:00.000Z",
        type: "mcq",
        stem: "SAMPLE stem",
        options: [
          { id: "A", text: "SAMPLE A" },
          { id: "B", text: "SAMPLE B" },
        ],
      }),
    ).toThrow();
  });

  it("refuses an explanation sentence with no citation", () => {
    expect(() =>
      PublicAnswer.parse({
        id: "itm_sample",
        version: 1,
        type: "mcq",
        key: "A",
        rationales: {},
        explanation: [{ text: "SAMPLE uncited sentence", cites: [] }],
      }),
    ).toThrow();
  });

  it("will not grade a question against an answer from another item", () => {
    const q = toShowdownQuestion(
      PublicQuestion.parse({
        id: "itm_one",
        version: 1,
        tags: sampleStub.tags,
        lastVerifiedAt: "2026-01-01T00:00:00.000Z",
        type: "mcq",
        stem: "SAMPLE stem",
        options: [
          { id: "A", text: "SAMPLE A" },
          { id: "B", text: "SAMPLE B" },
          { id: "C", text: "SAMPLE C" },
          { id: "D", text: "SAMPLE D" },
        ],
      }),
      {
        origin: "lrn-approved",
        contentVersion: "v",
        taxonomy: buildTaxonomyIndex(PublicManifest.parse(minimalManifest())),
      },
    );
    const otherItem = toShowdownAnswer(
      PublicAnswer.parse({
        id: "itm_two",
        version: 1,
        type: "mcq",
        key: "A",
        rationales: {},
        explanation: [
          { text: "SAMPLE", cites: [{ sourceId: "src", page: null, section: "SAMPLE" }] },
        ],
      }),
    );
    expect(() => assertPairedVersions(q, otherItem)).toThrow(ContentError);

    const driftedVersion = { ...otherItem, id: "itm_one", version: 2 };
    expect(() => assertPairedVersions(q, driftedVersion)).toThrow(/changed while the game was open/);
  });

  it("refuses to play an item type that cannot sit on a tile", () => {
    const flashcard = PublicQuestion.parse({
      id: "itm_card",
      version: 1,
      tags: sampleStub.tags,
      lastVerifiedAt: "2026-01-01T00:00:00.000Z",
      type: "flashcard",
      front: "SAMPLE front",
    });
    expect(() =>
      toShowdownQuestion(flashcard, {
        origin: "lrn-approved",
        contentVersion: "v",
        taxonomy: buildTaxonomyIndex(PublicManifest.parse(minimalManifest())),
      }),
    ).toThrow(/cannot be played on a tile/);
  });

  it("reports a missing file as a content error, not a crash", async () => {
    const pack = stubPack({ "manifest.json": minimalManifest() });
    await expect(pack.getQuestion("itm_absent")).rejects.toBeInstanceOf(ContentError);
  });

  it("skips a stub whose domain the manifest does not list", async () => {
    const pack = stubPack({
      "manifest.json": minimalManifest(),
      "stubs/alpha.json": [
        sampleStub,
        { ...sampleStub, id: "itm_orphan", tags: { ...sampleStub.tags, domainId: "ghost" } },
      ],
    });
    const catalog = await loadCatalog(pack);
    expect(catalog.items.map((i) => i.id)).toEqual(["itm_sample"]);
  });

  it("ignores non-playable item types when counting availability", async () => {
    const pack = stubPack({
      "manifest.json": minimalManifest(),
      "stubs/alpha.json": [
        sampleStub,
        { ...sampleStub, id: "itm_card", type: "flashcard" },
        { ...sampleStub, id: "itm_note", type: "note_section" },
      ],
    });
    const catalog = await loadCatalog(pack);
    expect(catalog.items).toHaveLength(1);
    expect(catalog.domains[0]!.total).toBe(1);
  });
});
