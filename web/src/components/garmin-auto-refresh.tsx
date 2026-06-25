"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ensureGarminFresh, garminFreshness } from "@/app/actions";

/** Keeps Garmin recovery current WITHOUT a manual tap. Mounted once in the root layout, it fires once per
 *  app load: if this morning's recovery isn't in the DB yet, it kicks the cloud `garmin-refresh.yml`
 *  workflow (throttled to once / 2 h, never stacking on a run already in flight — see ensureGarminFresh),
 *  then quietly polls and refreshes the route the moment the data lands. Fully background: no UI of its
 *  own (the recovery card just updates). Garmin has no JS API, so this is the only way to pull it from the
 *  web app — same cloud-workflow path as the manual "Recharger" button. */
const POLL_INTERVAL_MS = 8_000;
const POLL_ATTEMPTS = 16; // ~2 min — Python install + Garmin pull + rollup
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function GarminAutoRefresh() {
  const router = useRouter();
  const pathname = usePathname();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // once per app load (survives client-side navigation)
    if (pathname === "/login") return; // not behind auth yet — skip until the gate is passed
    ran.current = true;

    (async () => {
      try {
        const e = await ensureGarminFresh(false);
        // Fresh / recently-tried / unavailable → nothing to wait for.
        if (e.status !== "dispatched" && e.status !== "running") return;
        for (let i = 0; i < POLL_ATTEMPTS; i++) {
          await sleep(POLL_INTERVAL_MS);
          const f = await garminFreshness();
          if (f.fresh) {
            router.refresh(); // today's recovery landed — reflect it (recovery card, coach context)
            return;
          }
        }
      } catch {
        /* best-effort background refresh — never surface an error for the auto path */
      }
    })();
  }, [pathname, router]);

  return null;
}
