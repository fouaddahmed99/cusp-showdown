import {
  isMcqLike,
  type CognitiveLevel,
  type PublicAnswer,
  type PublicManifest,
  type PublicQuestion,
} from "@/contract/lrn-public-v1";
import { ContentError, type ContentPack } from "./store";
import type {
  CatalogItem,
  ContentCatalog,
  ContentCatalogDomain,
  ShowdownAnswer,
  ShowdownQuestion,
  ShowdownSource,
} from "./types";

export const COGNITIVE_LEVELS: CognitiveLevel[] = [
  "remember",
  "understand_apply",
  "analyze_evaluate",
];

export const COGNITIVE_LEVEL_LABEL: Record<CognitiveLevel, string> = {
  remember: "Remember",
  understand_apply: "Understand / Apply",
  analyze_evaluate: "Analyze / Evaluate",
};

/** Only these item types can sit on a tile; the rest of the bank is untouched. */
const PLAYABLE_TYPES = new Set(["mcq", "vignette_mcq", "image_mcq"]);

function emptyLevelCounts(): Record<CognitiveLevel, number> {
  return { remember: 0, understand_apply: 0, analyze_evaluate: 0 };
}

/**
 * Reads a pack's manifest and stubs into a catalog: taxonomy plus availability
 * counts, with no question bodies loaded. This is what the board generator
 * plans against, so it can report a shortfall before anything is fetched.
 */
export async function loadCatalog(pack: ContentPack): Promise<ContentCatalog> {
  const manifest = await pack.getManifest();
  const stubs = await pack.listStubs();

  const playable = stubs.filter((s) => PLAYABLE_TYPES.has(s.type));
  const byDomain = new Map<string, ContentCatalogDomain>();
  for (const d of manifest.domains) {
    byDomain.set(d.id, {
      id: d.id,
      name: d.name,
      qeWeightPct: d.qeWeightPct,
      available: emptyLevelCounts(),
      total: 0,
    });
  }

  const items: CatalogItem[] = [];
  for (const stub of playable) {
    const domain = byDomain.get(stub.tags.domainId);
    if (!domain) {
      // A stub tagged with a domain the manifest does not list is a bundle
      // inconsistency. Skip it rather than inventing a category for it.
      continue;
    }
    domain.available[stub.tags.cognitiveLevel] += 1;
    domain.total += 1;
    items.push({
      id: stub.id,
      version: stub.version,
      domainId: stub.tags.domainId,
      cognitiveLevel: stub.tags.cognitiveLevel,
      hasMedia: stub.hasMedia,
    });
  }

  return {
    origin: pack.origin,
    contentVersion: manifest.contentVersion,
    contractVersion: manifest.contractVersion,
    sample: manifest.sample,
    builtAt: manifest.builtAt,
    domains: [...byDomain.values()],
    items,
  };
}

/** Name lookups so a question can show its domain and subtopic in full. */
export interface TaxonomyIndex {
  domainName(id: string): string;
  subtopicName(id: string): string;
}

export function buildTaxonomyIndex(manifest: PublicManifest): TaxonomyIndex {
  const domains = new Map(manifest.domains.map((d) => [d.id, d.name]));
  const subtopics = new Map(manifest.subtopics.map((s) => [s.id, s.name]));
  return {
    domainName: (id) => domains.get(id) ?? id,
    subtopicName: (id) => subtopics.get(id) ?? id,
  };
}

/**
 * Maps one published question onto the playing shape. Text is copied verbatim:
 * no truncation, no rewording, no filling in of absent fields. An item that is
 * not MCQ-like cannot be played, and that is an error rather than a fallback.
 */
export function toShowdownQuestion(
  q: PublicQuestion,
  ctx: { origin: ContentCatalog["origin"]; contentVersion: string; taxonomy: TaxonomyIndex },
): ShowdownQuestion {
  if (!isMcqLike(q)) {
    throw new ContentError(`Item ${q.id} is a ${q.type}, which cannot be played on a tile.`);
  }
  return {
    id: q.id,
    version: q.version,
    origin: ctx.origin,
    contentVersion: ctx.contentVersion,
    domainId: q.tags.domainId,
    domainName: ctx.taxonomy.domainName(q.tags.domainId),
    subtopicId: q.tags.subtopicId,
    subtopicName: ctx.taxonomy.subtopicName(q.tags.subtopicId),
    taskStatementId: q.tags.taskStatementId,
    cognitiveLevel: q.tags.cognitiveLevel,
    ...(q.vignette ? { vignette: q.vignette } : {}),
    stem: q.stem,
    options: q.options.map((o) => ({ id: o.id, text: o.text })),
    ...(q.media?.length ? { media: q.media } : {}),
    lastVerifiedAt: q.lastVerifiedAt,
  };
}

/** Maps one published answer onto the reveal shape, verbatim. */
export function toShowdownAnswer(a: PublicAnswer): ShowdownAnswer {
  if (a.type === "flashcard" || a.type === "oce_vignette") {
    throw new ContentError(`Answer ${a.id} is a ${a.type}, which cannot be graded on a tile.`);
  }
  return {
    id: a.id,
    version: a.version,
    key: a.key,
    explanation: a.explanation,
    rationales: a.rationales,
  };
}

/**
 * Guards against a question and answer drifting apart. Upstream invalidates
 * verification when content changes, so a version mismatch means the bundle
 * moved under us and the item must not be graded.
 */
export function assertPairedVersions(q: ShowdownQuestion, a: ShowdownAnswer): void {
  if (q.id !== a.id) throw new ContentError(`Answer ${a.id} does not belong to question ${q.id}.`);
  if (q.version !== a.version) {
    throw new ContentError(
      `Item ${q.id} changed while the game was open (question v${q.version}, answer v${a.version}). ` +
        `It was not graded.`,
    );
  }
}

/** Only stubs that exist in the catalog can be requested. */
export function catalogItemIds(catalog: ContentCatalog): Set<string> {
  return new Set(catalog.items.map((i) => i.id));
}

export function indexSources(sources: ShowdownSource[]): Map<string, ShowdownSource> {
  return new Map(sources.map((s) => [s.id, s]));
}
