import type {
  CognitiveLevel,
  OptionId,
  PublicCitation,
  PublicMedia,
  PublicSentence,
  PublicSource,
} from "@/contract/lrn-public-v1";

/** Which content pack a question came from. Shown to the user, never hidden. */
export type ContentOrigin = "lrn-approved" | "demo-sample";

/**
 * A question in the shape Showdown plays. Produced only by the adapter from an
 * already-approved published item: the adapter copies text verbatim and never
 * rewrites, shortens, or supplies missing fields.
 */
export interface ShowdownQuestion {
  /** Stable upstream item id. Unique within a board. */
  id: string;
  /** Upstream item version — part of the identity of the content shown. */
  version: number;
  origin: ContentOrigin;
  /** Upstream content bundle version this item was read from. */
  contentVersion: string;
  domainId: string;
  domainName: string;
  subtopicId: string;
  subtopicName: string;
  taskStatementId: string;
  cognitiveLevel: CognitiveLevel;
  /** Longer case presentation shown above the stem, when the item has one. */
  vignette?: string;
  stem: string;
  options: { id: OptionId; text: string }[];
  media?: PublicMedia[];
  lastVerifiedAt: string;
}

/** The answer side, loaded only once a response is locked in. */
export interface ShowdownAnswer {
  id: string;
  version: number;
  key: OptionId;
  explanation: PublicSentence[];
  rationales: Partial<Record<OptionId, PublicSentence[]>>;
}

/** A cited source, for the citation line under an explanation. */
export type ShowdownSource = PublicSource;

export interface ContentCatalogDomain {
  id: string;
  name: string;
  qeWeightPct: number;
  /** Approved MCQ-like items available, by cognitive level. */
  available: Record<CognitiveLevel, number>;
  total: number;
}

/**
 * Everything the board generator needs without loading question bodies: the
 * taxonomy plus per-domain/level availability counts.
 */
export interface ContentCatalog {
  origin: ContentOrigin;
  contentVersion: string;
  contractVersion: number;
  /** True when the upstream bundle itself is flagged as sample/demo content. */
  sample: boolean;
  builtAt: string;
  domains: ContentCatalogDomain[];
  /** Playable MCQ-like stubs, keyed for selection. */
  items: CatalogItem[];
}

export interface CatalogItem {
  id: string;
  version: number;
  domainId: string;
  cognitiveLevel: CognitiveLevel;
  hasMedia: boolean;
}

export interface CitationRef extends PublicCitation {
  source?: ShowdownSource;
}
