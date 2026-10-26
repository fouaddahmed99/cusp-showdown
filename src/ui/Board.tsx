import { motion } from "motion/react";
import type { BoardTile, GeneratedBoard } from "@/content/board";
import { COGNITIVE_LEVEL_LABEL } from "@/content/adapter";
import { Badge, Panel } from "./primitives";

interface BoardProps {
  board: GeneratedBoard;
  /** Item ids already played, so their tiles are retired. */
  playedItemIds: Set<string>;
  onPick: (tile: BoardTile, domainId: string) => void;
  disabled?: boolean;
  /** Host view adds the level hint under each category. */
  showLevels?: boolean;
}

export function Board({ board, playedItemIds, onPick, disabled, showLevels }: BoardProps) {
  const columns = board.columns.length || 1;

  return (
    <div className="space-y-4">
      <div
        className="grid gap-1.5 sm:gap-2.5"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {board.columns.map((column) => (
          <div
            key={column.domainId}
            className="cusp cusp-sm flex min-h-16 flex-col items-center justify-center bg-navy-700 px-2 py-2.5 text-center sm:min-h-20"
          >
            <span className="display text-[0.7rem] leading-tight text-gold sm:text-sm">
              {column.domainName}
            </span>
          </div>
        ))}

        {board.columns[0]?.tiles.map((_, rowIndex) =>
          board.columns.map((column) => {
            const tile = column.tiles[rowIndex];
            if (!tile) return null;
            const played = Boolean(tile.itemId && playedItemIds.has(tile.itemId));
            return (
              <Tile
                key={`${column.domainId}-${tile.points}`}
                tile={tile}
                played={played}
                disabled={Boolean(disabled)}
                showLevel={Boolean(showLevels)}
                onPick={() => onPick(tile, column.domainId)}
              />
            );
          }),
        )}
      </div>

      {board.shortfalls.length || board.droppedCategories.length ? (
        <ContentShortfall board={board} />
      ) : null}
    </div>
  );
}

function Tile({
  tile,
  played,
  disabled,
  showLevel,
  onPick,
}: {
  tile: BoardTile;
  played: boolean;
  disabled: boolean;
  showLevel: boolean;
  onPick: () => void;
}) {
  const unavailable = tile.state === "empty";
  const inert = unavailable || played || disabled;

  if (unavailable) {
    return (
      <div
        className="cusp flex min-h-20 flex-col items-center justify-center border border-dashed border-[rgba(154,166,204,0.22)] bg-[rgba(11,18,38,0.5)] px-2 text-center sm:min-h-24"
        title={tile.emptyReason}
      >
        <span className="text-[0.65rem] leading-tight text-ink-300">No approved item</span>
      </div>
    );
  }

  if (played) {
    return (
      <div className="cusp flex min-h-20 items-center justify-center bg-[rgba(7,11,28,0.72)] sm:min-h-24">
        <span className="display tnum text-base text-ink-300/40 sm:text-lg">{tile.points}</span>
      </div>
    );
  }

  return (
    <motion.button
      onClick={onPick}
      disabled={inert}
      whileHover={inert ? undefined : { scale: 1.035 }}
      whileTap={inert ? undefined : { scale: 0.975 }}
      transition={{ type: "spring", stiffness: 420, damping: 28 }}
      className="tile-face cusp group relative flex min-h-20 flex-col items-center justify-center px-2 sm:min-h-24"
      aria-label={`${tile.points} points${tile.substitutedLevel ? ", substituted difficulty" : ""}`}
    >
      <span className="display tnum text-2xl text-gold transition-colors group-hover:text-ink-100 sm:text-4xl">
        {tile.points}
      </span>
      {showLevel ? (
        <span className="mt-1 text-[0.6rem] leading-none text-ink-300">
          {COGNITIVE_LEVEL_LABEL[tile.substitutedLevel ?? tile.rowLevel]}
        </span>
      ) : null}
      {tile.substitutedLevel ? (
        <span
          className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-electric"
          title={`Filled from a ${COGNITIVE_LEVEL_LABEL[tile.substitutedLevel]} item — this row normally holds ${COGNITIVE_LEVEL_LABEL[tile.rowLevel]}.`}
        />
      ) : null}
    </motion.button>
  );
}

/** Says plainly where the bank ran out, instead of hiding thin categories. */
export function ContentShortfall({ board }: { board: GeneratedBoard }) {
  return (
    <Panel className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral">
          {board.filledTiles} of {board.requestedTiles} tiles filled
        </Badge>
        <span className="text-sm text-ink-300">
          Empty tiles are categories where the approved bank has run out. Nothing is generated to
          fill them.
        </span>
      </div>
      <ul className="mt-3 space-y-1.5 text-sm text-ink-200">
        {board.shortfalls.map((s) => (
          <li key={s.domainId} className="flex gap-2">
            <span className="text-gold" aria-hidden>
              ·
            </span>
            {s.detail}
          </li>
        ))}
        {board.droppedCategories.map((d) => (
          <li key={d.domainId} className="flex gap-2">
            <span className="text-wrong" aria-hidden>
              ·
            </span>
            {d.domainName}: {d.reason}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
