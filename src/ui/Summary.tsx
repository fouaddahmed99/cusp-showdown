import { useEffect, useState } from "react";
import type { ContentPack } from "@/content/store";
import type { ShowdownAnswer, ShowdownSource } from "@/content/types";
import { toShowdownAnswer } from "@/content/adapter";
import { categoryAccuracy, missedTiles, overallAccuracy } from "@/game/solo";
import type { AnsweredTile } from "@/game/types";
import { loadProgress } from "@/game/persist";
import { sfx } from "@/audio/sfx";
import { Confetti } from "./Chrome";
import { Badge, Button, Panel, Stat } from "./primitives";

interface SummaryProps {
  score: number;
  answered: AnsweredTile[];
  sources: Map<string, ShowdownSource>;
  pack: ContentPack;
  contentVersion: string;
  isDemo: boolean;
  onReplay: () => void;
  onExit: () => void;
}

export function Summary({
  score,
  answered,
  sources,
  pack,
  contentVersion,
  isDemo,
  onReplay,
  onExit,
}: SummaryProps) {
  const accuracy = overallAccuracy(answered);
  const byCategory = categoryAccuracy(answered);
  const missed = missedTiles(answered);
  const progress = loadProgress();
  const beat = progress.personalBest ? score >= progress.personalBest.score : answered.length > 0;

  useEffect(() => {
    if (beat) sfx.play("victory");
  }, [beat]);

  return (
    <div className="space-y-6">
      {beat ? <Confetti /> : null}

      <Panel className="p-6 sm:p-8">
        <div className="flex flex-wrap items-end gap-10">
          <div>
            <p className="text-sm text-ink-300">Final score</p>
            <p className="display tnum text-6xl text-gold sm:text-7xl">{score.toLocaleString()}</p>
          </div>
          <Stat value={`${Math.round(accuracy * 100)}%`} label="Accuracy" tone="electric" />
          <Stat value={answered.length} label="Questions answered" />
          <Stat value={missed.length} label="To review" tone={missed.length ? "violet" : "ink"} />
          <div className="ml-auto flex flex-wrap gap-3">
            <Button tone="primary" onClick={onReplay}>
              Play again with new questions
            </Button>
            <Button tone="ghost" onClick={onExit}>
              Back to the start
            </Button>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {isDemo ? <Badge tone="demo">Demo content — no clinical value</Badge> : null}
          {progress.personalBest ? (
            <Badge tone={beat ? "good" : "neutral"}>
              {beat ? "New personal best" : `Best ${progress.personalBest.score.toLocaleString()}`}
            </Badge>
          ) : null}
          <Badge tone="neutral">content {contentVersion}</Badge>
        </div>
      </Panel>

      <section className="grid gap-6 lg:grid-cols-2">
        <Panel className="p-6">
          <h2 className="text-xl">Accuracy by category</h2>
          {byCategory.length ? (
            <ul className="mt-4 space-y-3">
              {byCategory.map((row) => (
                <li key={row.domainId}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm text-ink-200">{row.domainName}</span>
                    <span className="tnum text-sm text-ink-300">
                      {row.correct}/{row.answered}
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden bg-navy-700">
                    <div
                      className="h-full bg-electric"
                      style={{ width: `${Math.round((row.accuracy ?? 0) * 100)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-ink-300">No questions were answered in this game.</p>
          )}
        </Panel>

        <Panel className="p-6">
          <h2 className="text-xl">Scoring run</h2>
          <ul className="mt-4 divide-y divide-[rgba(154,166,204,0.14)]">
            {answered.map((tile) => (
              <li key={tile.itemId} className="flex items-center gap-3 py-2.5 text-sm">
                <span className="display tnum w-14 shrink-0 text-ink-300">{tile.points}</span>
                <span className="min-w-0 flex-1 truncate text-ink-200">{tile.domainName}</span>
                <Badge
                  tone={
                    tile.outcome === "correct" ? "good" : tile.outcome === "timeout" ? "neutral" : "bad"
                  }
                >
                  {tile.outcome === "correct" ? "✓" : tile.outcome === "timeout" ? "—" : "✕"}
                </Badge>
                <span
                  className={`tnum w-20 shrink-0 text-right ${
                    tile.pointsDelta > 0 ? "text-correct" : tile.pointsDelta < 0 ? "text-wrong" : "text-ink-300"
                  }`}
                >
                  {tile.pointsDelta > 0 ? "+" : ""}
                  {tile.pointsDelta.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </section>

      {missed.length ? (
        <MissedReview missed={missed} pack={pack} sources={sources} />
      ) : answered.length ? (
        <Panel className="p-6">
          <h2 className="text-xl text-correct">Nothing missed</h2>
          <p className="mt-2 text-ink-200">Every question answered correctly.</p>
        </Panel>
      ) : null}
    </div>
  );
}

/** Review of the misses, with the real explanation and references for each. */
function MissedReview({
  missed,
  pack,
  sources,
}: {
  missed: AnsweredTile[];
  pack: ContentPack;
  sources: Map<string, ShowdownSource>;
}) {
  const [open, setOpen] = useState<string | null>(missed[0]?.itemId ?? null);
  const [answers, setAnswers] = useState<Record<string, ShowdownAnswer | { error: string }>>({});

  useEffect(() => {
    if (!open || answers[open]) return;
    let cancelled = false;
    (async () => {
      try {
        const answer = toShowdownAnswer(await pack.getAnswer(open));
        if (!cancelled) setAnswers((prev) => ({ ...prev, [open]: answer }));
      } catch (error) {
        if (!cancelled) {
          setAnswers((prev) => ({
            ...prev,
            [open]: { error: error instanceof Error ? error.message : String(error) },
          }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [answers, open, pack]);

  return (
    <Panel className="p-6">
      <h2 className="text-xl">What to review</h2>
      <p className="mt-2 text-sm text-ink-300">
        Each item below links back to the guideline it was written from.
      </p>
      <ul className="mt-4 space-y-2">
        {missed.map((tile) => {
          const isOpen = open === tile.itemId;
          const loaded = answers[tile.itemId];
          return (
            <li key={tile.itemId} className="cusp cusp-sm border border-[rgba(154,166,204,0.18)]">
              <button
                onClick={() => setOpen(isOpen ? null : tile.itemId)}
                aria-expanded={isOpen}
                className="flex w-full items-center gap-3 px-4 py-3 text-left"
              >
                <span className="display tnum w-14 shrink-0 text-ink-300">{tile.points}</span>
                <span className="min-w-0 flex-1 truncate">{tile.domainName}</span>
                <span className="text-sm text-ink-300">
                  {tile.outcome === "timeout" ? "no answer" : `chose ${tile.selected}`}
                </span>
                <span aria-hidden className="text-ink-300">
                  {isOpen ? "−" : "+"}
                </span>
              </button>
              {isOpen ? (
                <div className="border-t border-[rgba(154,166,204,0.14)] px-4 py-4">
                  {!loaded ? (
                    <p className="text-sm text-ink-300">Loading the explanation…</p>
                  ) : "error" in loaded ? (
                    <p className="text-sm text-wrong">{loaded.error}</p>
                  ) : (
                    <>
                      <p className="text-sm text-ink-300">
                        Correct answer: <span className="font-semibold text-correct">{loaded.key}</span>
                      </p>
                      <div className="mt-3 space-y-2">
                        {loaded.explanation.map((sentence, i) => (
                          <p key={i} className="text-ink-100">
                            {sentence.text}
                          </p>
                        ))}
                      </div>
                      <ul className="mt-3 space-y-1 text-xs text-ink-300">
                        {[
                          ...new Set(
                            loaded.explanation.flatMap((s) => s.cites.map((c) => c.sourceId)),
                          ),
                        ].map((sourceId) => {
                          const source = sources.get(sourceId);
                          if (!source) return null;
                          return (
                            <li key={sourceId}>
                              <a
                                href={source.url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-electric hover:underline"
                              >
                                {source.title}
                              </a>{" "}
                              — {source.organization}, {source.year}
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
