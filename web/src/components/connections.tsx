"use client";

import { freshness, type ConnectionStatus } from "@/lib/profile-types";
import { StravaLogo, GarminLogo } from "@/components/brand";

const DOT: Record<"ok" | "stale" | "old", string> = {
  ok: "bg-emerald-500", stale: "bg-amber-500", old: "bg-red-500",
};

function fmtDate(d: string | null): string {
  if (!d) return "jamais";
  const t = Date.parse(d.length === 10 ? d + "T00:00:00Z" : d);
  if (Number.isNaN(t)) return d;
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(t));
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex items-start justify-between gap-3 rounded-xl border border-stone-200 p-4 dark:border-stone-800">{children}</div>;
}

export function Connections({ status, justConnected }: { status: ConnectionStatus; justConnected?: boolean }) {
  const stravaFresh = freshness(status.strava.lastActivity);
  const garminFresh = freshness(status.garmin.lastRecovery);

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
      <h2 className="mb-3 text-sm font-medium text-stone-700 dark:text-stone-300">Connexions</h2>

      {justConnected && (
        <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
          Strava connecté ✓ — le prochain sync utilisera ce compte.
        </p>
      )}

      <div className="space-y-3">
        {/* Strava */}
        <Row>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${DOT[stravaFresh]}`} />
              <StravaLogo className="h-5 w-5 shrink-0 text-strava" />
              <span className="font-semibold text-strava">Strava</span>
              {status.strava.connected
                ? <span className="text-xs text-stone-400">connecté{status.strava.athleteId ? ` · athlète ${status.strava.athleteId}` : ""}</span>
                : <span className="text-xs text-amber-600">token via .env (non connecté depuis l&apos;UI)</span>}
            </div>
            <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
              Dernière activité synchronisée : {fmtDate(status.strava.lastActivity)}
            </p>
          </div>
          <a
            href="/api/strava/authorize"
            className="shrink-0 rounded-lg border border-strava px-3 py-1.5 text-sm font-medium text-strava transition-colors hover:bg-strava/10"
          >
            {status.strava.connected ? "Reconnecter" : "Connecter"} Strava
          </a>
        </Row>

        {/* Garmin */}
        <Row>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${DOT[garminFresh]}`} />
              <GarminLogo className="h-4 w-auto shrink-0 text-garmin" />
            </div>
            <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
              Dernières données de récupération : {fmtDate(status.garmin.lastRecovery)}
            </p>
            <p className="mt-1 text-xs text-stone-400">
              La reconnexion Garmin se fait en ligne de commande (MFA) :{" "}
              <code className="rounded bg-stone-100 px-1 dark:bg-stone-800">ingest/.venv/bin/python -m massif_ingest.garmin</code>
            </p>
          </div>
        </Row>
      </div>
    </section>
  );
}
