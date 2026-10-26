import { DEFAULT_SOLO_SETTINGS, type AnsweredTile, type SoloSettings, type StoredProgress } from "./types";
import { overallAccuracy } from "./solo";

/**
 * Local progress only. Nothing leaves the browser, and a blocked or cleared
 * localStorage is a normal state: every read falls back to a fresh record and
 * every write is allowed to fail silently.
 */
const KEY = "cusp-showdown:progress:v1";

export function emptyProgress(): StoredProgress {
  return {
    version: 1,
    personalBest: null,
    gamesPlayed: 0,
    categoryTotals: {},
    missedItemIds: [],
    settings: DEFAULT_SOLO_SETTINGS,
  };
}

function storage(): Storage | null {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    const probe = `${KEY}:probe`;
    s.setItem(probe, "1");
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export function loadProgress(): StoredProgress {
  const s = storage();
  if (!s) return emptyProgress();
  try {
    const raw = s.getItem(KEY);
    if (!raw) return emptyProgress();
    const parsed = JSON.parse(raw) as unknown;
    return reconcileProgress(parsed);
  } catch {
    return emptyProgress();
  }
}

/** Accepts anything and returns a usable record; a corrupt value is discarded. */
export function reconcileProgress(value: unknown): StoredProgress {
  const base = emptyProgress();
  if (!value || typeof value !== "object") return base;
  const v = value as Partial<StoredProgress>;
  if (v.version !== 1) return base;
  return {
    version: 1,
    personalBest:
      v.personalBest && typeof v.personalBest.score === "number" ? v.personalBest : null,
    gamesPlayed: typeof v.gamesPlayed === "number" && v.gamesPlayed >= 0 ? v.gamesPlayed : 0,
    categoryTotals:
      v.categoryTotals && typeof v.categoryTotals === "object" ? v.categoryTotals : {},
    missedItemIds: Array.isArray(v.missedItemIds) ? v.missedItemIds.slice(0, 500) : [],
    settings: { ...base.settings, ...(v.settings ?? {}) },
  };
}

export function saveProgress(progress: StoredProgress): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(KEY, JSON.stringify(progress));
  } catch {
    // Quota or private mode. Progress is a convenience, never load-bearing.
  }
}

export function saveSettings(settings: SoloSettings): void {
  const current = loadProgress();
  saveProgress({ ...current, settings });
}

/** Folds a finished game into the stored record and returns the new record. */
export function recordGame(
  current: StoredProgress,
  result: { score: number; answered: AnsweredTile[]; contentVersion: string; at?: string },
): StoredProgress {
  const accuracy = overallAccuracy(result.answered);
  const categoryTotals = { ...current.categoryTotals };
  for (const tile of result.answered) {
    const entry = categoryTotals[tile.domainId] ?? { answered: 0, correct: 0 };
    categoryTotals[tile.domainId] = {
      answered: entry.answered + 1,
      correct: entry.correct + (tile.outcome === "correct" ? 1 : 0),
    };
  }

  const missed = new Set(current.missedItemIds);
  for (const tile of result.answered) {
    if (tile.outcome === "correct") missed.delete(tile.itemId);
    else missed.add(tile.itemId);
  }

  const isBest =
    !current.personalBest ||
    result.score > current.personalBest.score ||
    (result.score === current.personalBest.score && accuracy > current.personalBest.accuracy);

  return {
    ...current,
    gamesPlayed: current.gamesPlayed + 1,
    categoryTotals,
    missedItemIds: [...missed].slice(-500),
    personalBest: isBest
      ? {
          score: result.score,
          accuracy,
          answered: result.answered.length,
          at: result.at ?? new Date().toISOString(),
          contentVersion: result.contentVersion,
        }
      : current.personalBest,
  };
}

export function clearProgress(): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(KEY);
  } catch {
    // Nothing to do.
  }
}
