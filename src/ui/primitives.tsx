import type { ButtonHTMLAttributes, ReactNode } from "react";
import { sfx } from "@/audio/sfx";

type ButtonTone = "primary" | "secondary" | "ghost" | "danger" | "gold";

const TONE: Record<ButtonTone, string> = {
  primary:
    "bg-electric text-abyss hover:bg-[color-mix(in_srgb,var(--color-electric)_86%,white)] font-semibold",
  secondary:
    "bg-navy-600 text-ink-100 hover:bg-navy-500 border border-[rgba(154,166,204,0.22)]",
  ghost: "bg-transparent text-ink-200 hover:bg-navy-700 border border-[rgba(154,166,204,0.22)]",
  danger: "bg-wrong text-abyss hover:brightness-110 font-semibold",
  gold: "bg-gold text-abyss hover:brightness-110 font-semibold",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ButtonTone;
  size?: "sm" | "md" | "lg";
  children: ReactNode;
}

export function Button({ tone = "secondary", size = "md", className = "", children, onClick, ...rest }: ButtonProps) {
  const sizing =
    size === "lg"
      ? "px-7 py-4 text-lg"
      : size === "sm"
        ? "px-3 py-1.5 text-sm"
        : "px-5 py-2.5 text-base";
  return (
    <button
      {...rest}
      onClick={(event) => {
        sfx.unlock();
        onClick?.(event);
      }}
      className={`cusp cusp-sm inline-flex items-center justify-center gap-2 transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45 ${TONE[tone]} ${sizing} ${className}`}
    >
      {children}
    </button>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`panel cusp ${className}`}>{children}</div>;
}

/** A labelled value, used for scores and counts. Label sits under the number. */
export function Stat({
  value,
  label,
  tone = "ink",
}: {
  value: ReactNode;
  label: string;
  tone?: "ink" | "gold" | "electric" | "violet";
}) {
  const color =
    tone === "gold"
      ? "text-gold"
      : tone === "electric"
        ? "text-electric"
        : tone === "violet"
          ? "text-violet"
          : "text-ink-100";
  return (
    <div>
      <div className={`display tnum text-3xl sm:text-4xl ${color}`}>{value}</div>
      <div className="mt-1 text-sm text-ink-300">{label}</div>
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "demo" | "live" | "good" | "bad";
}) {
  const tones: Record<string, string> = {
    neutral: "bg-navy-700 text-ink-200 border-[rgba(154,166,204,0.25)]",
    demo: "bg-[rgba(245,194,62,0.14)] text-gold border-[rgba(245,194,62,0.4)]",
    live: "bg-[rgba(139,92,246,0.16)] text-violet border-[rgba(139,92,246,0.45)]",
    good: "bg-[rgba(52,211,153,0.14)] text-correct border-[rgba(52,211,153,0.4)]",
    bad: "bg-[rgba(251,113,133,0.14)] text-wrong border-[rgba(251,113,133,0.4)]",
  };
  return (
    <span
      className={`cusp cusp-sm inline-flex items-center gap-1.5 border px-2.5 py-1 text-xs font-semibold tracking-wide ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 text-ink-300" role="status" aria-live="polite">
      <span className="size-4 animate-spin rounded-full border-2 border-electric border-t-transparent" />
      {label}
    </div>
  );
}

export function ErrorNote({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }) {
  return (
    <Panel className="max-w-xl p-6">
      <h2 className="text-xl text-wrong">{title}</h2>
      {detail ? <p className="mt-2 text-ink-200">{detail}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </Panel>
  );
}

/** The wordmark. A cusp ridge drawn as a stroke, not a borrowed logo. */
export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" aria-hidden className="size-7 shrink-0">
        <path
          d="M4 24 L10.5 8 L16 18 L21.5 8 L28 24"
          fill="none"
          stroke="var(--color-gold)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="display text-lg tracking-tight">
        CUSP{compact ? "" : " "}
        <span className="text-gold">{compact ? "" : "Showdown"}</span>
      </span>
    </span>
  );
}
