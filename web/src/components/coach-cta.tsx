"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { commentActivities } from "@/app/actions";

// The single primary coach CTA — the only sanctioned use of the bg-massif gradient (design system).
const BTN =
  "bg-massif inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 active:opacity-95 disabled:opacity-70 sm:w-auto";

/** The one button under the coach card. With a logged session today it asks the coach to debrief it
 *  (commentActivities → AI reply) then opens /coach; otherwise it's a plain link into the conversation.
 *  Replaces the old "Discuter" CTA + the separate debrief section (one button, one destination). */
export function CoachCta({
  coachName, debriefDate, sessionCount = 1,
}: {
  coachName: string;
  debriefDate: string | null;
  sessionCount?: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!debriefDate) {
    // Rien à débriefer aujourd'hui → simple entrée vers la conversation (même bouton dégradé).
    return (
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Link href="/coach" className={BTN}>💬 Discuter avec {coachName}</Link>
        <span className="hidden text-sm text-stone-500 sm:inline dark:text-stone-400">
          Pose-lui une question, commente ta séance
        </span>
      </div>
    );
  }

  const debrief = () => {
    setError(null);
    startTransition(async () => {
      try {
        await commentActivities(debriefDate);
        router.push("/coach");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Échec — réessaie dans un instant.");
      }
    });
  };

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={debrief} disabled={pending} className={BTN}>
          {pending ? (
            <>
              <svg viewBox="0 0 24 24" className="h-4 w-4 animate-spin" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                <path d="M21 12a9 9 0 1 1-6.219-8.56" strokeLinecap="round" />
              </svg>
              {coachName} regarde ta séance…
            </>
          ) : (
            <>💬 Débrief avec {coachName}</>
          )}
        </button>
        <span className="hidden text-sm text-stone-500 sm:inline dark:text-stone-400">
          {coachName} commente {sessionCount > 1 ? "tes séances" : "ta séance"} dans la conversation
        </span>
      </div>
      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
