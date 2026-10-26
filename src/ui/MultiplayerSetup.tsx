import { multiplayerStatus } from "@/multiplayer/config";
import { Badge, Button, Panel } from "./primitives";

/**
 * Shown instead of a room when no Supabase project is configured. It says what
 * is missing and how to fix it, and it does not pretend a room can be made.
 */
export function MultiplayerSetup({ onExit }: { onExit: () => void }) {
  const status = multiplayerStatus();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Panel className="p-6 sm:p-8">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="display text-3xl">Live multiplayer needs a database</h1>
          <Badge tone="neutral">Not configured</Badge>
        </div>
        <p className="mt-3 text-ink-200">
          Hosting and joining run on a Supabase project — free tier, no account needed from the
          residents playing. {status.reason}
        </p>
        <p className="mt-3 text-ink-200">
          Solo practice works without any of this, so you can use the board today and wire up the
          room when you are ready.
        </p>

        <ol className="mt-6 space-y-4 text-ink-200">
          <li>
            <span className="font-semibold text-ink-100">1. Create a project.</span> At
            supabase.com, make a free project. Any region close to the residency is fine.
          </li>
          <li>
            <span className="font-semibold text-ink-100">2. Run the schema.</span> Open the SQL
            editor and run <code className="text-electric">supabase/schema.sql</code> from this
            repository. It creates the tables, the row-level security policies, and the functions
            that own scoring and buzz order.
          </li>
          <li>
            <span className="font-semibold text-ink-100">3. Add two repository secrets.</span> In
            GitHub, under Settings → Secrets and variables → Actions, add{" "}
            <code className="text-electric">VITE_SUPABASE_URL</code> and{" "}
            <code className="text-electric">VITE_SUPABASE_ANON_KEY</code> from the project's API
            settings. The anon key is meant to be public; every write it can reach is checked
            server-side against a room token.
          </li>
          <li>
            <span className="font-semibold text-ink-100">4. Redeploy.</span> Push to{" "}
            <code className="text-electric">main</code>, or run the Deploy workflow by hand. The
            Host and Join buttons light up on the next build.
          </li>
        </ol>

        <p className="mt-6 text-sm text-ink-300">
          For local development, put the same two values in a{" "}
          <code className="text-electric">.env.local</code> file and restart{" "}
          <code className="text-electric">pnpm dev</code>.
        </p>

        <div className="mt-7">
          <Button tone="primary" onClick={onExit}>
            Back to the start
          </Button>
        </div>
      </Panel>
    </div>
  );
}
