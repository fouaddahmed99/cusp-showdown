import { useEffect, useState, type ReactNode } from "react";
import { sfx } from "@/audio/sfx";
import { Button, Wordmark } from "./primitives";

/**
 * The persistent frame: wordmark, sound, text size, full screen. These controls
 * matter in a seminar room, so they stay reachable on every screen.
 */
export function Chrome({
  children,
  onHome,
  right,
}: {
  children: ReactNode;
  onHome?: () => void;
  right?: ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-[rgba(154,166,204,0.14)] bg-[rgba(4,7,15,0.72)] backdrop-blur-md">
        <div className="mx-auto flex max-w-[1500px] items-center gap-4 px-4 py-3 sm:px-6">
          <button
            onClick={onHome}
            className="cusp cusp-sm px-1 py-1 text-left transition-opacity hover:opacity-80"
            aria-label="CUSP Showdown home"
          >
            <Wordmark />
          </button>
          <div className="ml-auto flex items-center gap-2">
            {right}
            <TextSizeControl />
            <SoundControl />
            <FullscreenButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1500px] px-4 pb-16 pt-6 sm:px-6">{children}</main>
    </div>
  );
}

const SIZES = [
  { label: "S", scale: 0.92 },
  { label: "M", scale: 1 },
  { label: "L", scale: 1.12 },
  { label: "XL", scale: 1.28 },
] as const;

const SIZE_KEY = "cusp-showdown:text-scale";

export function TextSizeControl() {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    try {
      const stored = Number(globalThis.localStorage?.getItem(SIZE_KEY));
      if (stored >= 0.9 && stored <= 1.3) setScale(stored);
    } catch {
      // Default scale is fine.
    }
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty("--scale", String(scale));
    try {
      globalThis.localStorage?.setItem(SIZE_KEY, String(scale));
    } catch {
      // Not load-bearing.
    }
  }, [scale]);

  return (
    <div
      className="cusp cusp-sm hidden items-center border border-[rgba(154,166,204,0.22)] sm:inline-flex"
      role="group"
      aria-label="Text size"
    >
      {SIZES.map((size) => (
        <button
          key={size.label}
          onClick={() => setScale(size.scale)}
          aria-pressed={scale === size.scale}
          className={`px-2.5 py-1.5 text-xs font-semibold transition-colors ${
            scale === size.scale ? "bg-electric text-abyss" : "text-ink-300 hover:text-ink-100"
          }`}
        >
          {size.label}
        </button>
      ))}
    </div>
  );
}

export function SoundControl() {
  const [prefs, setPrefs] = useState(sfx.state);
  useEffect(() => sfx.subscribe(setPrefs), []);

  return (
    <div className="flex items-center gap-1">
      <Button
        tone="ghost"
        size="sm"
        onClick={() => sfx.toggleMuted()}
        aria-pressed={prefs.muted}
        title={prefs.muted ? "Turn sound on" : "Mute sound"}
      >
        <span aria-hidden>{prefs.muted ? "🔇" : "🔊"}</span>
        <span className="sr-only">{prefs.muted ? "Turn sound on" : "Mute sound"}</span>
      </Button>
      <Button
        tone="ghost"
        size="sm"
        onClick={() => sfx.setMusic(!prefs.musicOn)}
        aria-pressed={prefs.musicOn}
        title={prefs.musicOn ? "Stop background music" : "Play background music"}
        className="hidden sm:inline-flex"
      >
        <span aria-hidden>♪</span>
        <span className="sr-only">
          {prefs.musicOn ? "Stop background music" : "Play background music"}
        </span>
      </Button>
    </div>
  );
}

export function FullscreenButton() {
  const [isFull, setIsFull] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFull(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  return (
    <Button
      tone="ghost"
      size="sm"
      onClick={() => {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen?.().catch(() => undefined);
      }}
      title={isFull ? "Leave full screen" : "Full screen"}
    >
      <span aria-hidden>{isFull ? "⤡" : "⛶"}</span>
      <span className="sr-only">{isFull ? "Leave full screen" : "Full screen"}</span>
    </Button>
  );
}

/** Original confetti, drawn as plain divs in the brand palette. */
export function Confetti({ pieces = 90 }: { pieces?: number }) {
  const colors = ["var(--color-gold)", "var(--color-electric)", "var(--color-violet)", "var(--color-ink-100)"];
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {Array.from({ length: pieces }, (_, i) => {
        const left = (i * 37) % 100;
        const delay = (i % 12) * 0.09;
        const drift = `${((i % 7) - 3) * 3.5}vw`;
        return (
          <span
            key={i}
            className="confetti-piece cusp cusp-sm"
            style={{
              left: `${left}%`,
              background: colors[i % colors.length],
              animationDelay: `${delay}s`,
              ["--dur" as string]: `${2.2 + (i % 5) * 0.32}s`,
              ["--drift" as string]: drift,
              ["--spin" as string]: `${320 + (i % 6) * 110}deg`,
            }}
          />
        );
      })}
    </div>
  );
}
