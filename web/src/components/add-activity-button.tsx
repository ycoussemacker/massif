"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { QuickAddEvent } from "@/components/quick-add-event";
import type { SportOption } from "@/lib/activities";

/** Primary CTA on the homepage plan card: opens the planned-activity capture in a MODAL (same flow as
 *  the calendar's day sheet, `QuickAddEvent variant="modal"`). Putting capture behind an explicit
 *  button — rather than an always-on text field — is deliberate: the field opens empty each time and the
 *  modal closes on save, so the athlete is far less likely to declare the same event twice. */
export function AddActivityButton({ sports }: { sports: SportOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-alpine-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-alpine-700 sm:w-auto"
      >
        <span aria-hidden className="text-base leading-none">+</span>
        Ajouter une activité
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/40 p-4 backdrop-blur-sm sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-stone-200 bg-white p-4 shadow-xl dark:border-stone-800 dark:bg-stone-900"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Ajouter une activité prévue"
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-50">Ajouter une activité prévue</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-stone-400 transition hover:text-stone-600 dark:hover:text-stone-300"
                aria-label="Fermer"
              >
                ✕
              </button>
            </div>
            <QuickAddEvent
              sports={sports}
              variant="modal"
              onSaved={() => { setOpen(false); router.refresh(); }}
            />
          </div>
        </div>
      )}
    </>
  );
}
