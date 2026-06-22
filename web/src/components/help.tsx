"use client";

import { useEffect, useState } from "react";

export type HelpBlock =
  | { type: "p"; text: string }
  | { type: "dl"; items: { k: string; v: string }[] }
  | { type: "formula"; lines: string[] }
  | { type: "example"; text: string };

export type HelpContent = { title: string; blocks: HelpBlock[] };

function Block({ b }: { b: HelpBlock }) {
  switch (b.type) {
    case "p":
      return <p className="text-sm leading-relaxed text-stone-600 dark:text-stone-300">{b.text}</p>;
    case "dl":
      return (
        <dl className="space-y-1.5 text-sm">
          {b.items.map((it, i) => (
            <div key={i}>
              <dt className="inline font-medium text-stone-800 dark:text-stone-200">{it.k}</dt>{" "}
              <dd className="inline text-stone-600 dark:text-stone-400">— {it.v}</dd>
            </div>
          ))}
        </dl>
      );
    case "formula":
      return (
        <div className="rounded-lg bg-stone-100 p-3 font-mono text-xs leading-relaxed text-stone-700 dark:bg-stone-800 dark:text-stone-200">
          {b.lines.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      );
    case "example":
      return (
        <div className="rounded-lg border-l-2 border-alpine-400 bg-alpine-50 px-3 py-2 text-sm text-stone-700 dark:bg-alpine-950/30 dark:text-stone-300">
          <span className="font-medium">Exemple — </span>{b.text}
        </div>
      );
  }
}

/** A "?" badge that opens a click-to-show modal (mobile-friendly bottom-sheet on small screens). */
export function HelpButton({ content }: { content: HelpContent }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Aide : ${content.title}`}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-stone-300 text-[11px] font-normal text-stone-400 transition-colors hover:border-alpine-400 hover:text-alpine-500 dark:border-stone-600"
      >
        ?
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-[1px] sm:items-center sm:p-4"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="max-h-[85vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:max-w-lg sm:rounded-2xl dark:bg-stone-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <h3 className="text-base font-semibold text-stone-900 dark:text-stone-50">{content.title}</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fermer"
                className="-mr-1 -mt-1 rounded-md p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800"
              >
                ✕
              </button>
            </div>
            <div className="space-y-3">
              {content.blocks.map((b, i) => <Block key={i} b={b} />)}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
