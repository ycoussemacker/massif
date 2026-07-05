"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { refreshGarmin, latestDailyUpdate } from "@/app/actions";
import { useRegen } from "./regen-provider";

/** "Recharger" control on the dashboard recovery card. Garmin has no JS API (Python-only, MFA-gated),
 *  so unlike the Strava "Synchroniser" button this can't pull in-process — it fires the cloud
 *  `garmin-refresh.yml` workflow (refreshGarmin server action → GitHub workflow_dispatch) and then
 *  POLLS daily_metrics' write watermark; once the cloud job writes (~1–2 min), the route refreshes so
 *  the new recovery lands without a manual reload. A small toast carries the status. */
const POLL_INTERVAL_MS = 8_000;
const POLL_ATTEMPTS = 16; // ~2 min — covers the Python install + Garmin pull + rollup

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const advanced = (latest: string | null, since: string | null) =>
  latest != null && (since == null || Date.parse(latest) > Date.parse(since));

export function GarminRefresh() {
  const router = useRouter();
  const { setBusy } = useRegen();
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<string | null>(null);
  const running = useRef(false);

  function run() {
    if (running.current) return;
    running.current = true;
    setBusy("garmin", true); // grise la carte récupération pendant que le job cloud écrit
    startTransition(async () => {
      try {
        const { status, since } = await refreshGarmin();
        setToast(status === "running" ? "Synchro Garmin déjà en cours…" : "Synchro Garmin lancée…");

        for (let i = 0; i < POLL_ATTEMPTS; i++) {
          await sleep(POLL_INTERVAL_MS);
          const latest = await latestDailyUpdate();
          if (advanced(latest, since)) {
            router.refresh();
            setToast("Récupération Garmin à jour ✓");
            return;
          }
        }
        // Timed out waiting for the write — refresh anyway (it may land momentarily) and reassure.
        router.refresh();
        setToast("Synchro lancée — les données arriveront sous peu.");
      } catch (e) {
        setToast((e as Error)?.message ?? "Échec de la synchro Garmin");
      } finally {
        setBusy("garmin", false);
        running.current = false;
        window.setTimeout(() => setToast(null), 5000);
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      {toast && (
        <span className="text-xs text-stone-500 dark:text-stone-400">{toast}</span>
      )}
      <button
        type="button"
        onClick={run}
        disabled={pending}
        title="Recharger les données Garmin (sommeil / VFC / récupération)"
        className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 px-2.5 py-1 text-xs font-medium text-stone-500 transition-colors hover:border-garmin hover:text-garmin disabled:opacity-60 dark:border-stone-700 dark:text-stone-400"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`h-3.5 w-3.5 ${pending ? "animate-spin" : ""}`}
          aria-hidden
        >
          <path d="M21 2v6h-6" />
          <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
          <path d="M3 22v-6h6" />
          <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
        </svg>
        {pending ? "Synchro…" : "Recharger"}
      </button>
    </div>
  );
}
