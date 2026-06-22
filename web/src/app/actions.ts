"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import { sessionRpeLoad } from "@/lib/load";
import { generateCoachReply, COACH_MODEL, type ChatTurn } from "@/lib/coach-chat";
import { todayLocal, whenLabelFr } from "@/lib/coach-context";
import { sanitizeCoachSettings, type CoachSettings } from "@/lib/coach-settings";
import { syncStrava } from "@/lib/strava-sync";
import { rollupDailyMetrics } from "@/lib/rollup";

/** Log a post-session RPE (1–10) for an activity and recompute its load via session_rpe.
 *  Writes the two channels (never the generated total) + rpe_source='user' so the next sync keeps it.
 *  daily_metrics (CTL/ATL/charts) recompute on the next rollup/nightly run. */
export async function setRpe(activityId: string, rpe: number): Promise<void> {
  if (!Number.isInteger(rpe) || rpe < 1 || rpe > 10) throw new Error("RPE doit être un entier 1–10");

  const sb = await createServiceClient();
  const { data: act, error } = await sb
    .from("activities")
    .select("id,duration_s,sport_id,vertical_loss_m,carried_load_kg")
    .eq("id", activityId).single();
  if (error || !act) throw new Error("Activité introuvable");

  const { data: sport } = await sb
    .from("sports").select("taxonomy_group").eq("id", act.sport_id).single();
  // weight feeds the carried-mass factor of the eccentric-descent term (mirror of load.py).
  const { data: profile } = await sb.from("athlete_profile").select("weight_kg").limit(1).single();

  const load = sessionRpeLoad(act.duration_s ?? 0, rpe, sport?.taxonomy_group ?? null, {
    verticalLossM: act.vertical_loss_m,
    carriedLoadKg: act.carried_load_kg,
    weightKg: profile?.weight_kg,
  });

  const { error: upErr } = await sb.from("activities").update({
    perceived_rpe: rpe,
    rpe_source: "user",
    load_method_used: "session_rpe",
    aerobic_load: load.aerobic_load,
    neuromuscular_load: load.neuromuscular_load,
    intensity_factor: load.intensity_factor,
  }).eq("id", activityId);
  if (upErr) throw new Error(upErr.message);

  revalidatePath("/");
  revalidatePath("/coach");
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

  const reply = await generateCoachReply({ sb, history, newUserContent: content });

  const insC = await sb.from("coach_messages").insert({ role: "coach", kind: "chat", content: reply, model: COACH_MODEL });
  if (insC.error) throw new Error(insC.error.message);

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

  const reply = await generateCoachReply({ sb, history, newUserContent });

  const insC = await sb.from("coach_messages").insert({
    role: "coach", kind: "activity_comment", content: reply, model: COACH_MODEL,
    activity_ids: activityIds, briefing_id: briefing?.id ?? null,
  });
  if (insC.error) throw new Error(insC.error.message);

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
  revalidatePath("/");
  revalidatePath("/coach");
  return { pulled, newest, days };
}
