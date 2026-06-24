"use client";

/** The coach's WRITE proposal, rendered under its chat turn. The coach never writes directly: here the
 *  athlete VALIDATES the change (Accepter / Modifier / Ignorer). "Modifier" = accept then open the written
 *  session's /seance page to fine-tune (the existing EventEdit form). Event/reshape accepts trigger the
 *  background week regen (the shared RegenProvider banner). Design-system: bordered card (not the bg-massif
 *  gradient), glyph+name sports, tabular-nums, aéro=Alpine / neuro=Summit dots via theme.ts — no raw hex. */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptCoachProposal, dismissCoachProposal } from "@/app/actions";
import { useRegen } from "@/components/regen-provider";
import { sportIcon, sportName, SYSTEM_TAG_FR } from "@/lib/labels";
import { VIZ } from "@/lib/theme";
import type { ProposalCard, ProposalStatus } from "@/lib/coach-proposals";

const KIND_LABEL: Record<string, string> = {
  session: "Proposition de séance",
  event: "Proposition d'événement",
  delete: "Proposition de retrait",
  reshape: "Réorganiser la semaine",
  activity_edit: "Correction d'activité",
};

function frDate(iso: string | null | undefined): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  return new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(iso + "T00:00:00Z"));
}
function fmtDur(s: number | null | undefined): string | null {
  if (!s) return null;
  const m = Math.round(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}` : `${m} min`;
}

function ChannelDot({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-stone-600 dark:text-stone-300">
      <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      {label} <span className="font-medium tabular-nums">{Math.round(value)}</span>
    </span>
  );
}

export function CoachProposalCard({ p }: { p: ProposalCard }) {
  const router = useRouter();
  const regen = useRegen();
  const [isPending, start] = useTransition();
  const [status, setStatus] = useState<ProposalStatus>(p.status);
  const [error, setError] = useState<string | null>(null);

  const pay = p.payload as any;
  const canModify = p.kind === "session" || p.kind === "event"; // these write a row with a /seance page
  const sportCode: string | null = pay?.sport_code ?? null;
  const date = frDate(pay?.planned_date);
  const tag = pay?.system_tag ? (SYSTEM_TAG_FR[pay.system_tag] ?? pay.system_tag) : null;
  const dur = fmtDur(pay?.target_duration_s);

  function accept(thenEdit: boolean) {
    if (isPending) return;
    setError(null);
    start(async () => {
      try {
        const res = await acceptCoachProposal(p.id);
        if (!res.ok) {
          setError(res.message ?? "Impossible d'appliquer la proposition.");
          if (res.stale) setStatus("superseded");
          return;
        }
        setStatus("accepted");
        if (res.regen) regen.regenerate();
        if (thenEdit && res.committedId) { router.push(`/seance/${res.committedId}`); return; }
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Une erreur est survenue.");
      }
    });
  }

  function dismiss() {
    if (isPending) return;
    start(async () => {
      try { await dismissCoachProposal(p.id); setStatus("dismissed"); router.refresh(); }
      catch (e) { setError(e instanceof Error ? e.message : "Une erreur est survenue."); }
    });
  }

  const decided = status !== "pending";
  const decidedNote =
    status === "accepted" ? "✓ Proposition acceptée — plan mis à jour"
    : status === "dismissed" ? "Proposition ignorée"
    : status === "superseded" ? "Proposition expirée (le plan a changé)"
    : null;

  return (
    <div className={`max-w-[92%] self-start break-words rounded-2xl rounded-bl-md border p-3.5 sm:max-w-[85%] ${
      decided
        ? "border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-900/50"
        : "border-alpine-200 bg-white dark:border-alpine-500/40 dark:bg-stone-900"
    }`}>
      <div className="mb-1.5 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-alpine-700 dark:text-alpine-300">
        <span aria-hidden>📋</span>{KIND_LABEL[p.kind] ?? "Proposition du coach"}
      </div>

      <p className="text-sm font-medium text-stone-800 dark:text-stone-100">{p.summary}</p>

      {/* Session / event detail line — glyph + name sport, FR tag, date, duration */}
      {(p.kind === "session" || p.kind === "event") && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-stone-600 dark:text-stone-300">
          {sportCode && (
            <span className="inline-flex items-center gap-1">
              <span aria-hidden>{sportIcon(sportCode)}</span>
              <span className="font-medium">{sportName(sportCode, sportCode)}</span>
            </span>
          )}
          {tag && <span className="rounded border border-stone-200 px-1.5 py-0.5 dark:border-stone-700">{tag}</span>}
          {date && <span className="tabular-nums">{date}</span>}
          {dur && <span className="tabular-nums">{dur}</span>}
        </div>
      )}

      {/* Per-channel targets (aéro = Alpine, neuro = Summit) when the coach set them */}
      {p.kind === "session" && (pay?.target_aerobic_load != null || pay?.target_neuromuscular_load != null) && (
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
          {pay?.target_aerobic_load != null && <ChannelDot color={VIZ.aerobic} label="aéro" value={pay.target_aerobic_load} />}
          {pay?.target_neuromuscular_load != null && <ChannelDot color={VIZ.neuro} label="neuro" value={pay.target_neuromuscular_load} />}
        </div>
      )}

      {/* Simulated form impact, when the coach attached one */}
      {p.forecastNote && (
        <p className="mt-1.5 text-xs text-stone-500 dark:text-stone-400">📈 {p.forecastNote}</p>
      )}

      {/* Rationale */}
      {pay?.rationale && <p className="mt-2 text-sm text-stone-600 dark:text-stone-300">{pay.rationale}</p>}

      {error && (
        <p className="mt-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>
      )}

      {decided ? (
        <p className={`mt-2.5 text-xs font-medium ${status === "accepted" ? "text-ready" : "text-stone-400 dark:text-stone-500"}`}>
          {decidedNote}
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button" onClick={() => accept(false)} disabled={isPending}
            className="min-h-9 rounded-lg bg-alpine-600 px-3 text-sm font-semibold text-white transition active:bg-alpine-800 enabled:hover:bg-alpine-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? "…" : "Accepter"}
          </button>
          {canModify && (
            <button
              type="button" onClick={() => accept(true)} disabled={isPending}
              className="min-h-9 rounded-lg border border-stone-300 px-3 text-sm font-medium text-stone-700 transition enabled:hover:bg-stone-50 disabled:opacity-50 dark:border-stone-600 dark:text-stone-200 dark:enabled:hover:bg-stone-800"
            >
              Modifier
            </button>
          )}
          <button
            type="button" onClick={dismiss} disabled={isPending}
            className="min-h-9 px-2 text-sm text-stone-500 transition enabled:hover:text-stone-700 disabled:opacity-50 dark:text-stone-400 dark:enabled:hover:text-stone-200"
          >
            Ignorer
          </button>
        </div>
      )}
    </div>
  );
}
