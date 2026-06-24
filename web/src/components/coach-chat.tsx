"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { sendCoachMessage, commentActivities, loadOlderConversation } from "@/app/actions";
import { READINESS, SYSTEM_TAG_FR, sportName, sportIcon, type Readiness } from "@/lib/labels";
import { Markdown } from "@/components/markdown";
import { ActivitySnapshot } from "@/components/activity-snapshot";
import { CoachProposalCard } from "@/components/coach-proposal-card";
import type { TimelineItem } from "@/lib/chat";

function dur(s: number | null | undefined): string {
  if (!s) return "—";
  const m = Math.round(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}` : `${m} min`;
}
const r0 = (n: number | null | undefined) => (n == null ? "—" : String(Math.round(n)));

/** Stable de-dupe key per timeline item (message id / briefing instant / activity day). */
function keyOf(it: TimelineItem): string {
  return it.kind === "message" ? `m-${it.id}` : it.kind === "briefing" ? `b-${it.at}` : `g-${it.localDate}`;
}

/** Add an item to the keyed map. For an activity DAY that straddles a page boundary (some of its
 *  activities in one page, the rest in another), UNION the day's activities instead of dropping a half —
 *  otherwise paging older would silently lose the activities that fell on the far side of the cursor. */
function addItem(map: Map<string, TimelineItem>, it: TimelineItem): void {
  const k = keyOf(it);
  const prev = map.get(k);
  if (it.kind === "activity_group" && prev && prev.kind === "activity_group") {
    const byId = new Map(prev.activities.map((x) => [x.id, x]));
    for (const x of it.activities) byId.set(x.id, x);
    const activities = [...byId.values()].sort((p, q) => (p.started_at < q.started_at ? -1 : p.started_at > q.started_at ? 1 : 0));
    map.set(k, { ...prev, activities, at: activities[activities.length - 1].started_at });
  } else {
    map.set(k, it);
  }
}

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
              <span className="font-medium">{d.day_offset === 0 ? "Auj." : `+${d.day_offset} j`}</span>{" "}
              {d.sport_code ? <span aria-hidden>{sportIcon(d.sport_code)} </span> : null}
              {SYSTEM_TAG_FR[d.system_tag] ?? d.system_tag}
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

export function CoachChat({
  timeline, initialCursor, initialHasMore,
}: {
  timeline: TimelineItem[];          // the latest page (≤ 10 messages + co-temporal context) — refreshed on send
  initialCursor: string | null;       // created_at of the oldest message in `timeline` (paging cursor)
  initialHasMore: boolean;            // is there an older message to page back to?
}) {
  const [isPending, startTransition] = useTransition();
  const [draft, setDraft] = useState("");
  const [optimistic, setOptimistic] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(initialCursor);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);          // synchronous guard against double-fire from rapid scroll
  const prevScrollHeight = useRef<number | null>(null); // for scroll-position preservation on prepend
  const didInitialScroll = useRef(false);    // arms scroll-to-top loading only after the mount jump
  const armed = useRef(true);                 // one auto-load per arrival at the top (no fast cascade)

  // We ACCUMULATE every item shown, keyed stably, instead of re-rendering the prop directly: paging older
  // adds history at the top, while a post-send refresh (the capped "latest 10" slides forward) merges the
  // new turn in WITHOUT dropping the oldest visible messages that fell out of the latest page.
  const [merged, setMerged] = useState<Map<string, TimelineItem>>(() => new Map(timeline.map((it) => [keyOf(it), it])));
  // Merge the latest-page prop whenever it changes (a send/reply refresh) — DURING render, guarded by
  // reference so it runs exactly once per change. This is React's recommended alternative to a
  // setState-in-effect ("adjusting state when a prop changes"): no extra paint, no cascade.
  const [seenTimeline, setSeenTimeline] = useState(timeline);
  if (timeline !== seenTimeline) {
    setSeenTimeline(timeline);
    setMerged((prev) => {
      const next = new Map(prev);
      for (const it of timeline) addItem(next, it); // latest page wins (fresh briefings/replies); days union
      return next;
    });
  }
  const thread = useMemo(
    () => [...merged.values()].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)),
    [merged],
  );

  // Auto-scroll to the newest message — on mount and on each send/reply. Deliberately keyed only on the
  // latest-page prop (+ pending/optimistic), NOT on the merged thread, so paging older messages never
  // yanks the view back to the bottom. The FIRST positioning is an instant jump: a smooth scroll would
  // animate up from the top and its early frames (scrollTop ≈ 0) would spuriously trip the top loader.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: didInitialScroll.current ? "smooth" : "auto" });
    didInitialScroll.current = true;
  }, [timeline.length, isPending, optimistic]);

  // Preserve the viewport when older messages are prepended: keep the same content under the user's eyes
  // by pushing scrollTop down by the height just added above. Runs before paint (no flash). Gated by
  // prevScrollHeight, which ONLY loadOlder sets — so an append (send/reply) skips it and scrolls to bottom.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (el && prevScrollHeight.current != null) {
      el.scrollTop += el.scrollHeight - prevScrollHeight.current;
      prevScrollHeight.current = null;
    }
  }, [thread]);

  const loadOlder = useCallback(async () => {
    if (loadingRef.current || !hasMore || !cursor) return;
    loadingRef.current = true;
    setLoadingOlder(true);
    prevScrollHeight.current = scrollerRef.current?.scrollHeight ?? null;
    try {
      const res = await loadOlderConversation(cursor);
      if (res.items.length) {
        setMerged((prev) => {
          const next = new Map(prev);
          for (const it of res.items) addItem(next, it); // prepend older page; straddling days re-assemble
          return next;
        });
      } else {
        prevScrollHeight.current = null; // nothing prepended → don't shift the view
      }
      setCursor(res.cursor);
      setHasMore(!res.done);
    } catch {
      prevScrollHeight.current = null;
      setError("Impossible de charger les messages précédents.");
    } finally {
      loadingRef.current = false;
      setLoadingOlder(false);
    }
  }, [hasMore, cursor]);

  // Reaching the top pulls the next page of 10 — but only ONCE per arrival at the top: `armed` re-arms
  // only after the user scrolls back down past 200px, so a short batch can't cascade into loading
  // everything at once (the button stays available to keep paging deliberately).
  function onScroll() {
    const el = scrollerRef.current;
    if (!el || !didInitialScroll.current) return;
    if (el.scrollTop <= 60) {
      if (armed.current) { armed.current = false; void loadOlder(); }
    } else if (el.scrollTop > 200) {
      armed.current = true;
    }
  }

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
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="flex flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-1 py-4"
      >
        {/* Haut du fil : charge les 10 messages précédents (scroll-to-top OU clic si le fil est trop
            court pour défiler). Une fois le tout premier message atteint, on affiche la butée. */}
        {hasMore ? (
          <div className="flex justify-center pb-1">
            <button
              type="button"
              onClick={() => void loadOlder()}
              disabled={loadingOlder}
              className="rounded-full border border-stone-200 bg-white px-3.5 py-1.5 text-xs font-medium text-stone-500 transition enabled:hover:bg-stone-50 enabled:hover:text-stone-700 disabled:opacity-60 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-400 dark:enabled:hover:bg-stone-800"
            >
              {loadingOlder ? "Chargement…" : "Charger les messages précédents"}
            </button>
          </div>
        ) : thread.length > 0 ? (
          <p className="pb-1 text-center text-xs text-stone-400 dark:text-stone-500">· Début de la conversation ·</p>
        ) : null}
        {thread.length === 0 && !hasMore && (
          <p className="my-8 text-center text-sm text-stone-500">
            Pas encore de briefing ni d&apos;activité. Lance le coach, puis reviens discuter ici.
          </p>
        )}
        {thread.map((it) => {
          if (it.kind === "briefing") return <BriefingBubble key={`b-${it.at}`} b={it.briefing} />;
          if (it.kind === "activity_group")
            return <ActivityGroupCard key={`g-${it.localDate}`} group={it} onComment={handleComment} pending={isPending} />;
          return (
            <Fragment key={`m-${it.id}`}>
              <MessageBubble m={it} />
              {it.proposals?.map((pr) => <CoachProposalCard key={pr.id} p={pr} />)}
            </Fragment>
          );
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
