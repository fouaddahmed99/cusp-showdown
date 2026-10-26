import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import type { CognitiveLevel } from "@/contract/lrn-public-v1";
import { suggestCategories } from "@/content/board";
import {
  choiceFromLocation,
  resolveContent,
  type ContentChoice,
  type ResolvedContent,
} from "@/content/source";
import { loadProgress, saveSettings } from "@/game/persist";
import { DEFAULT_SOLO_SETTINGS, type SoloSettings } from "@/game/types";
import { normalizeSettings } from "@/game/solo";
import { useRoute } from "@/lib/router";
import { Chrome } from "@/ui/Chrome";
import { Home } from "@/ui/Home";
import { Settings } from "@/ui/Settings";
import { SoloGame } from "@/ui/SoloGame";

/**
 * The multiplayer screens pull in the Supabase client, which solo players never
 * need. Loading them on demand keeps the first paint small on a phone.
 */
const HostRoom = lazy(() => import("@/ui/HostRoom").then((m) => ({ default: m.HostRoom })));
const JoinRoom = lazy(() => import("@/ui/JoinRoom").then((m) => ({ default: m.JoinRoom })));
import { ErrorNote, Spinner, Button } from "@/ui/primitives";

export default function App() {
  const [route, navigate] = useRoute();
  const [choice, setChoice] = useState<ContentChoice>(() =>
    choiceFromLocation(typeof window === "undefined" ? "" : window.location.search),
  );
  const [content, setContent] = useState<ResolvedContent | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [settings, setSettings] = useState<SoloSettings>(DEFAULT_SOLO_SETTINGS);
  const [categories, setCategories] = useState<string[]>([]);
  const [levels, setLevels] = useState<CognitiveLevel[] | null>(null);

  // Restore saved settings once.
  useEffect(() => {
    const progress = loadProgress();
    setSettings(normalizeSettings(progress.settings));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setContentError(null);
    (async () => {
      try {
        const resolved = await resolveContent(choice);
        if (cancelled) return;
        setContent(resolved);
        setCategories((current) =>
          current.length ? current : suggestCategories(resolved.catalog, 6),
        );
      } catch (error) {
        if (!cancelled) setContentError(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [choice]);

  const progress = useMemo(() => loadProgress(), [route.name]);

  const updateSettings = useCallback((next: SoloSettings) => {
    const normalized = normalizeSettings(next);
    setSettings(normalized);
    saveSettings(normalized);
  }, []);

  const goHome = useCallback(() => navigate({ name: "home" }), [navigate]);

  if (contentError) {
    return (
      <Chrome onHome={goHome}>
        <ErrorNote
          title="Content could not be loaded"
          detail={contentError}
          action={
            <div className="flex gap-3">
              <Button tone="primary" onClick={() => setChoice("demo")}>
                Use the demo pack
              </Button>
              <Button tone="ghost" onClick={() => setChoice("auto")}>
                Try again
              </Button>
            </div>
          }
        />
      </Chrome>
    );
  }

  if (!content) {
    return (
      <Chrome onHome={goHome}>
        <Spinner label="Loading the question bank…" />
      </Chrome>
    );
  }

  return (
    <Chrome onHome={goHome}>
      {route.name === "home" ? (
        <Home
          catalog={content.catalog}
          approved={content.approved}
          note={content.note}
          isDemo={content.isDemo}
          personalBest={progress.personalBest}
          gamesPlayed={progress.gamesPlayed}
          onPlaySolo={() => navigate({ name: "solo" })}
          onHost={() => navigate({ name: "host" })}
          onJoin={() => navigate({ name: "join" })}
          onOpenSettings={() => navigate({ name: "settings" })}
        />
      ) : null}

      {route.name === "settings" ? (
        <Settings
          settings={settings}
          onChange={updateSettings}
          catalog={content.catalog}
          approved={content.approved}
          choice={choice}
          onChoiceChange={setChoice}
          categories={categories}
          onCategoriesChange={setCategories}
          levels={levels}
          onLevelsChange={setLevels}
          onClose={goHome}
        />
      ) : null}

      {route.name === "solo" ? (
        <SoloGame
          pack={content.pack}
          catalog={content.catalog}
          categories={categories}
          settings={settings}
          onSettingsChange={updateSettings}
          onExit={goHome}
          isDemo={content.isDemo}
        />
      ) : null}

      {route.name === "host" ? (
        <Suspense fallback={<Spinner label="Loading the host console…" />}>
          <HostRoom
            pack={content.pack}
            catalog={content.catalog}
            categories={categories}
            isDemo={content.isDemo}
            onExit={goHome}
          />
        </Suspense>
      ) : null}

      {route.name === "join" ? (
        <Suspense fallback={<Spinner label="Loading the buzzer…" />}>
          <JoinRoom initialCode={route.code} onExit={goHome} />
        </Suspense>
      ) : null}
    </Chrome>
  );
}
