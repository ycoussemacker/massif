"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ensureGarminFresh, garminFreshness } from "@/app/actions";

/** App-wide background regeneration of the week plan. The trigger fires a plain fetch to
 *  /api/coach/regen (NOT a Server Action), so the athlete can keep navigating while the coach replans.
 *  A persistent banner — mounted in the root layout, so it survives page changes — shows progress; on
 *  completion the page is refreshed and, if the athlete has left the PWA, a web push notifies them
 *  (sent server-side by the route). One run at a time (guarded).
 *
 *  Before briefing, it makes sure Garmin recovery reflects THIS MORNING (the coach reads sleep/HRV/
 *  readiness): if today's row is missing it kicks the cloud Garmin pull and waits for it (bounded), so a
 *  manually-regenerated brief is never blind to last night's recovery — the gap the morning cron covers
 *  with its sleep-finalized gate. If Garmin can't be refreshed in time, it proceeds on the freshest data
 *  rather than blocking the brief. */
const GARMIN_POLL_INTERVAL_MS = 8_000;
const GARMIN_POLL_ATTEMPTS = 20; // ~2.5 min for the cloud pull to land
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type RegenCtx = {
  regenerating: boolean;
  regenerate: () => void;
};

const Ctx = createContext<RegenCtx | null>(null);
const FALLBACK: RegenCtx = { regenerating: false, regenerate: () => {} };

export function useRegen(): RegenCtx {
  return useContext(Ctx) ?? FALLBACK;
}

export function RegenProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const running = useRef(false);

  const regenerate = useCallback(() => {
    if (running.current) return;
    running.current = true;
    setState("running");
    setMsg(null);
    (async () => {
      try {
        // 1. Garmin d'abord : le coach doit lire la récup de CE MATIN. Si elle manque, on lance le pull
        //    cloud (force : l'athlète régénère explicitement) et on l'attend, borné.
        setMsg("Vérification des données Garmin…");
        const e = await ensureGarminFresh(true);
        if (!e.fresh && (e.status === "dispatched" || e.status === "running")) {
          setMsg("Récupération Garmin en cours…");
          for (let i = 0; i < GARMIN_POLL_ATTEMPTS; i++) {
            await sleep(GARMIN_POLL_INTERVAL_MS);
            if ((await garminFreshness()).fresh) break;
          }
        }

        // 2. Briefing sur données à jour.
        setMsg("Régénération du plan…");
        const r = await fetch("/api/coach/regen", { method: "POST" });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d?.ok) throw new Error(d?.error ?? "Échec de la régénération.");
        const dot = { green: "🟢", amber: "🟡", red: "🔴" }[d.readiness as string] ?? "•";
        setState("done");
        setMsg(`${dot} Plan mis à jour`);
        router.refresh();
        window.setTimeout(() => { setState("idle"); setMsg(null); }, 6000);
      } catch (e) {
        setState("error");
        // A dropped/timed-out fetch rejects with a TypeError ("Load failed" on WebKit / "Failed to
        // fetch" on Chromium) — not one of our JSON errors. Translate it into something actionable
        // rather than echoing the raw browser string.
        const raw = (e as Error)?.message ?? "";
        const networkish = e instanceof TypeError || /load failed|failed to fetch|networkerror/i.test(raw);
        setMsg(networkish
          ? "La régénération a été interrompue (délai dépassé ou connexion coupée). Réessaie dans un instant."
          : raw || "Échec de la régénération.");
        window.setTimeout(() => { setState("idle"); setMsg(null); }, 6000);
      } finally {
        running.current = false;
      }
    })();
  }, [router]);

  return (
    <Ctx.Provider value={{ regenerating: state === "running", regenerate }}>
      {children}
      {state !== "idle" && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-[70] flex justify-center px-4 md:bottom-4">
          <div className="pointer-events-auto flex max-w-[92vw] items-center gap-2 rounded-full border border-stone-200 bg-white/95 px-3.5 py-2 text-sm text-stone-700 shadow-lg backdrop-blur dark:border-stone-700 dark:bg-stone-900/95 dark:text-stone-200">
            {state === "running" && (
              <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-stone-300 border-t-stone-500 dark:border-stone-600 dark:border-t-stone-300" />
            )}
            <span className="min-w-0">
              {state === "running" ? (msg ?? "Ton plan se met à jour en arrière-plan…") : msg}
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
