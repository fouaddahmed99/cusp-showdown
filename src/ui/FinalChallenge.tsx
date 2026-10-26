import { useState } from "react";
import type { OptionId } from "@/contract/lrn-public-v1";
import type { ShowdownSource } from "@/content/types";
import type { SoloGameState } from "@/game/types";
import { maxWager } from "@/game/scoring";
import { QuestionView } from "./QuestionView";
import { Button, Panel, Spinner, Stat } from "./primitives";

interface FinalChallengeProps {
  state: SoloGameState;
  sources: Map<string, ShowdownSource>;
  busy: boolean;
  onWager: (amount: number) => void;
  onLockWager: () => void;
  onSelect: (option: OptionId) => void;
  onLockAnswer: () => void;
  onTimeout: () => void;
  onFinish: () => void;
}

/**
 * One high-stakes question. The wager is locked before the question is fetched,
 * so there is no way to see the item and then change the bet.
 */
export function FinalChallenge({
  state,
  sources,
  busy,
  onWager,
  onLockWager,
  onSelect,
  onLockAnswer,
  onTimeout,
  onFinish,
}: FinalChallengeProps) {
  const final = state.final;
  const [draft, setDraft] = useState<string>("");

  if (!final) return null;

  if (state.phase === "final-wager") {
    const ceiling = maxWager(state.score);
    return (
      <Panel className="mx-auto max-w-2xl p-6 sm:p-8">
        <h2 className="display text-3xl text-gold">Final challenge</h2>
        <p className="mt-3 text-ink-200">
          One question, one wager. Put up anything from 0 to {ceiling.toLocaleString()} points —
          correct adds it, wrong takes it. The question appears only once the wager is locked.
        </p>

        <div className="mt-6 flex flex-wrap items-end gap-8">
          <Stat value={state.score.toLocaleString()} label="Score going in" tone="gold" />
          <Stat value={ceiling.toLocaleString()} label="Most you can wager" />
        </div>

        <label className="mt-7 block">
          <span className="text-sm font-semibold text-ink-200">Your wager</span>
          <input
            type="number"
            min={0}
            max={ceiling}
            step={100}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              onWager(Number(event.target.value));
            }}
            placeholder="0"
            className="cusp cusp-sm mt-2 w-full border border-[rgba(154,166,204,0.25)] bg-navy-800 px-4 py-3 text-2xl tabular-nums outline-none focus:border-electric"
          />
        </label>

        <div className="mt-4 flex flex-wrap gap-2">
          {[0, Math.floor(ceiling / 4), Math.floor(ceiling / 2), ceiling].map((amount, i) => (
            <Button
              key={`${amount}-${i}`}
              tone="ghost"
              size="sm"
              onClick={() => {
                setDraft(String(amount));
                onWager(amount);
              }}
            >
              {amount.toLocaleString()}
            </Button>
          ))}
        </div>

        <div className="mt-7 flex items-center gap-3">
          <Button tone="gold" size="lg" onClick={onLockWager}>
            Lock in {final.wager.toLocaleString()} and see the question
          </Button>
          <Button tone="ghost" onClick={onFinish}>
            Skip the final
          </Button>
        </div>
      </Panel>
    );
  }

  if (!state.active) {
    return <Spinner label="Opening the final question…" />;
  }

  return (
    <div className="space-y-4">
      <div className="mx-auto flex max-w-5xl flex-wrap items-end gap-8">
        <Stat value={state.score.toLocaleString()} label="Score" tone="gold" />
        <Stat value={final.wager.toLocaleString()} label="Wagered" tone="violet" />
        {final.outcome ? (
          <Stat
            value={`${final.pointsDelta && final.pointsDelta > 0 ? "+" : ""}${(final.pointsDelta ?? 0).toLocaleString()}`}
            label={final.outcome === "correct" ? "Won" : "Lost"}
            tone={final.outcome === "correct" ? "electric" : "ink"}
          />
        ) : null}
      </div>

      <QuestionView
        question={state.active.question}
        points={final.wager}
        answer={state.active.answer}
        selected={state.active.selected}
        onSelect={onSelect}
        onLock={onLockAnswer}
        onTimeout={onTimeout}
        onNext={onFinish}
        timerSeconds={state.settings.timerSeconds > 0 ? Math.max(60, state.settings.timerSeconds) : 0}
        holdFeedback={false}
        revealed={state.phase === "final-revealed"}
        sources={sources}
        nextLabel="See the summary"
        hostControls={busy ? <Spinner label="Grading…" /> : null}
      />
    </div>
  );
}
