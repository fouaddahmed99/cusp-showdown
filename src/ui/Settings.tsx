import type { ContentCatalog } from "@/content/types";
import type { ContentChoice } from "@/content/source";
import { COGNITIVE_LEVELS, COGNITIVE_LEVEL_LABEL } from "@/content/adapter";
import type { CognitiveLevel } from "@/contract/lrn-public-v1";
import { normalizeSettings } from "@/game/solo";
import type { SoloSettings } from "@/game/types";
import { Badge, Button, Panel } from "./primitives";

interface SettingsProps {
  settings: SoloSettings;
  onChange: (settings: SoloSettings) => void;
  catalog: ContentCatalog | null;
  approved: ContentCatalog | null;
  choice: ContentChoice;
  onChoiceChange: (choice: ContentChoice) => void;
  categories: string[];
  onCategoriesChange: (ids: string[]) => void;
  levels: CognitiveLevel[] | null;
  onLevelsChange: (levels: CognitiveLevel[] | null) => void;
  onClose: () => void;
}

const TIMER_CHOICES = [0, 20, 30, 45, 60, 90];

export function Settings({
  settings,
  onChange,
  catalog,
  approved,
  choice,
  onChoiceChange,
  categories,
  onCategoriesChange,
  levels,
  onLevelsChange,
  onClose,
}: SettingsProps) {
  const set = (patch: Partial<SoloSettings>) => onChange(normalizeSettings({ ...settings, ...patch }));
  const approvedCount = approved?.items.length ?? 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-4">
        <h1 className="display text-3xl">Settings</h1>
        <Button tone="ghost" className="ml-auto" onClick={onClose}>
          Done
        </Button>
      </div>

      <Panel className="p-6">
        <h2 className="text-xl">Where the questions come from</h2>
        <p className="mt-2 text-sm text-ink-300">
          Approved content is the reviewed CUSP LRN bank, with citations. The demo pack is
          placeholder SAMPLE content that exists only so the game can be played before the bank is
          large enough to fill a board.
        </p>
        <div className="mt-4 space-y-2">
          {(
            [
              {
                id: "auto" as const,
                title: "Approved when there's enough, otherwise demo",
                detail: "Puts real questions on the board as soon as 30 are approved.",
              },
              {
                id: "approved" as const,
                title: "Approved content only",
                detail: `${approvedCount} playable item${approvedCount === 1 ? "" : "s"} in the bank right now. Tiles beyond that stay empty.`,
              },
              {
                id: "demo" as const,
                title: "Demo pack only",
                detail: "A full 30-tile board of clearly-labelled SAMPLE questions.",
              },
            ]
          ).map((option) => (
            <button
              key={option.id}
              onClick={() => onChoiceChange(option.id)}
              aria-pressed={choice === option.id}
              className={`cusp flex w-full items-start gap-3 border px-4 py-3 text-left transition-colors ${
                choice === option.id
                  ? "border-electric bg-[rgba(45,212,255,0.1)]"
                  : "border-[rgba(154,166,204,0.18)] hover:border-[rgba(45,212,255,0.4)]"
              }`}
            >
              <span
                aria-hidden
                className={`mt-1.5 size-3 shrink-0 rounded-full ${
                  choice === option.id ? "bg-electric" : "bg-navy-500"
                }`}
              />
              <span>
                <span className="block font-semibold">{option.title}</span>
                <span className="block text-sm text-ink-300">{option.detail}</span>
              </span>
            </button>
          ))}
        </div>
        {catalog ? (
          <p className="mt-4 text-xs text-ink-300">
            On the board now: {catalog.origin === "lrn-approved" ? "approved content" : "demo pack"} ·
            version {catalog.contentVersion} · {catalog.items.length} playable items
          </p>
        ) : null}
      </Panel>

      <Panel className="p-6">
        <h2 className="text-xl">Categories</h2>
        <p className="mt-2 text-sm text-ink-300">
          Pick up to six. The number beside each is how many approved items it can draw on.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {(catalog?.domains ?? []).map((domain) => {
            const on = categories.includes(domain.id);
            const disabled = domain.total === 0;
            return (
              <button
                key={domain.id}
                disabled={disabled}
                onClick={() =>
                  onCategoriesChange(
                    on
                      ? categories.filter((id) => id !== domain.id)
                      : categories.length >= 6
                        ? categories
                        : [...categories, domain.id],
                  )
                }
                aria-pressed={on}
                className={`cusp cusp-sm border px-3 py-2 text-left text-sm transition-colors disabled:opacity-40 ${
                  on
                    ? "border-gold bg-[rgba(245,194,62,0.12)] text-gold"
                    : "border-[rgba(154,166,204,0.2)] text-ink-200 hover:border-[rgba(245,194,62,0.5)]"
                }`}
                title={disabled ? "No approved items in this category yet" : undefined}
              >
                {domain.name}
                <span className="ml-2 tnum text-xs text-ink-300">{domain.total}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-ink-300">{categories.length} of 6 selected</p>
      </Panel>

      <Panel className="p-6">
        <h2 className="text-xl">Difficulty</h2>
        <p className="mt-2 text-sm text-ink-300">
          Approved items carry a reviewed cognitive level, which is what the five point rows are
          mapped onto. Restricting the levels will leave rows empty rather than substitute anything.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            tone={levels === null ? "primary" : "ghost"}
            size="sm"
            onClick={() => onLevelsChange(null)}
          >
            All levels
          </Button>
          {COGNITIVE_LEVELS.map((level) => {
            const on = levels?.includes(level) ?? false;
            return (
              <Button
                key={level}
                tone={on ? "primary" : "ghost"}
                size="sm"
                onClick={() => {
                  const current = levels ?? [];
                  const next = on ? current.filter((l) => l !== level) : [...current, level];
                  onLevelsChange(next.length ? next : null);
                }}
              >
                {COGNITIVE_LEVEL_LABEL[level]}
              </Button>
            );
          })}
        </div>
      </Panel>

      <Panel className="p-6">
        <h2 className="text-xl">How you want to practise</h2>

        <fieldset className="mt-5">
          <legend className="text-sm font-semibold text-ink-200">Feedback</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              tone={settings.feedback === "immediate" ? "primary" : "ghost"}
              size="sm"
              onClick={() => set({ feedback: "immediate" })}
            >
              After each question
            </Button>
            <Button
              tone={settings.feedback === "end-of-game" ? "primary" : "ghost"}
              size="sm"
              onClick={() => set({ feedback: "end-of-game" })}
              disabled={settings.studyMode}
            >
              At the end of the game
            </Button>
          </div>
        </fieldset>

        <fieldset className="mt-5">
          <legend className="text-sm font-semibold text-ink-200">Timer</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {TIMER_CHOICES.map((seconds) => (
              <Button
                key={seconds}
                tone={settings.timerSeconds === seconds ? "primary" : "ghost"}
                size="sm"
                onClick={() => set({ timerSeconds: seconds })}
                disabled={settings.studyMode && seconds !== 0}
              >
                {seconds === 0 ? "None" : `${seconds}s`}
              </Button>
            ))}
          </div>
        </fieldset>

        <fieldset className="mt-5">
          <legend className="text-sm font-semibold text-ink-200">Penalties</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              tone={settings.scoring.penalizeIncorrect ? "primary" : "ghost"}
              size="sm"
              disabled={settings.studyMode}
              onClick={() =>
                set({
                  scoring: {
                    ...settings.scoring,
                    penalizeIncorrect: !settings.scoring.penalizeIncorrect,
                  },
                })
              }
            >
              Wrong answers cost points
            </Button>
            <Button
              tone={settings.scoring.penalizeTimeout ? "primary" : "ghost"}
              size="sm"
              disabled={settings.studyMode}
              onClick={() =>
                set({
                  scoring: {
                    ...settings.scoring,
                    penalizeTimeout: !settings.scoring.penalizeTimeout,
                  },
                })
              }
            >
              Running out of time costs points
            </Button>
          </div>
        </fieldset>

        <div className="mt-6 flex items-center gap-3">
          <Button
            tone={settings.studyMode ? "gold" : "ghost"}
            onClick={() => set({ studyMode: !settings.studyMode })}
          >
            {settings.studyMode ? "Study mode is on" : "Turn on study mode"}
          </Button>
          {settings.studyMode ? (
            <Badge tone="neutral">No timer, no penalties, explanations always shown</Badge>
          ) : null}
        </div>
      </Panel>
    </div>
  );
}
