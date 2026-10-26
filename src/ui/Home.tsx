import { useEffect, useMemo, useState } from "react";
import type { ContentCatalog } from "@/content/types";
import { POINT_VALUES } from "@/content/difficulty";
import { Badge, Button, Panel } from "./primitives";
import { multiplayerStatus } from "@/multiplayer/config";

interface HomeProps {
  catalog: ContentCatalog | null;
  approved: ContentCatalog | null;
  note: string | null;
  isDemo: boolean;
  personalBest: { score: number; accuracy: number } | null;
  gamesPlayed: number;
  onPlaySolo: () => void;
  onHost: () => void;
  onJoin: () => void;
  onOpenSettings: () => void;
}

/**
 * The hero is the board itself, idling. It is the thing the whole product is
 * about, so it gets the space rather than a headline over a gradient.
 */
export function Home({
  catalog,
  approved,
  note,
  isDemo,
  personalBest,
  gamesPlayed,
  onPlaySolo,
  onHost,
  onJoin,
  onOpenSettings,
}: HomeProps) {
  const mp = multiplayerStatus();
  const approvedCount = approved?.items.length ?? 0;
  const categories = useMemo(
    () => (catalog?.domains ?? []).filter((d) => d.total > 0).slice(0, 6),
    [catalog],
  );

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-14">
      <section className="flex flex-col justify-center">
        <h1 className="display text-5xl leading-[0.98] sm:text-6xl">
          Pediatric dentistry
          <br />
          board review,
          <br />
          <span className="text-gold">played out loud.</span>
        </h1>
        <p className="mt-5 max-w-[42ch] text-lg text-ink-200">
          Six categories, thirty tiles, one buzzer. Built on the approved CUSP LRN question bank, so
          every answer comes back with its explanation and its guideline citation.
        </p>

        <div className="mt-8 flex flex-col gap-3">
          <Button tone="primary" size="lg" onClick={onPlaySolo} className="justify-between">
            <span>Play solo</span>
            <span className="text-sm font-normal opacity-70">practice on your own</span>
          </Button>
          <Button tone="gold" size="lg" onClick={onHost} className="justify-between">
            <span>Host a game</span>
            <span className="text-sm font-normal opacity-70">run the room</span>
          </Button>
          <Button tone="secondary" size="lg" onClick={onJoin} className="justify-between">
            <span>Join a game</span>
            <span className="text-sm font-normal opacity-70">buzz in from your phone</span>
          </Button>
        </div>

        <div className="mt-7 flex flex-wrap items-center gap-2">
          {isDemo ? <Badge tone="demo">Demo content on the board</Badge> : null}
          {!isDemo && approvedCount > 0 ? (
            <Badge tone="good">{approvedCount} approved items</Badge>
          ) : null}
          {mp.configured ? (
            <Badge tone="live">Multiplayer ready</Badge>
          ) : (
            <Badge tone="neutral">Multiplayer needs setup</Badge>
          )}
          {personalBest ? (
            <Badge tone="neutral">
              Best {personalBest.score.toLocaleString()} · {Math.round(personalBest.accuracy * 100)}%
            </Badge>
          ) : null}
          {gamesPlayed > 0 ? <Badge tone="neutral">{gamesPlayed} games played</Badge> : null}
        </div>

        {note ? (
          <p className="mt-5 max-w-[52ch] border-l-2 border-gold/60 pl-3 text-sm text-ink-300">
            {note}
          </p>
        ) : null}

        <button
          onClick={onOpenSettings}
          className="mt-6 self-start text-sm text-electric underline-offset-4 hover:underline"
        >
          Game settings and content source
        </button>
      </section>

      <section aria-label="Board preview" className="flex items-center">
        <BoardPreview
          categories={categories.map((c) => c.name)}
          contentVersion={catalog?.contentVersion ?? null}
          isDemo={isDemo}
        />
      </section>
    </div>
  );
}

/** A non-interactive board that breathes, so the home screen shows the game. */
function BoardPreview({
  categories,
  contentVersion,
  isDemo,
}: {
  categories: string[];
  contentVersion: string | null;
  isDemo: boolean;
}) {
  const [lit, setLit] = useState(0);
  const columns = categories.length ? categories : ["—", "—", "—", "—", "—", "—"];

  useEffect(() => {
    const reduce = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const id = setInterval(() => setLit((n) => (n + 1) % (columns.length * POINT_VALUES.length)), 240);
    return () => clearInterval(id);
  }, [columns.length]);

  return (
    <Panel className="w-full p-4 sm:p-5">
      <div
        className="grid gap-1.5 sm:gap-2"
        style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
      >
        {columns.map((name) => (
          <div
            key={name}
            className="cusp cusp-sm flex min-h-14 items-center justify-center bg-navy-700 px-1.5 py-2 text-center text-[0.62rem] font-semibold leading-tight text-gold sm:text-xs"
            title={name}
          >
            <span className="line-clamp-3">{name}</span>
          </div>
        ))}

        {POINT_VALUES.map((points, rowIndex) =>
          columns.map((name, colIndex) => {
            const index = colIndex * POINT_VALUES.length + rowIndex;
            const isLit = index === lit;
            return (
              <div
                key={`${name}-${points}`}
                className={`tile-face cusp flex min-h-12 items-center justify-center sm:min-h-16 ${
                  isLit ? "breathe" : ""
                }`}
                style={isLit ? { boxShadow: "0 0 0 1px rgba(45,212,255,0.5)" } : undefined}
              >
                <span className="display tnum text-base text-gold/90 sm:text-xl">{points}</span>
              </div>
            );
          }),
        )}
      </div>
      <p className="mt-4 text-xs text-ink-300">
        {isDemo ? "Preview — demo content" : "Preview"}
        {contentVersion ? ` · content ${contentVersion}` : ""}
      </p>
    </Panel>
  );
}
