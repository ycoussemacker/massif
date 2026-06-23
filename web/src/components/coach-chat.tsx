"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { sendCoachMessage, commentActivities } from "@/app/actions";
import { READINESS, SYSTEM_TAG_FR, sportName, sportIcon, type Readiness } from "@/lib/labels";
import { Markdown } from "@/components/markdown";
import { ActivitySnapshot } from "@/components/activity-snapshot";
import type { TimelineItem } from "@/lib/chat";

function dur(s: number | null | undefined): string {
  if (!s) return "—";
  const m = Math.round(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}` : `${m} min`;
}
const r0 = (n: number | null | undefined) => (n == null ? "—" : String(Math.round(n)));

function BriefingBubble({ b }: { b: Extract<TimelineItem, { kind: "briefing" }>["briefing"] }) {
  const r = b.readiness ? READINESS[b.readiness as Readiness] : null;
  return (
    <div className="max-w-[92%] self-start break-words rounded-2xl rounded-bl-md border border-stone-200 bg-white p-4 shadow-sm sm:max-w-[85%] dark:border-stone-800 dark:bg-stone-900">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <span className={`flex items-center gap-1.5 font-semibold ${r?.text ?? ""}`}>
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${r?.dot ?? "bg-stone-400"}`} />
          {r?.label ?? b.readiness ?? "—"}
        </span>
        <span className="text-stone-500 dark:text-stone-400">
          Briefing du {b.briefing_date}
          {b.confidence != null && ` · confiance ${Math.round(b.confidence * 100)} %`}
        </span>
      </div>
      {b.today_session && <p className="font-medium">Aujourd&apos;hui → {b.today_session}</p>}
      {b.why && <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">{b.why}</p>}
      {b.flag && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          ⚠️ {b.flag}
        </p>
      )}
      {b.week_skeleton?.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {b.week_skeleton.map((d) => (
            <span key={d.day_offset} title={d.focus}
              className="rounded-md border border-stone-200 px-2 py-1 text-xs text-stone-600 dark:border-stone-700 dark:text-stone-300">
              <span className="font-medium">+{d.day_offset} j</span> {SYSTEM_TAG_FR[d.system_tag] ?? d.system_tag}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** One day's activities in a single bubble, with the "Commente" button fused at the bottom.
 *  The card body (header + per-session lines) is the shared <ActivitySnapshot> — same look the
 *  dashboard coach card reuses as its conversation "snapshot". */
function ActivityGroupCard({
  group, onComment, pending,
}: {
  group: Extract<TimelineItem, { kind: "activity_group" }>;
  onComment: (localDate: string, count: number, whenLabel: string) => void;
  pending: boolean;
}) {
  const n = group.activities.length;
  return (
    <div className="w-full self-center sm:max-w-md">
      <ActivitySnapshot
        dateLabel={group.dateLabel}
        activities={group.activities}
        footer={group.commentable && (
          <button
            type="button"
            onClick={() => onComment(group.localDate, n, group.whenLabel)}
            disabled={pending}
            className="flex min-h-11 w-full items-center justify-center gap-2 border-t border-stone-200 bg-alpine-50 px-4 py-3 text-sm font-semibold text-alpine-700 transition active:bg-alpine-200 enabled:hover:bg-alpine-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-stone-800 dark:bg-alpine-950/30 dark:text-alpine-300 dark:enabled:hover:bg-alpine-950/50"
          >
            💬 {n > 1 ? "Commente ces activités" : "Commente cette activité"}
          </button>
        )}
      />
    </div>
  );
}

function MessageBubble({ m }: { m: Extract<TimelineItem, { kind: "message" }> }) {
  if (m.role === "user") {
    return (
      <div className="bg-message max-w-[85%] self-end whitespace-pre-wrap break-words rounded-2xl rounded-br-md px-3.5 py-2.5 text-[15px] text-white sm:max-w-[80%] sm:text-sm">
        {m.content}
      </div>
    );
  }
  return (
    <div className="max-w-[92%] self-start break-words rounded-2xl rounded-bl-md border border-stone-200 bg-white px-3.5 py-2.5 sm:max-w-[85%] dark:border-stone-800 dark:bg-stone-900">
      {m.messageKind === "activity_comment" && (
        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-stone-400">Commentaire de séance</div>
      )}
      <Markdown>{m.content}</Markdown>
      {m.messageKind === "activity_comment" && m.refActivities && m.refActivities.length > 0 && (
        <div className="mt-2.5 border-t border-stone-100 pt-2 opacity-60 dark:border-stone-800">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-stone-400">↳ En référence à</div>
          <ul className="space-y-0.5">
            {m.refActivities.map((a) => {
              const ref = [
                dur(a.duration_s),
                a.distance_m != null ? `${(a.distance_m / 1000).toFixed(1)} km` : null,
                a.vertical_gain_m != null || a.vertical_loss_m != null
                  ? `D+ ${r0(a.vertical_gain_m)} / D− ${r0(a.vertical_loss_m)}` : null,
              ].filter(Boolean).join(" · ");
              return (
                <li key={a.id} className="flex flex-wrap items-center gap-x-1.5 text-xs text-stone-500 dark:text-stone-400">
                  <span aria-hidden>{sportIcon(a.sport_code)}</span>
                  <span className="font-medium text-stone-600 dark:text-stone-300">{sportName(a.sport_code, a.sport)}</span>
                  <span>· {r0(a.training_load)} pts · {ref}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

export function CoachChat({ timeline }: { timeline: TimelineItem[] }) {
  const [isPending, startTransition] = useTransition();
  const [draft, setDraft] = useState("");
  const [optimistic, setOptimistic] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [timeline.length, isPending, optimistic]);

  function autosize() {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }

  function run(bubble: string, fn: () => Promise<void>) {
    setError(null);
    setOptimistic(bubble);
    startTransition(async () => {
      try {
        await fn();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Une erreur est survenue.");
      } finally {
        setOptimistic(null);
      }
    });
  }

  function handleSend() {
    const text = draft.trim();
    if (!text || isPending) return;
    setDraft("");
    requestAnimationFrame(() => { if (taRef.current) taRef.current.style.height = "auto"; });
    run(text, () => sendCoachMessage(text));
  }

  function handleComment(localDate: string, count: number, whenLabel: string) {
    if (isPending) return;
    const what = count > 1 ? "mes activités" : "mon activité";
    run(`Peux-tu commenter ${what} ${whenLabel} ?`, () => commentActivities(localDate));
  }

  return (
    <div className="flex h-full flex-col">
      {/* Fil de discussion */}
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-1 py-4">
        {timeline.length === 0 && (
          <p className="my-8 text-center text-sm text-stone-500">
            Pas encore de briefing ni d&apos;activité. Lance le coach, puis reviens discuter ici.
          </p>
        )}
        {timeline.map((it) => {
          if (it.kind === "briefing") return <BriefingBubble key={`b-${it.at}`} b={it.briefing} />;
          if (it.kind === "activity_group")
            return <ActivityGroupCard key={`g-${it.localDate}`} group={it} onComment={handleComment} pending={isPending} />;
          return <MessageBubble key={`m-${it.id}`} m={it} />;
        })}

        {/* Échange optimiste pendant la génération */}
        {optimistic && (
          <div className="bg-message max-w-[85%] self-end whitespace-pre-wrap break-words rounded-2xl rounded-br-md px-3.5 py-2.5 text-[15px] text-white opacity-80 sm:max-w-[80%] sm:text-sm">
            {optimistic}
          </div>
        )}
        {isPending && (
          <div className="self-start rounded-2xl rounded-bl-md border border-stone-200 bg-white px-4 py-2.5 text-sm text-stone-400 dark:border-stone-800 dark:bg-stone-900">
            <span className="inline-flex items-center gap-1">
              le coach réfléchit
              <span className="inline-flex gap-0.5">
                <span className="h-1 w-1 animate-bounce rounded-full bg-stone-400 [animation-delay:-0.3s]" />
                <span className="h-1 w-1 animate-bounce rounded-full bg-stone-400 [animation-delay:-0.15s]" />
                <span className="h-1 w-1 animate-bounce rounded-full bg-stone-400" />
              </span>
            </span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {error && (
        <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}

      {/* Composer (mobile-first ; safe-area pour la barre d'accueil iOS) */}
      <div className="border-t border-stone-200 pt-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] dark:border-stone-800">
        <div className="flex items-end gap-2">
          <textarea
            ref={taRef}
            value={draft}
            onChange={(e) => { setDraft(e.target.value); autosize(); }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                // Sur écran tactile : Entrée = retour à la ligne ; on envoie avec le bouton.
                const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
                if (coarse) return;
                e.preventDefault();
                handleSend();
              }
            }}
            rows={1}
            placeholder="Écris à ton coach…"
            disabled={isPending}
            className="max-h-40 min-h-11 flex-1 resize-none rounded-2xl border border-stone-300 bg-white px-3.5 py-2.5 text-base outline-none focus:border-alpine-400 focus:ring-2 focus:ring-alpine-200 disabled:opacity-60 sm:text-sm dark:border-stone-700 dark:bg-stone-900 dark:focus:ring-alpine-900"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={isPending || !draft.trim()}
            aria-label="Envoyer"
            className="h-11 shrink-0 rounded-2xl bg-alpine-600 px-4 text-sm font-semibold text-white transition active:bg-alpine-800 enabled:hover:bg-alpine-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Envoyer
          </button>
        </div>
      </div>
    </div>
  );
}
