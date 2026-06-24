"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import { listActivities } from "@/lib/activities";
import type { DailyMetric, Activity } from "@/lib/data";
import { sessionRpeLoad, activeDuration, activitySpanDays, needsReview } from "@/lib/load";
import { generateCoachReply, COACH_MODEL, type ChatTurn } from "@/lib/coach-chat";
import { todayLocal, whenLabelFr, dateMinusDays } from "@/lib/coach-context";
import { sanitizeCoachSettings, type CoachSettings } from "@/lib/coach-settings";
import { syncStrava } from "@/lib/strava-sync";
import { rollupDailyMetrics } from "@/lib/rollup";
import { generateBriefing, type BriefingResult } from "@/lib/coach-briefing";
import { postDayVerdictMessage } from "@/lib/day-verdict";
import { buildTimeline, hasItemBefore, MESSAGE_BATCH, type TimelineItem } from "@/lib/chat";
import { estimateForDeclared } from "@/lib/estimate-server";
import type { LoadEstimate } from "@/lib/estimate";
import {
  stampProposalMessage, fingerprintOf,
  type ProposalOperations, type SessionPayload, type EventPayload,
  type DeletePayload, type ActivityEditPayload,
} from "@/lib/coach-proposals";

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

/** Log a post-session RPE (1–10) for an activity and recompute its load via session_rpe.
 *  Writes the two channels (never the generated total) + rpe_source='user' so the next sync keeps it.
 *  daily_metrics (CTL/ATL/charts) recompute on the next rollup/nightly run. */
export async function setRpe(activityId: string, rpe: number): Promise<void> {
  if (!Number.isInteger(rpe) || rpe < 1 || rpe > 10) throw new Error("RPE doit être un entier 1–10");

  const sb = await createServiceClient();
  const { data: act, error } = await sb
    .from("activities")
    .select("id,started_at,duration_s,moving_s,avg_hr,sport_id,vertical_loss_m,carried_load_kg")
    .eq("id", activityId).single();
  if (error || !act) throw new Error("Activité introuvable");

  const { data: sport } = await sb
    .from("sports").select("taxonomy_group").eq("id", act.sport_id).single();
  // weight feeds the carried-mass factor; max_hr feeds the outlier guard (mirror of load.py).
  const { data: profile } = await sb.from("athlete_profile").select("weight_kg,max_hr").limit(1).single();

  // Score on ACTIVE time + flag multi-day, exactly like compute_load — so a multi-day manual-RPE
  // outing (elapsed counts the nights) gets the moving-based load and is spread by the rollup, not a
  // spike that waits for the nightly cron to correct it.
  const activeS = activeDuration({ started_at: act.started_at, duration_s: act.duration_s, moving_s: act.moving_s });
  const effectiveDays = activitySpanDays(act.started_at, act.duration_s, act.moving_s);
  const load = sessionRpeLoad(activeS, rpe, sport?.taxonomy_group ?? null, {
    verticalLossM: act.vertical_loss_m,
    carriedLoadKg: act.carried_load_kg,
    weightKg: profile?.weight_kg,
  });

  const review = needsReview(
    { started_at: act.started_at, duration_s: act.duration_s, moving_s: act.moving_s, avg_hr: act.avg_hr },
    { max_hr: profile?.max_hr },
    load.intensity_factor,
    effectiveDays,
  );

  const { error: upErr } = await sb.from("activities").update({
    perceived_rpe: rpe,
    rpe_source: "user",
    load_method_used: "session_rpe",
    aerobic_load: load.aerobic_load,
    neuromuscular_load: load.neuromuscular_load,
    intensity_factor: load.intensity_factor,
    effective_days: effectiveDays,
    needs_review: review,
  }).eq("id", activityId);
  if (upErr) throw new Error(upErr.message);

  revalidatePath("/");
  revalidatePath("/coach");
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

/** Prior chat turns (oldest → newest), used to rebuild the conversation for Claude. */
async function loadHistory(sb: SupabaseClient): Promise<ChatTurn[]> {
  const { data } = await sb.from("coach_messages").select("role,content").order("created_at", { ascending: true });
  return (data ?? []).map((m: any) => ({ role: m.role, content: m.content }));
}

/** Cheap abuse/cost guard on the Anthropic-backed coach: the chat sits behind only the shared
 *  password, so a leaked password could otherwise spam paid Claude calls. Counts recent user turns
 *  (works on serverless — shared DB state, not in-memory) and throws over the burst/day limits.
 *  Belt for the hard ceiling set on the Anthropic console. */
async function enforceCoachRateLimit(sb: SupabaseClient): Promise<void> {
  const now = Date.now();
  const since1m = new Date(now - 60_000).toISOString();
  const since1d = new Date(now - 86_400_000).toISOString();
  const [burst, daily] = await Promise.all([
    sb.from("coach_messages").select("id", { count: "exact", head: true })
      .eq("role", "user").gte("created_at", since1m),
    sb.from("coach_messages").select("id", { count: "exact", head: true })
      .eq("role", "user").gte("created_at", since1d),
  ]);
  if ((burst.count ?? 0) >= 3) throw new Error("Doucement — attends quelques secondes avant de relancer le coach.");
  if ((daily.count ?? 0) >= 50) throw new Error("Limite quotidienne atteinte (50 messages/jour au coach).");
}

/** Send a free-text message to the coach and persist the exchange.
 *  History is read BEFORE inserting so the new turn isn't double-counted in the prompt. */
export async function sendCoachMessage(text: string): Promise<void> {
  const content = (text ?? "").trim();
  if (!content) throw new Error("Message vide");
  if (content.length > 4000) throw new Error("Message trop long (4000 caractères max)");

  const sb = await createServiceClient();
  await enforceCoachRateLimit(sb);
  const history = await loadHistory(sb);

  const ins = await sb.from("coach_messages").insert({ role: "user", kind: "chat", content });
  if (ins.error) throw new Error(ins.error.message);

  const { text: reply, proposalIds } = await generateCoachReply({ sb, history, newUserContent: content });

  const insC = await sb.from("coach_messages")
    .insert({ role: "coach", kind: "chat", content: reply, model: COACH_MODEL }).select("id").single();
  if (insC.error) throw new Error(insC.error.message);
  // Attach any pending proposals raised this turn to the coach message so the card renders under it.
  await stampProposalMessage(sb, proposalIds, (insC.data as { id: string }).id);

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

  const history = await loadHistory(sb);

  const ins = await sb.from("coach_messages")
    .insert({ role: "user", kind: "activity_comment", content: userBubble, activity_ids: activityIds });
  if (ins.error) throw new Error(ins.error.message);

  const { text: reply, proposalIds } = await generateCoachReply({ sb, history, newUserContent });

  const insC = await sb.from("coach_messages").insert({
    role: "coach", kind: "activity_comment", content: reply, model: COACH_MODEL,
    activity_ids: activityIds, briefing_id: briefing?.id ?? null,
  }).select("id").single();
  if (insC.error) throw new Error(insC.error.message);
  await stampProposalMessage(sb, proposalIds, (insC.data as { id: string }).id);

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

// ── On-demand sync (pull-to-refresh / "Synchroniser" button) ────────────────────────────────────

/** Pull the athlete's recent Strava activities + recompute the fitness model, entirely in TS
 *  (mirror of the Python sync — see lib/strava-sync.ts + lib/rollup.ts). For instant freshness when
 *  the athlete just finished a session, without waiting for the nightly cron. Garmin recovery is NOT
 *  pulled here (no API; it stays on the cron). Returns a short summary for the UI toast. */
export async function syncNow(): Promise<{ pulled: number; newest: string | null; days: number }> {
  const sb = await createServiceClient();
  const { pulled, newest } = await syncStrava(sb);
  const days = await rollupDailyMetrics(sb);
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

/** Reload Garmin recovery on demand. Garmin has no JS API (Python-only, MFA-gated), so we can't pull
 *  it from Vercel like Strava — instead we fire the cloud `garmin-refresh.yml` workflow via the GitHub
 *  API and let the client poll `latestDailyUpdate()` for the write. Skips dispatch if a run is already
 *  queued/in-progress (belt-and-braces with the workflow's concurrency group) so rapid taps don't pile
 *  up runs or re-hit Garmin (it 429s on repeated logins). Returns the current watermark to poll against.
 *  Needs GITHUB_DISPATCH_TOKEN (a PAT with actions:write on the repo) in the Vercel env. */
export async function refreshGarmin(): Promise<{ status: "dispatched" | "running"; since: string | null }> {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) throw new Error("Rechargement Garmin indisponible (GITHUB_DISPATCH_TOKEN non configuré).");
  const repo = githubRepo();

  // Already queued/in-progress? Don't stack another run.
  const runsRes = await fetch(
    `${GITHUB_API}/repos/${repo}/actions/workflows/${GARMIN_WORKFLOW}/runs?per_page=5`,
    { headers: githubHeaders(token), cache: "no-store" },
  );
  const since = await latestDailyUpdate();
  if (runsRes.ok) {
    const runs = (await runsRes.json())?.workflow_runs ?? [];
    if (runs.some((r: { status?: string }) => r.status === "queued" || r.status === "in_progress")) {
      return { status: "running", since };
    }
  }

  const res = await fetch(
    `${GITHUB_API}/repos/${repo}/actions/workflows/${GARMIN_WORKFLOW}/dispatches`,
    { method: "POST", headers: githubHeaders(token), body: JSON.stringify({ ref: "main" }), cache: "no-store" },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Échec du déclenchement de la synchro Garmin (${res.status}). ${detail.slice(0, 200)}`);
  }
  return { status: "dispatched", since };
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

/** On-demand "Régénérer le briefing" (the dashboard ⋮ menu). Pulls the latest Strava + recomputes the
 *  model (so the briefing sees fresh activities), then regenerates today's briefing inline — in the
 *  athlete's chosen coach voice, with the freshest profile/goals. Garmin recovery stays on the cron
 *  (no API); no push (the athlete is looking at the screen). Returns a summary for the UI toast. */
export async function generateBriefingNow(): Promise<{ pulled: number; briefing: BriefingResult }> {
  const sb = await createServiceClient();
  await enforceBriefingRateLimit(sb);
  const { pulled } = await syncStrava(sb);
  await rollupDailyMetrics(sb);
  const briefing = await generateBriefing(sb);
  try { await postDayVerdictMessage(sb); } catch { /* non-critical side-effect */ }
  revalidatePath("/");
  revalidatePath("/coach");
  return { pulled, briefing };
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
    target_load: estimate.total,
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
    target_load: estimate.total,
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
      if (p.perceived_rpe != null) await setRpe(p.activity_id, p.perceived_rpe);
      if (p.sport_code) {
        const sid = await resolveSportId(sb, p.sport_code);
        if (sid) {
          const upd = await sb.from("activities").update({ sport_id: sid, needs_review: true }).eq("id", p.activity_id);
          if (upd.error) throw new Error(upd.error.message);
        }
      }
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
