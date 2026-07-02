"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { syncNow } from "@/app/actions";

/** Keeps Strava activities + the load model (CTL/ATL/TSB) current WITHOUT a manual pull-to-refresh.
 *  Mounted once in the root layout, it fires once per app load: unless a sync ran on this device within the
 *  throttle window, it runs syncNow() (recent-window Strava pull + rollup — the same inline work as the
 *  "Synchroniser" button / pull-to-refresh), then refreshes the route so the graphs reflect any new activity.
 *  Fully background, no UI of its own. Complements GarminAutoRefresh (recovery); together they make the
 *  dashboard self-fresh on open (previously the CTL/ATL/TSB curves only updated on the fragile pull gesture,
 *  so a new activity moved the "Activités récentes" list but not the graphs). The throttle is client-side
 *  (single-user app) so we don't re-pull Strava on every navigation/reload. */
const THROTTLE_MS = 15 * 60 * 1000; // 15 min — Strava only changes when the athlete logs a session
const KEY = "massif:strava-autosync-at";

export function StravaAutoRefresh() {
  const router = useRouter();
  const pathname = usePathname();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // once per app load (survives client-side navigation)
    if (pathname === "/login") return; // not behind auth yet — skip until the gate is passed
    ran.current = true;

    (async () => {
      try {
        const last = Number(localStorage.getItem(KEY) || 0);
        if (Number.isFinite(last) && Date.now() - last < THROTTLE_MS) return; // synced recently on this device
        localStorage.setItem(KEY, String(Date.now())); // optimistic: don't stack a second concurrent run
        await syncNow(); // recent-window Strava pull + rollup (revalidates "/" and "/coach" server-side)
        router.refresh(); // reflect any new activity on the graphs (they read the rolled-up daily_metrics)
      } catch {
        /* best-effort background sync — never surface an error for the auto path */
      }
    })();
  }, [pathname, router]);

  return null;
}
