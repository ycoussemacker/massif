"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

/** App-wide on-demand regeneration of the briefing + week plan. The trigger fires a plain fetch to
 *  /api/coach/regen (NOT a Server Action), so the athlete can keep navigating while the coach replans.
 *  A persistent banner — mounted in the root layout, so it survives page changes — shows progress; on
 *  completion the page refreshes. One run at a time (guarded).
 *
 *  The briefing reads the CURRENT DB state and is INSTANT — it does NOT block on a data sync (that was the
 *  source of the mobile timeout). Strava is refreshed by pull-to-refresh and Garmin by its own button;
 *  if this morning's Garmin recovery is missing, the briefing simply flags it (computeReadiness) rather
 *  than waiting on a cloud pull. */
/** Scopes d'occupation exposés à toute l'app pour GRISER les surfaces en cours de mise à jour (P5) :
 *  'regen'  = régénération du briefing/plan → carte coach + plan de la semaine ;
 *  'sync'   = sync Strava + recalcul du modèle (bouton / pull-to-refresh / auto-sync à l'ouverture)
 *             → graphs CTL/ATL/TSB, activités récentes, verdict du jour ;
 *  'garmin' = rechargement manuel Garmin → carte récupération.
 *  Producteurs : regenerate() (ici), SyncRefresh/StravaAutoRefresh, GarminRefresh via setBusy().
 *  Consommateur : <Dim on=…> (busy.tsx). */
export type BusyScope = "regen" | "sync" | "garmin";

type RegenCtx = {
  regenerating: boolean;
  regenerate: () => void;
  busy: (scope: BusyScope) => boolean;
  setBusy: (scope: "sync" | "garmin", on: boolean) => void;
};

const Ctx = createContext<RegenCtx | null>(null);
const FALLBACK: RegenCtx = { regenerating: false, regenerate: () => {}, busy: () => false, setBusy: () => {} };

export function useRegen(): RegenCtx {
  return useContext(Ctx) ?? FALLBACK;
}

export function RegenProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const running = useRef(false);
  // Compteurs (pas des booléens) : l'auto-sync à l'ouverture et un pull-to-refresh peuvent se chevaucher.
  const [busyCount, setBusyCount] = useState<{ sync: number; garmin: number }>({ sync: 0, garmin: 0 });
  const setBusy = useCallback((scope: "sync" | "garmin", on: boolean) => {
    setBusyCount((c) => ({ ...c, [scope]: Math.max(0, c[scope] + (on ? 1 : -1)) }));
  }, []);

  const regenerate = useCallback(() => {
    if (running.current) return;
    running.current = true;
    setState("running");
    setMsg("Régénération du plan…");
    (async () => {
      try {
        const r = await fetch("/api/coach/regen", { method: "POST" });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d?.ok) throw new Error(d?.error ?? "Échec de la régénération.");
        const dot = { green: "🟢", amber: "🟡", red: "🔴" }[d.readiness as string] ?? "•";
        // Dire ce que la régénération a FAIT : n ajustements (le détail est sous « Afficher plus » de la
        // carte coach), ou « réévalué, inchangé » — sinon un plan réécrit à l'identique (déterminisme :
        // mêmes données → même plan) ressemble à un coach qui n'a rien regardé.
        const n = Array.isArray(d.changes) ? d.changes.length : 0;
        setState("done");
        setMsg(n > 0
          ? `${dot} Plan ajusté — ${n} changement${n > 1 ? "s" : ""} cette semaine`
          : `${dot} Plan réévalué — inchangé (mêmes données)`);
        router.refresh();
        window.setTimeout(() => { setState("idle"); setMsg(null); }, 8000);
      } catch (e) {
        setState("error");
        // A dropped/timed-out fetch rejects with a TypeError ("Load failed" on WebKit / "Failed to
        // fetch" on Chromium) — not one of our JSON errors. Translate it into something actionable.
        const raw = (e as Error)?.message ?? "";
        const networkish = e instanceof TypeError || /load failed|failed to fetch|networkerror/i.test(raw);
        setMsg(networkish
          ? "La régénération a été interrompue (connexion coupée). Réessaie dans un instant."
          : raw || "Échec de la régénération.");
        window.setTimeout(() => { setState("idle"); setMsg(null); }, 6000);
      } finally {
        running.current = false;
      }
    })();
  }, [router]);

  const regenerating = state === "running";
  const busy = useCallback(
    (scope: BusyScope) =>
      scope === "regen" ? regenerating : busyCount[scope] > 0,
    [regenerating, busyCount],
  );

  return (
    <Ctx.Provider value={{ regenerating, regenerate, busy, setBusy }}>
      {children}
      {state !== "idle" && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-[70] flex justify-center px-4 md:bottom-4">
          <div className="pointer-events-auto flex max-w-[92vw] items-center gap-2 rounded-full border border-stone-200 bg-white/95 px-3.5 py-2 text-sm text-stone-700 shadow-lg backdrop-blur dark:border-stone-700 dark:bg-stone-900/95 dark:text-stone-200">
            {state === "running" && (
              <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-stone-300 border-t-stone-500 dark:border-stone-600 dark:border-t-stone-300" />
            )}
            <span className="min-w-0">
              {state === "running" ? (msg ?? "Ton plan se met à jour…") : msg}
            </span>
            {state === "done" && (
              <button type="button" onClick={() => router.refresh()}
                className="shrink-0 font-semibold text-alpine-700 hover:underline dark:text-alpine-300">
                Actualiser
              </button>
            )}
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
