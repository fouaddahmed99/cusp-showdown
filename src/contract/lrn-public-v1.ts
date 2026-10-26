/**
 * CUSP LRN PUBLIC CONTENT CONTRACT — consumer copy, version 1.
 *
 * This mirrors `packages/contract/src/public/index.ts` in the private
 * `cusp-lrn-content` repo, which the publish workflow copies verbatim into
 * `cusp-lrn-web/src/contract/`. Showdown reads the same published bundle, so it
 * validates against the same shapes.
 *
 * RULES FOR THIS FILE
 * - It is a *read* contract. Showdown never writes content in these shapes.
 * - Every object is `.strict()`, exactly as upstream: an unexpected (possibly
 *   internal) field must fail validation rather than render.
 * - Only edit it to track an upstream contract change, and bump
 *   SUPPORTED_CONTRACT_VERSION when the upstream version changes, so a newer
 *   bundle fails loudly instead of being silently misread.
 */
import { z } from "zod";

/** The upstream `contractVersion` this adapter understands. */
export const SUPPORTED_CONTRACT_VERSION = 1;

/** Keys that must never appear in a public bundle. Mirrors upstream's leak scan. */
export const FORBIDDEN_PUBLIC_KEYS = [
  "supportingQuote",
  "chunkId",
  "chunkText",
  "discoveredViaLead",
  "leadClaimIds",
  "leadDocId",
  "claimText",
  "provenance",
  "claims",
  "passages",
  "verificationRef",
  "solver",
  "attestation",
  "licenseEvidence",
] as const;

const Id = z.string().min(1);
const IsoDateTime = z.string().min(1);
const Url = z.string().url();

export const CognitiveLevel = z.enum(["remember", "understand_apply", "analyze_evaluate"]);
export type CognitiveLevel = z.infer<typeof CognitiveLevel>;

export const OptionId = z.enum(["A", "B", "C", "D", "E"]);
export type OptionId = z.infer<typeof OptionId>;

export const ItemType = z.enum([
  "mcq",
  "vignette_mcq",
  "image_mcq",
  "flashcard",
  "note_section",
  "oce_vignette",
]);
export type ItemType = z.infer<typeof ItemType>;

export const PublicSource = z
  .object({
    id: Id,
    title: z.string(),
    organization: z.string(),
    year: z.number().int(),
    versionLabel: z.string(),
    url: Url,
    licenseLabel: z.string(),
    attribution: z.string().optional(),
  })
  .strict();
export type PublicSource = z.infer<typeof PublicSource>;

export const PublicCitation = z
  .object({ sourceId: Id, page: z.number().int().positive().nullable(), section: z.string() })
  .strict();
export type PublicCitation = z.infer<typeof PublicCitation>;

export const PublicSentence = z
  .object({ text: z.string(), cites: z.array(PublicCitation).min(1) })
  .strict();
export type PublicSentence = z.infer<typeof PublicSentence>;

export const PublicTags = z
  .object({
    domainId: Id,
    subtopicId: Id,
    taskStatementId: Id,
    cognitiveLevel: CognitiveLevel,
  })
  .strict();
export type PublicTags = z.infer<typeof PublicTags>;

export const PublicMedia = z
  .object({
    src: z.string(),
    alt: z.string(),
    caption: z.string().optional(),
    attribution: z.string().optional(),
  })
  .strict();
export type PublicMedia = z.infer<typeof PublicMedia>;

export const PublicItemStub = z
  .object({
    id: Id,
    version: z.number().int().positive(),
    type: ItemType,
    tags: PublicTags,
    hasMedia: z.boolean(),
  })
  .strict();
export type PublicItemStub = z.infer<typeof PublicItemStub>;

const qBase = {
  id: Id,
  version: z.number().int().positive(),
  tags: PublicTags,
  lastVerifiedAt: IsoDateTime,
};

export const PublicQuestion = z.discriminatedUnion("type", [
  z
    .object({
      ...qBase,
      type: z.enum(["mcq", "vignette_mcq", "image_mcq"]),
      vignette: z.string().optional(),
      stem: z.string(),
      options: z.array(z.object({ id: OptionId, text: z.string() }).strict()).min(4).max(5),
      media: z.array(PublicMedia).optional(),
    })
    .strict(),
  z.object({ ...qBase, type: z.literal("flashcard"), front: z.string() }).strict(),
  z
    .object({
      ...qBase,
      type: z.literal("oce_vignette"),
      presentation: z.string(),
      timeLimitSec: z.number().int().positive(),
      questions: z.array(z.string()).min(5).max(8),
    })
    .strict(),
]);
export type PublicQuestion = z.infer<typeof PublicQuestion>;

export const PublicAnswer = z.discriminatedUnion("type", [
  z
    .object({
      id: Id,
      version: z.number().int().positive(),
      type: z.enum(["mcq", "vignette_mcq", "image_mcq"]),
      key: OptionId,
      rationales: z.partialRecord(OptionId, z.array(PublicSentence)),
      explanation: z.array(PublicSentence).min(1),
    })
    .strict(),
  z
    .object({
      id: Id,
      version: z.number().int().positive(),
      type: z.literal("flashcard"),
      back: z.array(PublicSentence).min(1),
    })
    .strict(),
  z
    .object({
      id: Id,
      version: z.number().int().positive(),
      type: z.literal("oce_vignette"),
      prompts: z
        .array(
          z
            .object({
              modelAnswer: z.array(PublicSentence).min(1),
              score2Gaps: z.array(z.string()),
              rubric: z.object({ "3": z.string(), "2": z.string(), "1": z.string() }).strict(),
            })
            .strict(),
        )
        .min(5)
        .max(8),
    })
    .strict(),
]);
export type PublicAnswer = z.infer<typeof PublicAnswer>;

export const PublicExamForm = z
  .object({
    id: Id,
    name: z.string(),
    kind: z.enum(["full", "mini100", "mini50"]),
    itemIds: z.array(Id),
    shortfall: z.array(
      z
        .object({ domainId: Id, target: z.number().int(), available: z.number().int() })
        .strict(),
    ),
  })
  .strict();
export type PublicExamForm = z.infer<typeof PublicExamForm>;

export const PublicManifest = z
  .object({
    contractVersion: z.number().int().positive(),
    contentVersion: z.string(),
    builtAt: IsoDateTime,
    sample: z.boolean(),
    exam: z
      .object({
        qe: z
          .object({
            totalItems: z.number().int(),
            unscoredPretestItems: z.number().int(),
            durationMinutes: z.number().int(),
            miniMockSizes: z.array(z.number().int()),
          })
          .strict(),
        oce: z
          .object({
            sessions: z.number().int(),
            sessionMinutes: z.number().int(),
            examinersPerSession: z.number().int(),
          })
          .strict(),
      })
      .strict(),
    domains: z.array(
      z
        .object({
          id: Id,
          name: z.string(),
          qeWeightPct: z.number(),
          oceWeightPct: z.number(),
        })
        .strict(),
    ),
    subtopics: z.array(z.object({ id: Id, domainId: Id, name: z.string() }).strict()),
    taskStatements: z.array(z.object({ id: Id, domainId: Id, text: z.string() }).strict()),
    counts: z.partialRecord(ItemType, z.number().int().nonnegative()),
    stubFiles: z.array(z.string()),
    noteSubtopics: z.array(Id),
    forms: z.array(
      z
        .object({
          id: Id,
          name: z.string(),
          kind: z.enum(["full", "mini100", "mini50"]),
          size: z.number().int(),
        })
        .strict(),
    ),
  })
  .strict();
export type PublicManifest = z.infer<typeof PublicManifest>;

/** Recursively collect every object key in a JSON value. */
export function collectKeys(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => collectKeys(v, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      collectKeys(v, out);
    }
  }
  return out;
}

/** Returns the forbidden keys present in a JSON value. Empty means clean. */
export function findForbiddenKeys(value: unknown): string[] {
  const keys = collectKeys(value);
  return FORBIDDEN_PUBLIC_KEYS.filter((k) => keys.has(k));
}

/** MCQ-like question types are the only ones a Showdown tile can hold. */
export function isMcqLike(
  q: PublicQuestion,
): q is Extract<PublicQuestion, { type: "mcq" | "vignette_mcq" | "image_mcq" }> {
  return q.type === "mcq" || q.type === "vignette_mcq" || q.type === "image_mcq";
}
