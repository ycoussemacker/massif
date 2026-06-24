"use client";

import { useRouter } from "next/navigation";

/** Chevron "back" button — same design as the coach/discussion header (top-left, at the title level).
 *  Returns to the page of origin (browser history); falls back to `fallback` on a direct/cold load. */
export function BackButton({ fallback = "/", label = "Retour" }: { fallback?: string; label?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        if (typeof window !== "undefined" && window.history.length > 1) router.back();
        else router.push(fallback);
      }}
      className="-ml-1.5 shrink-0 rounded-lg p-1.5 text-stone-500 transition-transform hover:text-stone-800 active:scale-90 dark:text-stone-400 dark:hover:text-stone-200"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6" aria-hidden>
        <path d="m15 18-6-6 6-6" />
      </svg>
    </button>
  );
}
