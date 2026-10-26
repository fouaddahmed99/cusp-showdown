import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { OptionId } from "@/contract/lrn-public-v1";
import type { ShowdownAnswer, ShowdownQuestion, ShowdownSource } from "@/content/types";
import { COGNITIVE_LEVEL_LABEL } from "@/content/adapter";
import { asset } from "@/lib/base";
import { sfx } from "@/audio/sfx";
import { Badge, Button, Panel } from "./primitives";

interface QuestionViewProps {
  question: ShowdownQuestion;
  points: number;
  /** Present only after the response is locked. Drives the reveal. */
  answer?: ShowdownAnswer | undefined;
  selected: OptionId | null;
  onSelect: (option: OptionId) => void;
  onLock: () => void;
  onTimeout: () => void;
  onNext: () => void;
  /** 0 disables the timer. */
  timerSeconds: number;
  /** Hold the verdict until the end of the game. */
  holdFeedback: boolean;
  revealed: boolean;
  sources: Map<string, ShowdownSource>;
  /** Extra controls for a host running the room. */
  hostControls?: React.ReactNode;
  nextLabel?: string;
}

export function QuestionView({
  question,
  points,
  answer,
  selected,
  onSelect,
  onLock,
  onTimeout,
  onNext,
  timerSeconds,
  holdFeedback,
  revealed,
  sources,
  hostControls,
  nextLabel = "Back to the board",
}: QuestionViewProps) {
  const graded = revealed && Boolean(answer);
  const showVerdict = graded && !holdFeedback;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.985 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
      className="mx-auto max-w-5xl"
    >
      <Panel className="p-5 sm:p-8">
        <div className="flex flex-wrap items-center gap-3">
          <span className="display tnum text-3xl text-gold sm:text-4xl">{points}</span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink-100">{question.domainName}</p>
            <p className="truncate text-xs text-ink-300">
              {question.subtopicName} · {COGNITIVE_LEVEL_LABEL[question.cognitiveLevel]}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {question.origin === "demo-sample" ? <Badge tone="demo">Demo item</Badge> : null}
            {timerSeconds > 0 && !revealed ? (
              <Timer seconds={timerSeconds} onExpire={onTimeout} running={!revealed} />
            ) : null}
          </div>
        </div>

        {question.vignette ? (
          <p className="mt-6 whitespace-pre-wrap border-l-2 border-electric/50 pl-4 text-lg leading-relaxed text-ink-200 sm:text-xl">
            {question.vignette}
          </p>
        ) : null}

        <h2 className="mt-5 text-balance text-2xl leading-snug sm:text-[2rem]">{question.stem}</h2>

        {question.media?.length ? (
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {question.media.map((m) => (
              <figure key={m.src} className="cusp overflow-hidden bg-navy-800">
                <img
                  src={asset(`content-lrn/${m.src}`)}
                  alt={m.alt}
                  className="h-auto w-full object-contain"
                  loading="lazy"
                />
                {m.caption || m.attribution ? (
                  <figcaption className="px-3 py-2 text-xs text-ink-300">
                    {m.caption}
                    {m.attribution ? ` — ${m.attribution}` : ""}
                  </figcaption>
                ) : null}
              </figure>
            ))}
          </div>
        ) : null}

        <ul className="mt-7 space-y-2.5">
          {question.options.map((option) => (
            <li key={option.id}>
              <OptionRow
                id={option.id}
                text={option.text}
                selected={selected === option.id}
                isKey={showVerdict && answer?.key === option.id}
                isWrongPick={showVerdict && selected === option.id && answer?.key !== option.id}
                disabled={revealed}
                onSelect={() => onSelect(option.id)}
              />
            </li>
          ))}
        </ul>

        <AnimatePresence>
          {graded && answer ? (
            <Reveal
              answer={answer}
              selected={selected}
              sources={sources}
              suppressVerdict={holdFeedback}
              question={question}
            />
          ) : null}
        </AnimatePresence>

        <div className="mt-7 flex flex-wrap items-center gap-3">
          {!revealed ? (
            <Button tone="primary" size="lg" onClick={onLock} disabled={selected === null}>
              Lock in {selected ?? "an answer"}
            </Button>
          ) : (
            <Button tone="primary" size="lg" onClick={onNext}>
              {nextLabel}
            </Button>
          )}
          {hostControls}
        </div>
      </Panel>
    </motion.div>
  );
}

function OptionRow({
  id,
  text,
  selected,
  isKey,
  isWrongPick,
  disabled,
  onSelect,
}: {
  id: OptionId;
  text: string;
  selected: boolean;
  isKey: boolean;
  isWrongPick: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const tone = isKey
    ? "border-correct bg-[rgba(52,211,153,0.12)]"
    : isWrongPick
      ? "border-wrong bg-[rgba(251,113,133,0.12)]"
      : selected
        ? "border-electric bg-[rgba(45,212,255,0.1)]"
        : "border-[rgba(154,166,204,0.18)] bg-[rgba(18,27,56,0.55)] hover:border-[rgba(45,212,255,0.5)]";

  return (
    <button
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      className={`cusp flex w-full items-start gap-4 border px-4 py-3.5 text-left transition-colors disabled:cursor-default ${tone}`}
    >
      <span
        className={`display mt-0.5 flex size-8 shrink-0 items-center justify-center ${
          isKey
            ? "bg-correct text-abyss"
            : isWrongPick
              ? "bg-wrong text-abyss"
              : selected
                ? "bg-electric text-abyss"
                : "bg-navy-600 text-ink-200"
        } cusp cusp-sm`}
        aria-hidden
      >
        {id}
      </span>
      <span className="text-lg leading-snug sm:text-xl">{text}</span>
      {isKey ? (
        <span className="ml-auto shrink-0 self-center text-sm font-semibold text-correct">
          Correct
        </span>
      ) : null}
    </button>
  );
}

function Reveal({
  answer,
  selected,
  sources,
  suppressVerdict,
  question,
}: {
  answer: ShowdownAnswer;
  selected: OptionId | null;
  sources: Map<string, ShowdownSource>;
  suppressVerdict: boolean;
  question: ShowdownQuestion;
}) {
  const correct = selected === answer.key;
  const playedRef = useRef(false);

  useEffect(() => {
    if (playedRef.current || suppressVerdict) return;
    playedRef.current = true;
    sfx.play(selected === null ? "timeout" : correct ? "correct" : "incorrect");
  }, [correct, selected, suppressVerdict]);

  if (suppressVerdict) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mt-7 border-t border-[rgba(154,166,204,0.18)] pt-5 text-ink-300"
      >
        Answer locked in. You chose {selected ?? "nothing"} — results come at the end of the game.
      </motion.div>
    );
  }

  const chosenRationale = selected ? answer.rationales[selected] : undefined;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
      className="mt-7 border-t border-[rgba(154,166,204,0.18)] pt-6"
    >
      <div className="flex items-center gap-3">
        <Badge tone={selected === null ? "neutral" : correct ? "good" : "bad"}>
          {selected === null ? "No answer" : correct ? "Correct" : "Incorrect"}
        </Badge>
        <span className="text-sm text-ink-300">
          The key is {answer.key}
          {selected && !correct ? ` — you chose ${selected}` : ""}
        </span>
      </div>

      <h3 className="mt-5 text-lg text-gold">Why</h3>
      <div className="mt-2 space-y-2.5">
        {answer.explanation.map((sentence, i) => (
          <p key={i} className="text-lg leading-relaxed text-ink-100">
            {sentence.text}{" "}
            <CiteMarks cites={sentence.cites} sources={sources} />
          </p>
        ))}
      </div>

      {chosenRationale?.length && !correct ? (
        <>
          <h3 className="mt-5 text-lg text-gold">About the option you chose</h3>
          <div className="mt-2 space-y-2">
            {chosenRationale.map((sentence, i) => (
              <p key={i} className="text-ink-200">
                {sentence.text} <CiteMarks cites={sentence.cites} sources={sources} />
              </p>
            ))}
          </div>
        </>
      ) : null}

      <SourceList answer={answer} sources={sources} />

      <p className="mt-5 text-xs text-ink-300">
        Item {question.id} · version {question.version} · verified{" "}
        {new Date(question.lastVerifiedAt).toLocaleDateString()} · content {question.contentVersion}
      </p>
    </motion.div>
  );
}

function CiteMarks({
  cites,
  sources,
}: {
  cites: { sourceId: string; page: number | null; section: string }[];
  sources: Map<string, ShowdownSource>;
}) {
  return (
    <>
      {cites.map((cite, i) => {
        const source = sources.get(cite.sourceId);
        const label = source
          ? `${source.organization} ${source.year}${cite.page ? `, p. ${cite.page}` : ""}${
              cite.section ? ` — ${cite.section}` : ""
            }`
          : cite.sourceId;
        return (
          <sup key={`${cite.sourceId}-${i}`} className="ml-0.5">
            {source?.url ? (
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer"
                title={label}
                className="text-electric hover:underline"
              >
                [{i + 1}]
              </a>
            ) : (
              <span title={label} className="text-ink-300">
                [{i + 1}]
              </span>
            )}
          </sup>
        );
      })}
    </>
  );
}

function SourceList({
  answer,
  sources,
}: {
  answer: ShowdownAnswer;
  sources: Map<string, ShowdownSource>;
}) {
  const used = useMemo(() => {
    const ids = new Set<string>();
    for (const sentence of answer.explanation) for (const c of sentence.cites) ids.add(c.sourceId);
    for (const list of Object.values(answer.rationales)) {
      for (const sentence of list ?? []) for (const c of sentence.cites) ids.add(c.sourceId);
    }
    return [...ids].map((id) => sources.get(id)).filter((s): s is ShowdownSource => Boolean(s));
  }, [answer, sources]);

  if (!used.length) return null;

  return (
    <div className="mt-5">
      <h3 className="text-sm font-semibold text-ink-200">References</h3>
      <ul className="mt-2 space-y-1.5 text-sm text-ink-300">
        {used.map((source) => (
          <li key={source.id}>
            <a href={source.url} target="_blank" rel="noreferrer" className="text-electric hover:underline">
              {source.title}
            </a>{" "}
            — {source.organization}, {source.year} ({source.versionLabel}). {source.licenseLabel}
            {source.attribution ? ` ${source.attribution}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A countdown that ticks in the last five seconds and then fires once. */
export function Timer({
  seconds,
  onExpire,
  running,
}: {
  seconds: number;
  onExpire: () => void;
  running: boolean;
}) {
  const [left, setLeft] = useState(seconds);
  const firedRef = useRef(false);

  useEffect(() => {
    setLeft(seconds);
    firedRef.current = false;
  }, [seconds]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setLeft((prev) => {
        const next = Math.max(0, prev - 1);
        if (next <= 5 && next > 0) sfx.play("tick");
        if (next === 0 && !firedRef.current) {
          firedRef.current = true;
          onExpire();
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [running, onExpire]);

  const urgent = left <= 5;
  const pct = seconds > 0 ? (left / seconds) * 100 : 0;

  return (
    <div className="flex items-center gap-2" role="timer" aria-live="off">
      <div className="h-1.5 w-20 overflow-hidden bg-navy-600 sm:w-28">
        <div
          className={`h-full transition-[width] duration-1000 ease-linear ${
            urgent ? "bg-wrong" : "bg-electric"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`display tnum text-xl ${urgent ? "text-wrong" : "text-ink-100"}`}>{left}</span>
    </div>
  );
}
