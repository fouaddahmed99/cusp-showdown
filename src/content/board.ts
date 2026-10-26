import type { CognitiveLevel } from "@/contract/lrn-public-v1";
import { ROW_SPECS, type PointValue } from "./difficulty";
import type { CatalogItem, ContentCatalog } from "./types";

/**
 * BOARD GENERATOR
 *
 * Plans a board from availability counts alone, before any question body is
 * fetched. Rules it will not break:
 *
 *  1. Every tile holds a distinct approved item id. No id appears twice on a
 *     board, so no question can come up twice in a game.
 *  2. A tile is filled only from an item that exists in the catalog. If a
 *     column runs out of approved items, the remaining tiles come back `empty`
 *     with a reason — they are never padded, and nothing is generated to fill
 *     them.
 *  3. Rows prefer their own reviewed cognitive level. A tile filled from an
 *     adjacent level carries `substitutedLevel` so the UI can say so.
 *  4. Selection is seeded, so a board is reproducible from its seed.
 */

export interface BoardTile {
  points: PointValue;
  /** The cognitive level this row advertises. */
  rowLevel: CognitiveLevel;
  state: "filled" | "empty";
  itemId?: string;
  itemVersion?: number;
  /** Set when the item's level differs from the row's level. */
  substitutedLevel?: CognitiveLevel;
  /** Why this tile could not be filled. */
  emptyReason?: string;
}

export interface BoardColumn {
  domainId: string;
  domainName: string;
  tiles: BoardTile[];
}

export interface CategoryShortfall {
  domainId: string;
  domainName: string;
  requested: number;
  filled: number;
  /** Approved items available in this domain at board time. */
  available: number;
  detail: string;
}

export interface GeneratedBoard {
  seed: string;
  contentOrigin: ContentCatalog["origin"];
  contentVersion: string;
  columns: BoardColumn[];
  shortfalls: CategoryShortfall[];
  /** Tiles actually holding a question. */
  filledTiles: number;
  /** Tiles the board wanted. */
  requestedTiles: number;
  /** Set when a category could not be used at all. */
  droppedCategories: { domainId: string; domainName: string; reason: string }[];
}

export interface BoardRequest {
  /** Domain ids to use as columns, in order. */
  categories: string[];
  /** Point rows to include. Defaults to all five. */
  rows?: PointValue[];
  seed?: string;
  /** Restrict to these cognitive levels (the difficulty filter). */
  levels?: CognitiveLevel[];
  /** Item ids already used earlier in the same session, to keep boards distinct. */
  exclude?: Iterable<string>;
}

/** Deterministic 32-bit string hash, for seeding. */
function hashSeed(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32 — small, fast, good enough for shuffling a board. */
export function seededRandom(seed: string): () => number {
  let a = hashSeed(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const a = out[i] as T;
    const b = out[j] as T;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

export function defaultSeed(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Builds the board. Pure: same catalog + same request + same seed gives the
 * same board.
 */
export function generateBoard(catalog: ContentCatalog, request: BoardRequest): GeneratedBoard {
  const seed = request.seed ?? defaultSeed();
  const rows = request.rows ?? ROW_SPECS.map((r) => r.points);
  const levelFilter = request.levels ? new Set(request.levels) : null;
  const used = new Set<string>(request.exclude ?? []);
  const rng = seededRandom(seed);

  const domainsById = new Map(catalog.domains.map((d) => [d.id, d]));

  // Pool of selectable items per domain, per level, shuffled once per board.
  const pools = new Map<string, Map<CognitiveLevel, CatalogItem[]>>();
  for (const item of catalog.items) {
    if (levelFilter && !levelFilter.has(item.cognitiveLevel)) continue;
    if (used.has(item.id)) continue;
    let byLevel = pools.get(item.domainId);
    if (!byLevel) {
      byLevel = new Map();
      pools.set(item.domainId, byLevel);
    }
    const list = byLevel.get(item.cognitiveLevel);
    if (list) list.push(item);
    else byLevel.set(item.cognitiveLevel, [item]);
  }
  for (const byLevel of pools.values()) {
    for (const [level, list] of byLevel) byLevel.set(level, shuffled(list, rng));
  }

  const take = (domainId: string, level: CognitiveLevel): CatalogItem | undefined => {
    const list = pools.get(domainId)?.get(level);
    while (list && list.length) {
      const next = list.pop();
      if (next && !used.has(next.id)) return next;
    }
    return undefined;
  };

  const columns: BoardColumn[] = [];
  const shortfalls: CategoryShortfall[] = [];
  const droppedCategories: GeneratedBoard["droppedCategories"] = [];
  let filledTiles = 0;

  for (const domainId of request.categories) {
    const domain = domainsById.get(domainId);
    if (!domain) {
      droppedCategories.push({
        domainId,
        domainName: domainId,
        reason: "This category is not in the published content taxonomy.",
      });
      continue;
    }

    const tiles: BoardTile[] = [];
    let columnFilled = 0;

    for (const points of rows) {
      const spec = ROW_SPECS.find((r) => r.points === points);
      if (!spec) continue;
      const order = levelFilter
        ? spec.preferenceOrder.filter((l) => levelFilter.has(l))
        : spec.preferenceOrder;

      let picked: { item: CatalogItem; level: CognitiveLevel } | undefined;
      for (const level of order) {
        const item = take(domainId, level);
        if (item) {
          picked = { item, level };
          break;
        }
      }

      if (!picked) {
        tiles.push({
          points,
          rowLevel: spec.level,
          state: "empty",
          emptyReason: `No approved ${domain.name} item is available for this row.`,
        });
        continue;
      }

      used.add(picked.item.id);
      columnFilled += 1;
      filledTiles += 1;
      tiles.push({
        points,
        rowLevel: spec.level,
        state: "filled",
        itemId: picked.item.id,
        itemVersion: picked.item.version,
        ...(picked.level === spec.level ? {} : { substitutedLevel: picked.level }),
      });
    }

    columns.push({ domainId, domainName: domain.name, tiles });

    if (columnFilled < rows.length) {
      const available = levelFilter
        ? [...levelFilter].reduce((sum, l) => sum + domain.available[l], 0)
        : domain.total;
      shortfalls.push({
        domainId,
        domainName: domain.name,
        requested: rows.length,
        filled: columnFilled,
        available,
        detail:
          columnFilled === 0
            ? `${domain.name} has no approved items matching this board's filters.`
            : `${domain.name} filled ${columnFilled} of ${rows.length} tiles — ` +
              `${available} approved item${available === 1 ? "" : "s"} available.`,
      });
    }
  }

  return {
    seed,
    contentOrigin: catalog.origin,
    contentVersion: catalog.contentVersion,
    columns,
    shortfalls,
    filledTiles,
    requestedTiles: request.categories.length * rows.length,
    droppedCategories,
  };
}

/**
 * Picks the categories for a default board: the domains with the most approved
 * content first, so the fullest possible board is offered. Ties break on the
 * exam blueprint weight, then on id, so the choice is stable.
 */
export function suggestCategories(catalog: ContentCatalog, count: number): string[] {
  return catalog.domains
    .filter((d) => d.total > 0)
    .sort(
      (a, b) =>
        b.total - a.total || b.qeWeightPct - a.qeWeightPct || a.id.localeCompare(b.id),
    )
    .slice(0, count)
    .map((d) => d.id);
}

/** Every item id on a board, for the "no repeats across replays" check. */
export function boardItemIds(board: GeneratedBoard): string[] {
  return board.columns.flatMap((c) =>
    c.tiles.filter((t) => t.state === "filled" && t.itemId).map((t) => t.itemId as string),
  );
}

/** A board worth playing has at least one question on it. */
export function isPlayable(board: GeneratedBoard): boolean {
  return board.filledTiles > 0;
}
