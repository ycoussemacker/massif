"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import { listActivities } from "@/lib/activities";
import type { DailyMetric, Activity } from "@/lib/data";
import {
  sessionRpeLoad, scoredDuration, activitySpanDays, needsReview, descentFamiliarityRatios,
} from "@/lib/load";
import { generateCoachReply, COACH_MODEL, type ChatTurn } from "@/lib/coach-chat";
import { LIMITS, fetchBounded } from "@/lib/agent/limits";
import { fetchAllPaged } from "@/lib/db-paged";
import { runCoachTurn, loadHistory, enforceCoachRateLimit } from "@/lib/coach-turn";
import { todayLocal, whenLabelFr, dateMinusDays } from "@/lib/coach-context";
import { sanitizeCoachSettings, type CoachSettings } from "@/lib/coach-settings";
import { syncStrava } from "@/lib/strava-sync";
import { rollupDailyMetrics } from "@/lib/rollup";
import { generateBriefing, type BriefingResult } from "@/lib/coach-briefing";
import { postDayVerdictMessage } from "@/lib/day-verdict";
import { linkRealizedSessions } from "@/lib/link-sessions";
import { buildTimeline, hasItemBefore, MESSAGE_BATCH, type TimelineItem } from "@/lib/chat";
import { estimateForDeclared } from "@/lib/estimate-server";
import type { LoadEstimate } from "@/lib/estimate";
import {
  stampProposalMessage, fingerprintOf,
  type ProposalOperations, type SessionPayload, type EventPayload,
  type DeletePayload, type ActivityEditPayload,
} from "@/lib/coach-proposals";
import {
  sanitizeEdits, derivedPace, recomputeActivityLoad,
  type ActivityEdits, type UserOverrides,
} from "@/lib/activity-edit";

/** Toutes les surfaces qui affichent la charge d'une activité ou les agrégats qui en découlent
 *  (graphs CTL/ATL/TSB, tuiles, listes). Appelé après CHAQUE recalcul de charge pour que la
 *  modification se propage partout — pas seulement sur la page où le geste a eu lieu. */
function revalidateActivitySurfaces(activityId?: string): void {
  revalidatePath("/");
  revalidatePath("/activites");
  revalidatePath("/analyse");
  revalidatePath("/calendrier");
  revalidatePath("/coach");
  if (activityId) revalidatePath(`/seance/${activityId}`);
}

/** Load an OLDER window of the Forme history on demand (dashboard infinite-scroll-back). Returns the
 *  `months` of daily_metrics + activities ending the day BEFORE `beforeDate` (the current oldest day
 *  loaded). Empty arrays mean we've hit the start of history. Never pre-fetched — only the
 *  scroll-to-left-edge gesture calls this. */
export async function loadOlderForme(
  beforeDate: string, months = 2,
): Promise<{ metrics: DailyMetric[]; activities: Activity[] }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(beforeDate)) return { metrics: [], activities: [] };
  const m = Math.min(Math.max(Math.round(months), 1), 12);
  const to = dateMinusDays(beforeDate, 1);
  const start = new Date(beforeDate + "T00:00:00Z");
  start.setUTCMonth(start.getUTCMonth() - m);
  const from = start.toISOString().slice(0, 10);
  if (from > to) return { metrics: [], activities: [] };

  const sb = await createServiceClient();
  const [mm, acts] = await Promise.all([
    sb.from("daily_metrics").select("*").gte("local_date", from).lte("local_date", to).order("local_date", { ascending: true }),
    listActivities({ from, to, order: "date_asc", limit: 1000 }),
  ]);
  return { metrics: (mm.data ?? []) as DailyMetric[], activities: acts.rows };
}

/** Load the next OLDER page of the coach conversation (scroll-to-top / "load earlier" in /coach).
 *  `beforeIso` = the timestamp of the oldest item (message OR activity) currently loaded (the cursor).
 *  Returns the next MESSAGE_BATCH older items + the briefings in that span, the new cursor, and whether the
 *  start of the conversation is reached (`done` ⇒ butée). Never pre-fetched; shares buildTimeline with
 *  getConversation so a page here looks exactly like the initial load. */
export async function loadOlderConversation(
  beforeIso: string,
): Promise<{ items: TimelineItem[]; cursor: string | null; done: boolean }> {
  if (!beforeIso || Number.isNaN(Date.parse(beforeIso))) return { items: [], cursor: null, done: true };
  const sb = await createServiceClient();
  const today = todayLocal();
  const page = await buildTimeline(sb, today, beforeIso, MESSAGE_BATCH);
  return { items: page.items, cursor: page.cursor ?? beforeIso, done: !(await hasItemBefore(sb, page.cursor)) };
}

/** Optional differential RPE sub-scores (CR10 0–10) — souffle/cardio → aerobic, jambes & avant-bras →
 *  neuromuscular. When ≥2 are given the load split comes from perception (Phase 2). */
export type DifferentialRpe = { cardio?: number | null; legs?: number | null; grip?: number | null };

/** Log a post-session RPE (global CR10 1–10, + optional differential sub-scores) and recompute the load
 *  via session_rpe. Writes the two channels (never the generated total) + rpe_source='user' so the next
 *  sync keeps it. Then ROLLS UP daily_metrics inline (CTL/ATL/TSB/graphs reflect the new load
 *  immediately — before, they froze until the next sync) and revalidates every surface. */
export async function setRpe(activityId: string, rpe: number, differential?: DifferentialRpe): Promise<void> {
  if (!Number.isInteger(rpe) || rpe < 1 || rpe > 10) throw new Error("RPE doit être un entier 1–10");
  const cardio = differential?.cardio ?? null, legs = differential?.legs ?? null, grip = differential?.grip ?? null;
  for (const [name, v] of [["souffle", cardio], ["jambes", legs], ["avant-bras", grip]] as const) {
    if (v != null && (!Number.isInteger(v) || v < 0 || v > 10)) throw new Error(`RPE ${name} doit être un entier 0–10`);
  }

  const sb = await createServiceClient();
  const { data: act, error } = await sb
    .from("activities")
    .select("id,started_at,duration_s,moving_s,avg_hr,sport_id,vertical_loss_m,carried_load_kg,local_date")
    .eq("id", activityId).single();
  if (error || !act) throw new Error("Activité introuvable");

  const { data: sport } = await sb
    .from("sports").select("taxonomy_group").eq("id", act.sport_id).single();
  // weight feeds the carried-mass factor; max_hr feeds the outlier guard (mirror of load.py).
  const { data: profile } = await sb.from("athlete_profile").select("weight_kg,max_hr").limit(1).single();

  // Descent-familiarity (repeated-bout) ratio for this activity's date, so a manual RPE on a descent day
  // (alpi) gets the same neuromuscular adjustment as the recompute. Built from the stored daily D- series.
  const descRows = await fetchAllPaged<any>(
    (from, to) => sb.from("activities").select("local_date,vertical_loss_m")
      .order("local_date", { ascending: true }).range(from, to),
    { what: "série D−" },
  );
  const dailyDescent: Record<string, number> = {};
  for (const dr of descRows) {
    const d = dr.local_date as string;
    dailyDescent[d] = (dailyDescent[d] ?? 0) + Number(dr.vertical_loss_m || 0);
  }
  const descentFamiliarity = descentFamiliarityRatios(dailyDescent)[act.local_date as string] ?? null;

  // Score on the SCORED duration + flag multi-day, exactly like compute_load — moving time for a
  // multi-day outing (elapsed counts the nights) OR a mostly-stopped single-day one (belays/pauses);
  // else elapsed. So the load is right immediately, not after the nightly cron corrects it.
  const activeS = scoredDuration({ started_at: act.started_at, duration_s: act.duration_s, moving_s: act.moving_s });
  const effectiveDays = activitySpanDays(act.started_at, act.duration_s, act.moving_s);
  const load = sessionRpeLoad(activeS, rpe, sport?.taxonomy_group ?? null, {
    verticalLossM: act.vertical_loss_m,
    carriedLoadKg: act.carried_load_kg,
    weightKg: profile?.weight_kg,
    descentFamiliarity,
    rpeCardio: cardio,
    rpeLegs: legs,
    rpeGrip: grip,
  });

  // rpe_source 'user' clears the mostly-stopped flag (the athlete vouched for the effort) — mirror load.py.
  const review = needsReview(
    { started_at: act.started_at, duration_s: act.duration_s, moving_s: act.moving_s, avg_hr: act.avg_hr, rpe_source: "user" },
    { max_hr: profile?.max_hr },
    load.intensity_factor,
    effectiveDays,
  );

  const { error: upErr } = await sb.from("activities").update({
    perceived_rpe: rpe,
    rpe_source: "user",
    rpe_recorded_at: new Date().toISOString(), // honour the validated post-session timing; weight late entries later
    // Differential sub-scores: written only when the caller passed a `differential` object (the picker
    // always does, even to clear); the coach-proposal path omits it → existing sub-scores left untouched.
    ...(differential !== undefined ? { rpe_cardio: cardio, rpe_legs: legs, rpe_grip: grip } : {}),
    load_method_used: "session_rpe",
    aerobic_load: load.aerobic_load,
    neuromuscular_load: load.neuromuscular_load,
    intensity_factor: load.intensity_factor,
    effective_days: effectiveDays,
    needs_review: review,
  }).eq("id", activityId);
  if (upErr) throw new Error(upErr.message);

  // Propage le recalcul aux graphs de l'accueil : sans ce rollup, daily_metrics (CTL/ATL/TSB, courbes
  // de charge) restait figé jusqu'à la prochaine sync et le RPE semblait "ne rien faire".
  await rollupDailyMetrics(sb);
  revalidateActivitySurfaces(activityId);
}

/** Log (or clear, with null) this morning's OPTIONAL leg-soreness self-report (1 fresh – 5 cooked).
 *  Column-scoped upsert on daily_metrics(local_date) — never touches the load-rollup or Garmin-recovery
 *  columns. The missing neuromuscular ground-truth for adaptive calibration (prio 3c); entirely optional. */
export async function setSoreness(value: number | null): Promise<void> {
  if (value !== null && (!Number.isInteger(value) || value < 1 || value > 5))
    throw new Error("Courbatures : un entier 1–5 (ou aucun).");
  const sb = await createServiceClient();
  const { error } = await sb
    .from("daily_metrics")
    .upsert({ local_date: todayLocal(), soreness: value }, { onConflict: "local_date" });
  if (error) throw new Error(error.message);
  revalidatePath("/");
}

// ── Coach chat ────────────────────────────────────────────────────────────────

const rnd = (n: number | null | undefined) => (n == null ? "—" : String(Math.round(n)));
const num = (n: number | null | undefined) => (n == null ? "—" : String(Math.round(Number(n))));

/** Send a free-text message to the coach and persist the exchange. Le pipeline complet (débit,
 *  historique, agent, messages, propositions, trace) vit dans runCoachTurn — partagé avec la route
 *  API /api/coach/ask, pour qu'il n'y ait qu'une implémentation. */
export async function sendCoachMessage(text: string): Promise<void> {
  const content = (text ?? "").trim();
  if (!content) throw new Error("Message vide");
  if (content.length > 4000) throw new Error("Message trop long (4000 caractères max)");

  const sb = await createServiceClient();
  await runCoachTurn(sb, { userBubble: content, kind: "chat" });
  revalidatePath("/coach");
}

/** On-demand: the coach comments one DAY's logged activities against that day's briefing/plan.
 *  `localDate` is YYYY-MM-DD — driven by the "Commente" button fused under each day's activity bubble. */
export async function commentActivities(localDate: string): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate ?? "")) throw new Error("Date invalide");

  const sb = await createServiceClient();
  await enforceCoachRateLimit(sb);
  const today = todayLocal();
  const whenLabel = whenLabelFr(localDate, today);

  const { data: acts, error: aErr } = await sb.from("activities")
    .select("id,sport_id,training_load,aerobic_load,neuromuscular_load,load_method_used,duration_s," +
            "distance_m,vertical_gain_m,vertical_loss_m,avg_hr,perceived_rpe,rpe_source,started_at")
    .eq("local_date", localDate).order("started_at", { ascending: true });
  if (aErr) throw new Error(aErr.message);
  if (!acts || acts.length === 0) throw new Error(`Aucune activité ${whenLabel} à commenter.`);

  const { data: sports } = await sb.from("sports").select("id,code,display_name");
  const sById = new Map<number, any>((sports ?? []).map((s: any) => [s.id, s]));

  const { data: briefing } = await sb.from("coach_briefings").select("*")
    .eq("briefing_date", localDate).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const { data: planned } = await sb.from("planned_sessions").select("*").eq("planned_date", localDate);

  const activityIds = acts.map((a: any) => a.id);
  const userBubble = acts.length > 1
    ? `Peux-tu commenter mes activités ${whenLabel} ?`
    : `Peux-tu commenter mon activité ${whenLabel} ?`;

  const lines = acts.map((a: any) => {
    const s = sById.get(a.sport_id);
    const parts = [
      s?.display_name ?? s?.code ?? "?",
      `charge ${num(a.training_load)} pts (aéro ${num(a.aerobic_load)} / neuro ${num(a.neuromuscular_load)})`,
      `${Math.round((a.duration_s || 0) / 60)} min`,
    ];
    if (a.distance_m != null) parts.push(`${(a.distance_m / 1000).toFixed(1)} km`);
    if (a.vertical_gain_m != null || a.vertical_loss_m != null) parts.push(`D+ ${rnd(a.vertical_gain_m)} / D- ${rnd(a.vertical_loss_m)}`);
    if (a.avg_hr != null) parts.push(`FC moy ${a.avg_hr}`);
    parts.push(`méthode ${a.load_method_used ?? "?"}`);
    if (a.perceived_rpe != null) parts.push(`RPE ${a.perceived_rpe} (${a.rpe_source})`);
    return "- " + parts.join(", ");
  }).join("\n");

  const plannedTxt = (planned ?? []).length
    ? (planned ?? []).map((p: any) =>
        `${p.title} [${p.system_tag}], cible ${p.target_load ?? "?"} pts, ${Math.round((p.target_duration_s || 0) / 60)} min`).join(" ; ")
    : "aucune séance planifiée enregistrée pour ce jour";
  const briefingTxt = briefing
    ? `Briefing du jour — readiness ${briefing.readiness} ; séance prévue : ${briefing.today_session ?? "?"} ; ` +
      `pourquoi : ${briefing.why ?? "?"}${briefing.flag ? ` ; alerte : ${briefing.flag}` : ""}`
    : "aucun briefing enregistré pour ce jour";

  const newUserContent =
    `Commente ma/mes activité(s) ${whenLabel} (${localDate}) au regard de ton briefing.\n\n` +
    `Activité(s) réalisée(s) :\n${lines}\n\n` +
    `Séance(s) planifiée(s) : ${plannedTxt}\n${briefingTxt}\n\n` +
    `Compare le réalisé au plan : suivi ou pas ? trop / pas assez ? quel canal (aérobie / neuro) a été ` +
    `sollicité ? implications pour la récupération et les prochains jours ?`;

  await runCoachTurn(sb, {
    userBubble, promptContent: newUserContent, kind: "activity_comment",
    activityIds, briefingId: (briefing?.id as string | undefined) ?? null,
  });

  revalidatePath("/coach");
}

/** Save the coach personalization (single row). Validated/coerced; affects future coach replies. */
export async function saveCoachSettings(input: CoachSettings): Promise<void> {
  const s = sanitizeCoachSettings(input);
  const sb = await createServiceClient();
  const { error } = await sb.from("coach_settings").upsert({ id: 1, ...s, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  revalidatePath("/coach");
  revalidatePath("/");
}

/** Set ONLY the briefing mode (free = algorithmique 0 token / ai = re-voicé par un petit appel LLM).
 *  Column-scoped upsert so it never resets the persona/voice settings (unlike saveCoachSettings, which
 *  writes the whole object). Surfaced on /profil. */
export async function setBriefingMode(mode: "free" | "ai"): Promise<void> {
  const m = mode === "ai" ? "ai" : "free";
  const sb = await createServiceClient();
  const { error } = await sb.from("coach_settings").upsert({ id: 1, briefing_mode: m, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  revalidatePath("/profil");
  revalidatePath("/");
}

// ── On-demand sync (pull-to-refresh / "Synchroniser" button) ────────────────────────────────────

/** Pull the athlete's recent Strava activities + recompute the fitness model, entirely in TS
 *  (mirror of the Python sync — see lib/strava-sync.ts + lib/rollup.ts). For instant freshness when
 *  the athlete just finished a session. Garmin recovery is NOT pulled here (no API; on-demand via the
 *  Garmin refresh). Returns a short summary for the UI toast. */
export async function syncNow(): Promise<{ pulled: number; newest: string | null; days: number }> {
  const sb = await createServiceClient();
  const { pulled, newest } = await syncStrava(sb);
  const days = await rollupDailyMetrics(sb);
  // A freshly-logged activity "completes" a same-day, same-sport planned session (links it) so the agenda
  // merges plan↔realised instead of showing two rows. Best-effort.
  try { await linkRealizedSessions(sb); } catch { /* non-critical side-effect */ }
  // Drop the coach's same-day "load vs plan" verdict into the conversation (LLM-free template, one row
  // per day, updated in place). Best-effort: never let it fail the sync the athlete asked for.
  try { await postDayVerdictMessage(sb); } catch { /* non-critical side-effect */ }
  revalidatePath("/");
  revalidatePath("/coach");
  return { pulled, newest, days };
}

// ── On-demand Garmin refresh (triggers the cloud Python ingest) ─────────────────────────────────

const GITHUB_API = "https://api.github.com";
const GARMIN_WORKFLOW = "garmin-refresh.yml";
const githubRepo = () => process.env.GITHUB_REPO ?? "ycoussemacker/massif";

function githubHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

/** The freshest daily_metrics write timestamp (the most recent local_date row's updated_at).
 *  Both the Garmin recovery upsert and the rollup bump it, so the client polls this after a Garmin
 *  refresh: once it advances past the watermark captured at dispatch, the cloud job has written. */
export async function latestDailyUpdate(): Promise<string | null> {
  const sb = await createServiceClient();
  const { data } = await sb
    .from("daily_metrics")
    .select("updated_at")
    .order("local_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { updated_at?: string } | null)?.updated_at ?? null;
}

/** Current state of the Garmin-refresh workflow from the GitHub API: is one queued/in-progress, and when
 *  was the most recent run created (for the auto-refresh throttle). Best-effort — any API hiccup reads as
 *  "not running, never run" so a transient GitHub blip never blocks a manual refresh. */
async function garminWorkflowState(token: string): Promise<{ running: boolean; lastRunAt: string | null }> {
  try {
    const res = await fetch(
      `${GITHUB_API}/repos/${githubRepo()}/actions/workflows/${GARMIN_WORKFLOW}/runs?per_page=10`,
      { headers: githubHeaders(token), cache: "no-store" },
    );
    if (!res.ok) return { running: false, lastRunAt: null };
    const runs = (await res.json())?.workflow_runs ?? [];
    const running = runs.some((r: { status?: string }) => r.status === "queued" || r.status === "in_progress");
    const lastRunAt = runs.length ? (runs[0]?.created_at ?? null) : null; // runs come newest-first
    return { running, lastRunAt };
  } catch {
    return { running: false, lastRunAt: null };
  }
}

/** Fire the cloud `garmin-refresh.yml` workflow (workflow_dispatch). Throws on a non-OK GitHub response. */
async function dispatchGarminWorkflow(token: string): Promise<void> {
  const res = await fetch(
    `${GITHUB_API}/repos/${githubRepo()}/actions/workflows/${GARMIN_WORKFLOW}/dispatches`,
    { method: "POST", headers: githubHeaders(token), body: JSON.stringify({ ref: "main" }), cache: "no-store" },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Échec du déclenchement de la synchro Garmin (${res.status}). ${detail.slice(0, 200)}`);
  }
}

/** Reload Garmin recovery on demand (the manual "Recharger" button). Garmin has no JS API (Python-only,
 *  MFA-gated), so we can't pull it from Vercel like Strava — instead we fire the cloud `garmin-refresh.yml`
 *  workflow via the GitHub API and let the client poll `latestDailyUpdate()` for the write. Skips dispatch
 *  if a run is already queued/in-progress (belt-and-braces with the workflow's concurrency group) so rapid
 *  taps don't pile up runs or re-hit Garmin (it 429s on repeated logins). Returns the current watermark to
 *  poll against. Needs GITHUB_DISPATCH_TOKEN (a PAT with actions:write on the repo) in the Vercel env. */
export async function refreshGarmin(): Promise<{ status: "dispatched" | "running"; since: string | null }> {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) throw new Error("Rechargement Garmin indisponible (GITHUB_DISPATCH_TOKEN non configuré).");
  const since = await latestDailyUpdate();
  const { running } = await garminWorkflowState(token);
  if (running) return { status: "running", since };
  await dispatchGarminWorkflow(token);
  return { status: "dispatched", since };
}

// Recovery columns that mark a daily_metrics row as carrying real Garmin recovery (vs a load-only row).
const GARMIN_RECOVERY_OR =
  "sleep_score.not.is.null,hrv_overnight_ms.not.is.null,training_readiness.not.is.null," +
  "resting_hr.not.is.null,body_battery_high.not.is.null";

/** Is Garmin recovery up to date — i.e. do we already hold THIS MORNING's row? Recovery (sleep/HRV/
 *  readiness/RHR) is a once-a-day morning metric finalized after wake, so "a row for today exists" is the
 *  meaningful freshness signal (re-pulling a present day returns the same numbers + risks a Garmin 429). */
export async function garminFreshness(): Promise<{ today: string; latestRecoveryDate: string | null; fresh: boolean }> {
  const sb = await createServiceClient();
  const today = todayLocal();
  const { data } = await sb
    .from("daily_metrics").select("local_date").or(GARMIN_RECOVERY_OR)
    .order("local_date", { ascending: false }).limit(1).maybeSingle();
  const latestRecoveryDate = (data as { local_date?: string } | null)?.local_date ?? null;
  return { today, latestRecoveryDate, fresh: latestRecoveryDate === today };
}

export type GarminEnsure = {
  status: "fresh" | "dispatched" | "running" | "recent" | "unavailable";
  since: string | null; // daily_metrics write watermark at dispatch — the client polls past it
  fresh: boolean;       // today's recovery already in the DB
};

// Auto-refresh throttle: when today's recovery is still missing, retry the cloud pull at most this often.
// Garmin 429s on rapid logins and recovery is morning-finalized, so a tight loop buys nothing.
const GARMIN_AUTO_THROTTLE_MS = 2 * 60 * 60 * 1000; // 2 h

/** Ensure Garmin recovery reflects this morning, kicking the cloud pull if not. Used by the on-open
 *  auto-refresh (force=false → respects the 2 h throttle) and the briefing regen (force=true → the
 *  athlete explicitly asked, so bypass the throttle; still never stacks on an in-flight run). Never
 *  throws — a missing token or a GitHub hiccup degrades to a status the caller can ignore and proceed
 *  on stale data, so it can't block the dashboard or the brief. */
export async function ensureGarminFresh(force = false): Promise<GarminEnsure> {
  const { fresh } = await garminFreshness();
  const since = await latestDailyUpdate();
  if (fresh) return { status: "fresh", since, fresh: true };

  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) return { status: "unavailable", since, fresh: false };

  const { running, lastRunAt } = await garminWorkflowState(token);
  if (running) return { status: "running", since, fresh: false };
  if (!force && lastRunAt && Date.now() - Date.parse(lastRunAt) < GARMIN_AUTO_THROTTLE_MS) {
    return { status: "recent", since, fresh: false };
  }
  try {
    await dispatchGarminWorkflow(token);
  } catch {
    return { status: "unavailable", since, fresh: false };
  }
  return { status: "dispatched", since, fresh: false };
}

/** Cost/abuse guard on the on-demand briefing (an Anthropic call behind only the shared password).
 *  Counts briefings written recently (shared DB state — works on serverless) and throws over the
 *  burst/day limits. The morning cron writes one briefing/day, well under the daily cap. */
async function enforceBriefingRateLimit(sb: SupabaseClient): Promise<void> {
  const now = Date.now();
  const since1m = new Date(now - 60_000).toISOString();
  const since1d = new Date(now - 86_400_000).toISOString();
  const [burst, daily] = await Promise.all([
    sb.from("coach_briefings").select("id", { count: "exact", head: true }).gte("created_at", since1m),
    sb.from("coach_briefings").select("id", { count: "exact", head: true }).gte("created_at", since1d),
  ]);
  if ((burst.count ?? 0) >= 2) throw new Error("Le briefing vient d'être régénéré — attends un instant.");
  if ((daily.count ?? 0) >= 20) throw new Error("Limite quotidienne de régénérations atteinte (20/jour).");
}

/** On-demand "Régénérer le briefing" — regenerates today's briefing from the CURRENT DB state (no inline
 *  Strava/Garmin sync: that's a separate gesture — pull-to-refresh / the Garmin button — so the brief is
 *  instant and never times out on mobile). In 'free' mode it's 100 % algorithmic (zero tokens); in 'ai'
 *  mode it adds one small, cached Claude call (the athlete's coach voice). No push. Returns a UI summary. */
export async function generateBriefingNow(): Promise<{ briefing: BriefingResult }> {
  const sb = await createServiceClient();
  await enforceBriefingRateLimit(sb);
  const briefing = await generateBriefing(sb); // reads current DB — instant, no inline sync
  try { await postDayVerdictMessage(sb); } catch { /* non-critical side-effect */ }
  revalidatePath("/");
  revalidatePath("/coach");
  return { briefing };
}

// ── Declared events (athlete plans an activity this week → the coach plans around it) ────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type PlannedEventInput = {
  planned_date: string;
  sport_id: number;
  title: string;
  description?: string | null;
  is_key?: boolean;
  target_distance_m?: number | null;
  target_vertical_m?: number | null;
  target_duration_s?: number | null;
  expected_altitude_m?: number | null;
};

function cleanEventInput(input: PlannedEventInput) {
  if (!ISO_DATE.test(input.planned_date ?? "")) throw new Error("Date invalide (AAAA-MM-JJ).");
  if (!Number.isInteger(input.sport_id)) throw new Error("Sport invalide.");
  const title = (input.title ?? "").trim();
  if (!title) throw new Error("Donne un titre à l'activité prévue.");
  const numOrNull = (v: number | null | undefined) =>
    v == null || !Number.isFinite(v) || v < 0 ? null : Number(v);
  return {
    planned_date: input.planned_date,
    sport_id: input.sport_id,
    title: title.slice(0, 200),
    description: (input.description ?? "")?.toString().trim().slice(0, 1000) || null,
    is_key: !!input.is_key,
    target_distance_m: numOrNull(input.target_distance_m),
    target_vertical_m: numOrNull(input.target_vertical_m),
    target_duration_s: numOrNull(input.target_duration_s),
    expected_altitude_m: numOrNull(input.expected_altitude_m),
  };
}

/** Estimate a declared activity's load from the athlete's similar past efforts (live form preview). */
export async function estimatePlannedEvent(input: {
  sport_id: number;
  title?: string | null;
  target_distance_m?: number | null;
  target_vertical_m?: number | null;
  target_duration_s?: number | null;
}): Promise<LoadEstimate> {
  if (!Number.isInteger(input.sport_id)) throw new Error("Sport invalide.");
  const sb = await createServiceClient();
  return estimateForDeclared(sb, {
    sportId: input.sport_id,
    taxonomyGroup: null,
    durationS: input.target_duration_s ?? null,
    distanceM: input.target_distance_m ?? null,
    verticalGainM: input.target_vertical_m ?? null,
    name: input.title ?? null,
  });
}

/** Create an athlete-declared event (planned_sessions row, modified_by='user', is_event=true). The load
 *  estimate is computed server-side and persisted as predicted_* so the coach + projection read it. */
export async function createPlannedEvent(input: PlannedEventInput): Promise<{ id: string; estimate: LoadEstimate }> {
  const c = cleanEventInput(input);
  const sb = await createServiceClient();
  const estimate = await estimateForDeclared(sb, {
    sportId: c.sport_id,
    taxonomyGroup: null,
    durationS: c.target_duration_s,
    distanceM: c.target_distance_m,
    verticalGainM: c.target_vertical_m,
    name: c.title,
  });
  const ins = await sb.from("planned_sessions").insert({
    planned_date: c.planned_date,
    sport_id: c.sport_id,
    title: c.title,
    description: c.description,
    is_key: c.is_key,
    is_event: true,
    target_distance_m: c.target_distance_m,
    target_vertical_m: c.target_vertical_m,
    target_duration_s: c.target_duration_s,
    expected_altitude_m: c.expected_altitude_m,
    // Store the channels as the cible too (total = aéro + neuro), so the séance card is consistent and
    // matches the per-channel estimate — same convention as a chat-pinned session (commitSession).
    target_aerobic_load: estimate.aerobic,
    target_neuromuscular_load: estimate.neuro,
    target_load: estimate.aerobic + estimate.neuro,
    predicted_aerobic_load: estimate.aerobic,
    predicted_neuromuscular_load: estimate.neuro,
    prediction_basis: estimate.basisLabel,
    status: "planned",
    modified_by: "user",
  }).select("id").single();
  if (ins.error) throw new Error(ins.error.message);
  revalidatePath("/");
  revalidatePath("/calendrier");
  revalidatePath("/coach");
  return { id: ins.data.id, estimate };
}

/** Edit an athlete-declared event (re-estimates the load). Scoped to user rows so coach plans aren't hit. */
export async function updatePlannedEvent(id: string, input: PlannedEventInput): Promise<{ estimate: LoadEstimate }> {
  if (!id) throw new Error("Événement introuvable.");
  const c = cleanEventInput(input);
  const sb = await createServiceClient();
  const estimate = await estimateForDeclared(sb, {
    sportId: c.sport_id,
    taxonomyGroup: null,
    durationS: c.target_duration_s,
    distanceM: c.target_distance_m,
    verticalGainM: c.target_vertical_m,
    name: c.title,
  });
  const upd = await sb.from("planned_sessions").update({
    planned_date: c.planned_date,
    sport_id: c.sport_id,
    title: c.title,
    description: c.description,
    is_key: c.is_key,
    target_distance_m: c.target_distance_m,
    target_vertical_m: c.target_vertical_m,
    target_duration_s: c.target_duration_s,
    expected_altitude_m: c.expected_altitude_m,
    // Recompute the two CHANNELS and derive the total from them (total = aéro + neuro), so the séance
    // card stays internally consistent after an edit (was: only target_load updated → stale channels).
    // Mirrors commitSession's pattern.
    target_aerobic_load: estimate.aerobic,
    target_neuromuscular_load: estimate.neuro,
    target_load: estimate.aerobic + estimate.neuro,
    predicted_aerobic_load: estimate.aerobic,
    predicted_neuromuscular_load: estimate.neuro,
    prediction_basis: estimate.basisLabel,
    updated_at: new Date().toISOString(),
  }).eq("id", id).eq("modified_by", "user");
  if (upd.error) throw new Error(upd.error.message);
  revalidatePath("/");
  revalidatePath("/calendrier");
  revalidatePath("/coach");
  return { estimate };
}

/** Delete an athlete-declared event. Scoped to user rows (the coach's own plan is never deletable here). */
export async function deletePlannedEvent(id: string): Promise<void> {
  if (!id) throw new Error("Événement introuvable.");
  const sb = await createServiceClient();
  const del = await sb.from("planned_sessions").delete().eq("id", id).eq("modified_by", "user");
  if (del.error) throw new Error(del.error.message);
  revalidatePath("/");
  revalidatePath("/calendrier");
  revalidatePath("/coach");
}

// ── Fenêtres de contrainte (périodisation personnalisée — Upgrade 10) ────────────────────────────

export type TrainingWindowInput = {
  starts_on: string;
  ends_on: string;
  label: string;
  effect?: "auto" | "deload" | "maintain" | "charge";
  no_mountains?: boolean;
  limited_hills?: boolean;
  reduced_volume?: boolean;
  notes?: string | null;
};

const WINDOW_EFFECTS = new Set(["auto", "deload", "maintain", "charge"]);

function cleanWindowInput(input: TrainingWindowInput) {
  if (!ISO_DATE.test(input.starts_on ?? "") || !ISO_DATE.test(input.ends_on ?? ""))
    throw new Error("Dates invalides (AAAA-MM-JJ).");
  if (input.ends_on < input.starts_on) throw new Error("La fin doit être après le début.");
  const label = (input.label ?? "").trim();
  if (!label) throw new Error("Donne un nom à la contrainte (ex. « Déplacement Bordeaux »).");
  const effect = input.effect && WINDOW_EFFECTS.has(input.effect) ? input.effect : "auto";
  return {
    starts_on: input.starts_on,
    ends_on: input.ends_on,
    label: label.slice(0, 120),
    effect,
    no_mountains: !!input.no_mountains,
    limited_hills: !!input.limited_hills,
    reduced_volume: !!input.reduced_volume,
    notes: (input.notes ?? "")?.toString().trim().slice(0, 500) || null,
  };
}

/** Les surfaces qui affichent phases/plan/fenêtres. Le plan de la semaine n'est PAS régénéré ici —
 *  la fenêtre entre dans le contexte et le prochain briefing (ou une régénération) la prend en compte. */
function revalidateWindowSurfaces(): void {
  revalidatePath("/");
  revalidatePath("/calendrier");
  revalidatePath("/coach");
}

/** Déclare une fenêtre de contrainte (déplacement, terrain plat…). Le moteur de plan s'y adapte :
 *  décharge reportée dessus, D+ chargé avant une fenêtre sans montagne, séances adaptées pendant. */
export async function createTrainingWindow(input: TrainingWindowInput): Promise<{ id: string }> {
  const c = cleanWindowInput(input);
  const sb = await createServiceClient();
  const ins = await sb.from("training_windows").insert(c).select("id").single();
  if (ins.error) throw new Error(ins.error.message);
  revalidateWindowSurfaces();
  return { id: (ins.data as { id: string }).id };
}

/** Modifie une fenêtre (reporter/prolonger : changer les dates suffit). */
export async function updateTrainingWindow(id: string, input: TrainingWindowInput): Promise<void> {
  if (!id) throw new Error("Contrainte introuvable.");
  const c = cleanWindowInput(input);
  const sb = await createServiceClient();
  const upd = await sb.from("training_windows")
    .update({ ...c, updated_at: new Date().toISOString() }).eq("id", id);
  if (upd.error) throw new Error(upd.error.message);
  revalidateWindowSurfaces();
}

export async function deleteTrainingWindow(id: string): Promise<void> {
  if (!id) throw new Error("Contrainte introuvable.");
  const sb = await createServiceClient();
  const del = await sb.from("training_windows").delete().eq("id", id);
  if (del.error) throw new Error(del.error.message);
  revalidateWindowSurfaces();
}

// ── Coach proposals (the coach proposes a plan/activity change → the athlete validates → we write) ─

export type AcceptResult = {
  ok: boolean;
  committedId?: string | null; // a planned_sessions/activity id to open ("Modifier" → /seance/[id])
  regen?: boolean;             // the client should trigger the background week regen (event/reshape)
  stale?: boolean;            // the plan changed since the proposal — nothing was written
  message?: string;
};

async function resolveSportId(sb: SupabaseClient, code: string | null | undefined): Promise<number | null> {
  if (!code) return null;
  const { data } = await sb.from("sports").select("id").eq("code", code).maybeSingle();
  return data ? (data as { id: number }).id : null;
}

/** Reassign an activity's sport AND recompute its load with the new sport's method ladder, so the numbers
 *  reflect the new category immediately (an alpinism/grande-voie day logged as a hike was scored on elapsed
 *  time → its aerobic load was inflated; the new ladder + the mostly-stopped moving-time correction fix it).
 *  The single owner of this write — used by the athlete-initiated reassignment and the accepted coach
 *  proposal alike. The reclassification is REMEMBERED in user_overrides.sport_code so the next Strava
 *  re-sync keeps it (before, every sync silently reverted the athlete's correction). The recompute goes
 *  through the shared recomputeActivityLoad (full model context — parity with the Python recompute).
 *  Callers own the daily_metrics rollup + revalidation. */
async function applySportReassignment(sb: SupabaseClient, activityId: string, sportCode: string): Promise<void> {
  const sportId = await resolveSportId(sb, sportCode);
  if (!sportId) throw new Error(`Sport « ${sportCode} » inconnu.`);

  const { data: act, error } = await sb.from("activities")
    .select("id,user_overrides").eq("id", activityId).single();
  if (error || !act) throw new Error("Activité introuvable");
  const overrides: UserOverrides = { ...((act.user_overrides ?? {}) as UserOverrides), sport_code: sportCode };

  const { error: upErr } = await sb.from("activities")
    .update({ sport_id: sportId, user_overrides: overrides }).eq("id", activityId);
  if (upErr) throw new Error(upErr.message);
  await recomputeActivityLoad(sb, activityId);
}

/** All sports (code + FR-friendly display + taxonomy) for the activity reclassification picker, ordered by
 *  family then name so the picker can group them. Read-only; safe to call from the client island. */
export async function listSportsForReassign(): Promise<
  { code: string; display_name: string; taxonomy_group: string | null }[]
> {
  const sb = await createServiceClient();
  const { data } = await sb.from("sports")
    .select("code,display_name,taxonomy_group").order("taxonomy_group").order("display_name");
  return (data ?? []) as { code: string; display_name: string; taxonomy_group: string | null }[];
}

/** Athlete-initiated reclassification of a logged activity's sport (the ⚠️ flag panel / séance page).
 *  Recomputes the load, ROLLS UP daily_metrics inline (the home graphs move immediately) and refreshes
 *  every surface. The new category is remembered across re-syncs (user_overrides.sport_code). */
export async function reassignActivitySport(activityId: string, sportCode: string): Promise<void> {
  if (!activityId || !sportCode) throw new Error("Activité ou sport manquant.");
  const sb = await createServiceClient();
  await applySportReassignment(sb, activityId, sportCode);
  await rollupDailyMetrics(sb);
  revalidateActivitySurfaces(activityId);
}

/** Édition des données d'une activité synchronisée (P: le provider se trompe — ex. D− aberrant sur un
 *  canyoning — et l'athlète doit pouvoir corriger TOUT champ utile au calcul des impacts aéro/neuro).
 *  Écrit les colonnes corrigées + les mémorise dans user_overrides (survit aux re-syncs, comme les RPE),
 *  recalcule la charge avec le contexte complet du modèle, puis ROLLUP daily_metrics + revalidation —
 *  les graphs de l'accueil reflètent la correction immédiatement. Retourne les nouveaux canaux pour le
 *  feedback UI. */
export async function updateActivityData(
  activityId: string,
  edits: Record<string, number>,
): Promise<{ aerobic: number; neuro: number; method: string }> {
  if (!activityId) throw new Error("Activité introuvable.");
  const clean: ActivityEdits = sanitizeEdits(edits);
  if (!Object.keys(clean).length) throw new Error("Aucune modification à enregistrer.");

  const sb = await createServiceClient();
  const { data: act, error } = await sb.from("activities")
    .select("id,duration_s,moving_s,distance_m,user_overrides").eq("id", activityId).single();
  if (error || !act) throw new Error("Activité introuvable");

  // Cohérence temps : le temps en mouvement ne peut pas dépasser la durée totale (valeurs finales).
  const finalDuration = clean.duration_s ?? (act.duration_s as number | null);
  const finalMoving = clean.moving_s ?? (act.moving_s as number | null);
  if (finalDuration != null && finalMoving != null && finalMoving > finalDuration)
    throw new Error("Le temps en mouvement ne peut pas dépasser la durée totale.");

  const overrides: UserOverrides = { ...((act.user_overrides ?? {}) as UserOverrides), ...clean };
  const update: Record<string, unknown> = { ...clean, user_overrides: overrides };
  // L'allure moyenne est dérivée de distance/moving — la recalculer quand l'un des deux change
  // (le rtss la lit ; les deux syncs font pareil après ré-application des overrides).
  if (clean.distance_m !== undefined || clean.moving_s !== undefined) {
    update.avg_pace_s_per_km = derivedPace(clean.distance_m ?? (act.distance_m as number | null), finalMoving);
  }
  const { error: upErr } = await sb.from("activities").update(update).eq("id", activityId);
  if (upErr) throw new Error(upErr.message);

  const res = await recomputeActivityLoad(sb, activityId);
  await rollupDailyMetrics(sb);
  revalidateActivitySurfaces(activityId);
  return { aerobic: res.aerobic_load, neuro: res.neuromuscular_load, method: res.load_method_used };
}

/** Light cost/abuse guard on accepts (a leaked password could otherwise spam writes). Shared DB state. */
async function enforceProposalRateLimit(sb: SupabaseClient): Promise<void> {
  const since1m = new Date(Date.now() - 60_000).toISOString();
  const burst = await sb.from("coach_proposals").select("id", { count: "exact", head: true })
    .eq("status", "accepted").gte("updated_at", since1m);
  if ((burst.count ?? 0) >= 10) throw new Error("Doucement — attends quelques secondes avant de valider une autre proposition.");
}

/** Accept a pending coach proposal and COMMIT it through the existing write paths. Idempotent (a guarded
 *  pending→accepted flip), staleness-checked (the target row must be unchanged since the proposal), and it
 *  NEVER calls Claude (the proposal was already generated). Returns what the card needs (committed id to
 *  open, whether to trigger the background week regen). The athlete validated it — this is the only writer. */
export async function acceptCoachProposal(proposalId: string): Promise<AcceptResult> {
  if (!proposalId) throw new Error("Proposition introuvable.");
  const sb = await createServiceClient();
  await enforceProposalRateLimit(sb);

  const { data: prop } = await sb.from("coach_proposals")
    .select("id,kind,status,operations,summary").eq("id", proposalId).maybeSingle();
  if (!prop) throw new Error("Proposition introuvable.");
  if (prop.status !== "pending") return { ok: false, message: "Proposition déjà traitée." };

  const ops = (prop.operations ?? {}) as ProposalOperations;

  // Staleness: the targeted row must be unchanged since the proposal (no regen / logged activity / edit in
  // between), else we'd double-write or clobber. A row already linked to an activity is never touched.
  if (ops.target_planned_id) {
    const { data: cur } = await sb.from("planned_sessions")
      .select("updated_at,status,linked_activity_id").eq("id", ops.target_planned_id).maybeSingle();
    if (fingerprintOf(cur as any) !== (ops.expected_fingerprint ?? null) || (cur as any)?.linked_activity_id) {
      await sb.from("coach_proposals").update({ status: "superseded" }).eq("id", proposalId).eq("status", "pending");
      return { ok: false, stale: true, message: "Le plan a changé depuis cette proposition — redemande au coach." };
    }
  }
  if (ops.target_activity_id) {
    const { data: cur } = await sb.from("activities").select("updated_at").eq("id", ops.target_activity_id).maybeSingle();
    if (fingerprintOf(cur ? { updated_at: (cur as any).updated_at } : null) !== (ops.expected_fingerprint ?? null)) {
      await sb.from("coach_proposals").update({ status: "superseded" }).eq("id", proposalId).eq("status", "pending");
      return { ok: false, stale: true, message: "Cette activité a changé depuis la proposition — redemande au coach." };
    }
  }

  // Claim atomically (guards a double-tap): only one accept wins the pending→accepted flip.
  const claim = await sb.from("coach_proposals").update({ status: "accepted" })
    .eq("id", proposalId).eq("status", "pending").select("id");
  if (claim.error) throw new Error(claim.error.message);
  if (!(claim.data?.length)) return { ok: false, message: "Proposition déjà traitée." };

  let committedId: string | null = null;
  let regen = false;
  try {
    if (prop.kind === "session") {
      committedId = await commitSession(sb, proposalId, ops);
    } else if (prop.kind === "event") {
      const p = ops.payload as EventPayload;
      const sportId = await resolveSportId(sb, p.sport_code);
      if (!sportId) throw new Error(`Sport « ${p.sport_code} » inconnu.`);
      const { id } = await createPlannedEvent({
        planned_date: p.planned_date, sport_id: sportId, title: p.title, description: p.description ?? null,
        is_key: !!p.is_key, target_distance_m: p.target_distance_m ?? null, target_vertical_m: p.target_vertical_m ?? null,
        target_duration_s: p.target_duration_s ?? null, expected_altitude_m: p.expected_altitude_m ?? null,
      });
      committedId = id;
      regen = !!ops.regen_week;
    } else if (prop.kind === "delete") {
      const id = (ops.payload as DeletePayload).session_id ?? ops.target_planned_id!;
      const upd = await sb.from("planned_sessions").update({ status: "skipped" }).eq("id", id);
      if (upd.error) throw new Error(upd.error.message);
      committedId = id;
    } else if (prop.kind === "reshape") {
      regen = true; // no write — the client runs the week regen
    } else if (prop.kind === "activity_edit") {
      const p = ops.payload as ActivityEditPayload;
      // Reassign the sport first (recomputes the load with the new ladder), THEN apply any RPE so it
      // scores against the new sport's taxonomy — not the old one left stale. setRpe rolls up
      // daily_metrics itself; a sport-only edit needs the rollup here to reach the graphs.
      if (p.sport_code) await applySportReassignment(sb, p.activity_id, p.sport_code);
      if (p.perceived_rpe != null) await setRpe(p.activity_id, p.perceived_rpe);
      else if (p.sport_code) await rollupDailyMetrics(sb);
      committedId = p.activity_id;
    }
  } catch (e) {
    // Roll the claim back so a transient failure stays retryable instead of stuck "accepted".
    await sb.from("coach_proposals").update({ status: "pending" }).eq("id", proposalId);
    throw e;
  }

  await sb.from("coach_proposals").update({ committed_ids: committedId ? [committedId] : [] }).eq("id", proposalId);
  // Drop a short confirmation into the conversation so the timeline shows the outcome.
  await sb.from("coach_messages").insert({
    role: "coach", kind: "chat", content: `✓ Plan mis à jour — ${prop.summary ?? "proposition appliquée"}.`,
  });

  revalidatePath("/");
  revalidatePath("/calendrier");
  revalidatePath("/coach");
  return { ok: true, committedId, regen };
}

/** Replace/create a pinned coach prescription (modified_by='user', is_pinned). On a replace the old row is
 *  deleted (only if not yet linked to an activity) and its order_in_day reused, so the day never duplicates. */
async function commitSession(sb: SupabaseClient, proposalId: string, ops: ProposalOperations): Promise<string> {
  const p = ops.payload as SessionPayload;
  const sportId = await resolveSportId(sb, p.sport_code);
  if (!sportId) throw new Error(`Sport « ${p.sport_code} » inconnu.`);

  const est = await estimateForDeclared(sb, {
    sportId, taxonomyGroup: null, durationS: p.target_duration_s ?? null, distanceM: p.target_distance_m ?? null,
    verticalGainM: p.target_vertical_m ?? null, name: p.title,
  });

  let orderInDay = 1;
  if (ops.target_planned_id) {
    const { data: old } = await sb.from("planned_sessions")
      .select("order_in_day").eq("id", ops.target_planned_id).maybeSingle();
    if (old) orderInDay = (old as { order_in_day: number }).order_in_day ?? 1;
    // Remove the replaced session (scoped: never a row already linked to a logged activity).
    await sb.from("planned_sessions").delete().eq("id", ops.target_planned_id).is("linked_activity_id", null);
  } else {
    const { data: existing } = await sb.from("planned_sessions")
      .select("order_in_day").eq("planned_date", p.planned_date).neq("status", "skipped");
    orderInDay = Math.max(0, ...((existing ?? []) as any[]).map((r) => r.order_in_day ?? 1)) + 1;
  }

  const aer = p.target_aerobic_load ?? est.aerobic;
  const neu = p.target_neuromuscular_load ?? est.neuro;
  const ins = await sb.from("planned_sessions").insert({
    planned_date: p.planned_date,
    order_in_day: orderInDay,
    sport_id: sportId,
    title: p.title,
    description: p.description ?? null,
    system_tag: p.system_tag ?? null,
    intensity_zone: p.intensity_zone ?? null,
    target_duration_s: p.target_duration_s ?? null,
    target_distance_m: p.target_distance_m ?? null,
    target_vertical_m: p.target_vertical_m ?? null,
    expected_altitude_m: p.expected_altitude_m ?? null,
    target_load: (aer ?? 0) + (neu ?? 0),
    target_aerobic_load: aer,
    target_neuromuscular_load: neu,
    predicted_aerobic_load: est.aerobic,
    predicted_neuromuscular_load: est.neuro,
    prediction_basis: est.basisLabel,
    is_key: !!p.is_key,
    is_event: false,
    is_pinned: true,
    source: "coach_proposal",
    proposal_id: proposalId,
    status: "planned",
    modified_by: "user",
    modified_reason: p.rationale ?? null,
  }).select("id").single();
  if (ins.error) throw new Error(ins.error.message);
  return (ins.data as { id: string }).id;
}

/** Dismiss a pending proposal (the athlete declined). Idempotent. */
export async function dismissCoachProposal(proposalId: string): Promise<void> {
  if (!proposalId) return;
  const sb = await createServiceClient();
  await sb.from("coach_proposals").update({ status: "dismissed" }).eq("id", proposalId).eq("status", "pending");
  revalidatePath("/coach");
}
