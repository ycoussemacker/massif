"use client";

import { freshness, type ConnectionStatus } from "@/lib/profile-types";

const DOT: Record<"ok" | "stale" | "old", string> = {
  ok: "bg-emerald-500", stale: "bg-amber-500", old: "bg-red-500",
};

// Official brand marks (Simple Icons), inlined so no external asset / CSP issue. fill=currentColor.
const STRAVA_PATH =
  "M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169";
const GARMIN_PATH =
  "M6.265 12.024a.289.289 0 0 0-.236-.146h-.182a.289.289 0 0 0-.234.146l-1.449 3.025c-.041.079.004.138.094.138h.335c.132 0 .193-.061.228-.134.037-.073.116-.234.13-.266.02-.045.083-.071.175-.071h1.559c.089 0 .148.016.175.071.018.035.098.179.136.256a.24.24 0 0 0 .234.142h.486c.089 0 .13-.069.098-.132-.034-.061-1.549-3.029-1.549-3.029zm-.914 2.224c-.089 0-.132-.067-.094-.148l.571-1.222c.039-.081.1-.081.136 0l.555 1.222c.037.081-.006.148-.096.148H5.351zm12.105-2.201v3.001c0 .083.073.138.163.138h.396c.089 0 .163-.057.163-.146v-2.998c0-.089-.059-.163-.148-.163h-.411c-.09-.001-.163.054-.163.168zm-6.631 1.88c-.051-.073-.022-.154.063-.181 0 0 .342-.102.506-.25.165-.146.246-.36.246-.636a1 1 0 0 0-.096-.457.787.787 0 0 0-.27-.303 1.276 1.276 0 0 0-.423-.171c-.165-.035-.386-.047-.386-.047a8.81 8.81 0 0 0-.325-.008H8.495a.164.164 0 0 0-.163.163v2.998c0 .089.073.146.163.146h.388c.089 0 .163-.057.163-.146v-1.193s.002 0 .002-.002l.738-.002c.089 0 .205.061.258.134l.766 1.077c.071.096.138.132.228.132h.508c.089 0 .104-.085.073-.128-.032-.038-.794-1.126-.794-1.126zm-.311-.61a1.57 1.57 0 0 1-.213.028 8.807 8.807 0 0 1-.325.006h-.763a.164.164 0 0 1-.163-.163v-.608c0-.089.073-.163.163-.163h.762c.089 0 .236.004.325.006 0 0 .114.004.213.028a.629.629 0 0 1 .24.098.358.358 0 0 1 .126.148.473.473 0 0 1 0 .374.352.352 0 0 1-.126.148.617.617 0 0 1-.239.098zm11.803-1.439c-.089 0-.163.059-.163.146v1.919c0 .089-.051.11-.114.047l-1.921-1.992a.376.376 0 0 0-.276-.118h-.362c-.114 0-.163.061-.163.122v3.068c0 .061.059.12.148.12h.362c.089 0 .152-.049.152-.132l.002-2.021c0-.089.051-.11.114-.045l2.004 2.082a.36.36 0 0 0 .279.116h.272a.164.164 0 0 0 .163-.163v-2.986a.164.164 0 0 0-.163-.163h-.334zm-7.835 1.87c-.043.079-.116.077-.159 0l-.939-1.724a.262.262 0 0 0-.236-.146h-.51a.164.164 0 0 0-.163.163v2.996c0 .089.059.15.163.15h.317c.089 0 .154-.057.154-.142 0-.041.002-2.179.004-2.179.004 0 1.173 2.177 1.173 2.177a.105.105 0 0 0 .189 0s1.179-2.173 1.181-2.173c.004 0 .002 2.11.002 2.173 0 .087.069.142.159.142h.364c.089 0 .163-.045.163-.163V12.04a.164.164 0 0 0-.163-.163h-.488a.265.265 0 0 0-.244.142l-.967 1.729zM0 13.529c0 1.616 1.653 1.697 1.984 1.697 1.098 0 1.561-.297 1.58-.309a.29.29 0 0 0 .152-.264v-1.116a.186.186 0 0 0-.187-.187H2.151c-.104 0-.171.083-.171.187v.116c0 .104.067.187.171.187h.797a.14.14 0 0 1 .14.14v.52c-.157.065-.874.274-1.451.136-.836-.199-.901-.89-.901-1.096 0-.173.053-1.043 1.079-1.13.831-.071 1.378.264 1.384.268.098.051.199.014.254-.089l.104-.209c.043-.085.028-.175-.077-.246-.006-.004-.59-.319-1.494-.319C.055 11.813 0 13.354 0 13.529zm22.134-2.478h-2.165c-.079 0-.148-.039-.187-.108s-.039-.146 0-.215l1.084-1.874a.21.21 0 0 1 .187-.108.21.21 0 0 1 .187.108l1.084 1.874a.203.203 0 0 1 0 .215.22.22 0 0 1-.19.108zm1.488 3.447c.207 0 .378.169.378.378a.379.379 0 0 1-.378.378.379.379 0 0 1-.378-.378.38.38 0 0 1 .378-.378zm.002.7c.173 0 .305-.14.305-.321s-.13-.321-.305-.321-.307.14-.307.321c0 .18.13.321.307.321zm-.146-.543h.169c.102 0 .152.041.152.124 0 .071-.045.122-.114.122l.126.195h-.077l-.124-.195h-.061v.195h-.073v-.441h.002zm.073.189h.085c.055 0 .091-.012.091-.069 0-.051-.045-.065-.091-.065h-.085v.134z";

function StravaLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" role="img" aria-label="Strava" fill="currentColor" className={className}>
      <path d={STRAVA_PATH} />
    </svg>
  );
}
function GarminLogo({ className }: { className?: string }) {
  // Crop to the wordmark's bbox (y 8.75–15.25) so it isn't tiny inside the 24×24 canvas.
  return (
    <svg viewBox="0 8.5 24 7" role="img" aria-label="Garmin" fill="currentColor" className={className}>
      <path d={GARMIN_PATH} />
    </svg>
  );
}

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
