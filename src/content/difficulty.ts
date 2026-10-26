import type { CognitiveLevel } from "@/contract/lrn-public-v1";

/**
 * DIFFICULTY MAPPING — read this before changing a row.
 *
 * The published CUSP LRN contract has no difficulty score. The only difficulty
 * metadata on an approved item is `tags.cognitiveLevel`, which has three
 * values. A board has five point rows, so the five rows are mapped onto the
 * three reviewed levels; nothing is interpolated and no new difficulty signal
 * is invented.
 *
 *   200  →  remember
 *   400  →  remember
 *   600  →  understand_apply
 *   800  →  understand_apply
 *  1000  →  analyze_evaluate
 *
 * Within a row, `preferenceOrder` is the order the generator will look for a
 * substitute when the exact level has no approved item left. A substitute is
 * always recorded on the tile so the player can see the row was filled from an
 * adjacent level rather than from the level the row advertises.
 */
export const POINT_VALUES = [200, 400, 600, 800, 1000] as const;
export type PointValue = (typeof POINT_VALUES)[number];

export interface RowSpec {
  points: PointValue;
  level: CognitiveLevel;
  /** Exact level first, then nearest levels. */
  preferenceOrder: CognitiveLevel[];
}

export const ROW_SPECS: readonly RowSpec[] = [
  {
    points: 200,
    level: "remember",
    preferenceOrder: ["remember", "understand_apply", "analyze_evaluate"],
  },
  {
    points: 400,
    level: "remember",
    preferenceOrder: ["remember", "understand_apply", "analyze_evaluate"],
  },
  {
    points: 600,
    level: "understand_apply",
    preferenceOrder: ["understand_apply", "remember", "analyze_evaluate"],
  },
  {
    points: 800,
    level: "understand_apply",
    preferenceOrder: ["understand_apply", "analyze_evaluate", "remember"],
  },
  {
    points: 1000,
    level: "analyze_evaluate",
    preferenceOrder: ["analyze_evaluate", "understand_apply", "remember"],
  },
] as const;

export function rowSpecFor(points: PointValue): RowSpec {
  const spec = ROW_SPECS.find((r) => r.points === points);
  if (!spec) throw new Error(`No board row is worth ${points} points.`);
  return spec;
}

/** How many items of each level a full 5-row column wants. */
export function levelDemandPerColumn(): Record<CognitiveLevel, number> {
  const demand: Record<CognitiveLevel, number> = {
    remember: 0,
    understand_apply: 0,
    analyze_evaluate: 0,
  };
  for (const row of ROW_SPECS) demand[row.level] += 1;
  return demand;
}
