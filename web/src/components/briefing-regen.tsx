"use client";

import { type ReactNode } from "react";
import { useRegen } from "./regen-provider";

/** Coach-card regeneration, now backed by the app-wide BACKGROUND regen (regen-provider, mounted in the
 *  root layout). The ⋮ menu (BriefingMenu) calls `regenerate()` → fires a non-blocking fetch, so the
 *  athlete keeps navigating; the persistent banner + (if they left) a web push report completion. These
 *  thin shims keep the previous API (useBriefingRegen / BriefingRegenProvider / BriefingBody) so callers
 *  are unchanged. */

export function useBriefingRegen(): { regenerating: boolean; regenerate: () => void } {
  return useRegen();
}

/** Kept for compatibility — the real provider now lives in the root layout, so this is a pass-through. */
export function BriefingRegenProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

/** Dims brief-derived display while a regeneration is in flight (now a background run). */
export function BriefingBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  const { regenerating } = useRegen();
  return (
    <div
      aria-busy={regenerating}
      className={`transition-opacity ${regenerating ? "pointer-events-none opacity-40" : ""} ${className}`.trim()}
    >
      {children}
    </div>
  );
}
