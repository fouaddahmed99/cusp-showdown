import type { CognitiveLevel } from "@/contract/lrn-public-v1";
import type { CatalogItem, ContentCatalog } from "@/content/types";

/**
 * Test fixtures. Non-clinical by rule: every string here is obviously fake, so
 * fixture text can never be mistaken for reviewed content.
 */
export const DOMAIN_FIXTURES = [
  { id: "alpha", name: "SAMPLE category alpha", qeWeightPct: 20 },
  { id: "beta", name: "SAMPLE category beta", qeWeightPct: 15 },
  { id: "gamma", name: "SAMPLE category gamma", qeWeightPct: 10 },
  { id: "delta", name: "SAMPLE category delta", qeWeightPct: 5 },
];

export interface CellSpec {
  domainId: string;
  remember?: number;
  understand_apply?: number;
  analyze_evaluate?: number;
}

/** Builds a catalog with exactly the per-level counts asked for. */
export function makeCatalog(
  cells: CellSpec[],
  opts: { origin?: ContentCatalog["origin"]; sample?: boolean; contentVersion?: string } = {},
): ContentCatalog {
  const items: CatalogItem[] = [];
  const domains = cells.map((cell) => {
    const available: Record<CognitiveLevel, number> = {
      remember: cell.remember ?? 0,
      understand_apply: cell.understand_apply ?? 0,
      analyze_evaluate: cell.analyze_evaluate ?? 0,
    };
    for (const level of Object.keys(available) as CognitiveLevel[]) {
      for (let i = 0; i < available[level]; i += 1) {
        items.push({
          id: `item_${cell.domainId}_${level}_${i}`,
          version: 1,
          domainId: cell.domainId,
          cognitiveLevel: level,
          hasMedia: false,
        });
      }
    }
    const meta = DOMAIN_FIXTURES.find((d) => d.id === cell.domainId);
    return {
      id: cell.domainId,
      name: meta?.name ?? `SAMPLE category ${cell.domainId}`,
      qeWeightPct: meta?.qeWeightPct ?? 1,
      available,
      total: available.remember + available.understand_apply + available.analyze_evaluate,
    };
  });

  return {
    origin: opts.origin ?? "demo-sample",
    contentVersion: opts.contentVersion ?? "test-1",
    contractVersion: 1,
    sample: opts.sample ?? true,
    builtAt: "2026-01-01T00:00:00.000Z",
    domains,
    items,
  };
}

/** A catalog with plenty of everything: every tile in a 6x5 board can fill. */
export function fullCatalog(): ContentCatalog {
  return makeCatalog(
    DOMAIN_FIXTURES.map((d) => ({
      domainId: d.id,
      remember: 6,
      understand_apply: 6,
      analyze_evaluate: 6,
    })),
  );
}
