import { asset } from "@/lib/base";
import { loadCatalog } from "./adapter";
import { StaticJsonContentPack, type ContentPack } from "./store";
import type { ContentCatalog, ContentOrigin } from "./types";

/**
 * Showdown reads two packs, and always says which one is on the board:
 *
 *   content-lrn/   the approved CUSP LRN bundle, vendored by
 *                  `pnpm content:sync`. Real reviewed questions with citations.
 *   content-demo/  generated SAMPLE filler, so the board, timer, buzzer and
 *                  scoring can be played before the approved bank is big
 *                  enough to fill 30 tiles.
 *
 * "approved" uses only the first pack and shows an honest shortfall when there
 * is not enough of it. "demo" uses only the second. "auto" prefers approved
 * content and falls back to the demo pack when nothing approved is playable.
 */
export type ContentChoice = "auto" | "approved" | "demo";

export const LRN_PACK_PATH = "content-lrn";
export const DEMO_PACK_PATH = "content-demo";

export function makePack(origin: ContentOrigin): ContentPack {
  return new StaticJsonContentPack({
    origin,
    baseUrl: asset(origin === "lrn-approved" ? LRN_PACK_PATH : DEMO_PACK_PATH),
  });
}

export interface ResolvedContent {
  pack: ContentPack;
  catalog: ContentCatalog;
  /** The approved catalog, whenever it could be read — even if demo is in play. */
  approved: ContentCatalog | null;
  /** Why this pack is the one on the board. */
  note: string | null;
  /** True when the board is running on labelled demo content. */
  isDemo: boolean;
}

/** Minimum approved items before "auto" will put the real bank on a board. */
export const MIN_APPROVED_FOR_AUTO = 30;

export async function resolveContent(choice: ContentChoice = "auto"): Promise<ResolvedContent> {
  if (choice === "demo") {
    const pack = makePack("demo-sample");
    return {
      pack,
      catalog: await loadCatalog(pack),
      approved: await tryApproved(),
      note: "Demo pack selected. Every question here is placeholder SAMPLE content.",
      isDemo: true,
    };
  }

  const approvedPack = makePack("lrn-approved");
  let approved: ContentCatalog | null = null;
  let approvedError: string | null = null;
  try {
    approved = await loadCatalog(approvedPack);
  } catch (error) {
    approvedError = error instanceof Error ? error.message : String(error);
  }

  if (choice === "approved") {
    if (!approved) {
      throw new Error(
        approvedError ??
          "The approved CUSP LRN bundle could not be read. Run `pnpm content:sync` to vendor it.",
      );
    }
    return {
      pack: approvedPack,
      catalog: approved,
      approved,
      note:
        approved.items.length < MIN_APPROVED_FOR_AUTO
          ? `Approved content only: ${approved.items.length} item${approved.items.length === 1 ? "" : "s"} ` +
            `in the bank, so most tiles will be empty.`
          : null,
      isDemo: false,
    };
  }

  // auto
  if (approved && approved.items.length >= MIN_APPROVED_FOR_AUTO) {
    return { pack: approvedPack, catalog: approved, approved, note: null, isDemo: false };
  }

  const demoPack = makePack("demo-sample");
  const demoCatalog = await loadCatalog(demoPack);
  const approvedCount = approved?.items.length ?? 0;
  return {
    pack: demoPack,
    catalog: demoCatalog,
    approved,
    note: approved
      ? `The approved bank holds ${approvedCount} playable item${approvedCount === 1 ? "" : "s"} — ` +
        `not enough for a full board yet, so this board runs on labelled demo content.`
      : `The approved bundle could not be read, so this board runs on labelled demo content.`,
    isDemo: true,
  };
}

async function tryApproved(): Promise<ContentCatalog | null> {
  try {
    return await loadCatalog(makePack("lrn-approved"));
  } catch {
    return null;
  }
}

export function choiceFromLocation(search: string): ContentChoice {
  const params = new URLSearchParams(search);
  const value = params.get("content");
  if (value === "demo" || value === "approved" || value === "auto") return value;
  return "auto";
}
