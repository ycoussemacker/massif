"use client";

import { useState } from "react";
import Link from "next/link";
import { Markdown } from "./markdown";

/** Poser une question au coach depuis le dashboard, sans quitter la page.
 *
 *  L'agent vivait uniquement dans /coach ; ce champ l'expose là où l'athlète arrive. Il passe par la
 *  route API (et non par une Server Action) pour ne pas bloquer la navigation pendant les ~15 s que
 *  prend un tour — l'échange est persisté dans la conversation, donc la réponse est aussi consultable
 *  sur /coach, avec ses éventuelles cartes de proposition.
 *
 *  Design : bordé et non ombré, accent Alpine. Le dégradé `bg-massif` reste réservé au CTA coach
 *  principal (charte) — ce champ est une entrée secondaire, il ne le porte pas. */
const SUGGESTIONS = [
  "Je suis prêt pour mon objectif ?",
  "Pourquoi ma séance de demain est facile ?",
  "J'ai deux jours ce week-end, je fais quoi ?",
];

export function CoachAsk({ coachName }: { coachName: string }) {
  const [text, setText] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [tools, setTools] = useState<string[]>([]);
  const [proposals, setProposals] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || pending) return;
    setPending(true); setError(null); setAnswer(null); setTools([]); setProposals(0);
    try {
      const res = await fetch("/api/coach/ask", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: q }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Le coach n'a pas répondu.");
      setAnswer(data.answer);
      setTools(data.tools ?? []);
      setProposals(data.proposals ?? 0);
      setText("");
    } catch (e) {
      setError((e as Error)?.message ?? "Le coach n'a pas répondu.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="mt-4 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
      <form
        onSubmit={(e) => { e.preventDefault(); void ask(text); }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={pending}
          maxLength={4000}
          placeholder={`Pose une question à ${coachName}…`}
          aria-label="Question au coach"
          className="min-h-11 flex-1 rounded-xl border border-stone-200 bg-page px-3.5 text-[15px] text-stone-800 placeholder:text-stone-400 focus:border-alpine-400 focus:outline-none disabled:opacity-60 sm:text-sm dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100"
        />
        <button
          type="submit"
          disabled={pending || !text.trim()}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-alpine-50 px-4 text-sm font-semibold text-alpine-700 transition enabled:hover:bg-alpine-100 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-alpine-950/40 dark:text-alpine-300 dark:enabled:hover:bg-alpine-950/60"
        >
          {pending ? (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-4 w-4 animate-spin" aria-hidden>
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
              Il réfléchit…
            </>
          ) : "Demander"}
        </button>
      </form>

      {!answer && !pending && !error && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => void ask(s)}
              className="rounded-full border border-stone-200 px-3 py-1.5 text-xs text-stone-600 transition hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          {error}
        </p>
      )}

      {answer && (
        <div className="mt-3 border-t border-stone-100 pt-3 dark:border-stone-800">
          <Markdown>{answer}</Markdown>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
            {/* Ce que l'agent a réellement consulté — la transparence coûte une ligne et évite le
                « d'où il sort ça ? ». */}
            {tools.length > 0 && <span>Données consultées : {tools.join(", ")}</span>}
            {proposals > 0 && (
              <span className="font-medium text-alpine-700 dark:text-alpine-300">
                {proposals} proposition{proposals > 1 ? "s" : ""} à valider dans la conversation
              </span>
            )}
            <Link href="/coach" className="font-medium text-alpine-700 underline-offset-2 hover:underline dark:text-alpine-300">
              Ouvrir la conversation →
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}
