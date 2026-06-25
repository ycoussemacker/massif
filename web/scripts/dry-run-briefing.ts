/* Dry-run : prévisualise le briefing ALGORITHMIQUE sous différents scénarios « what-if », SANS rien
 * écrire en base (lecture seule). Le moteur (buildAlgorithmicBriefing) est pur → on mute une COPIE du
 * contexte réel pour simuler « comme si je partais de 0 ce matin ».
 *
 * Lancer depuis web/ :
 *   set -a; . ../.env; set +a            # charge NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *   npx tsx scripts/dry-run-briefing.ts
 *
 * Note : readiness lit le dernier modèle de forme calculé (qui inclut déjà la charge d'aujourd'hui si
 * elle a été rollée) — l'écart d'un jour facile sur le TSB est minime ; le scénario montre surtout le
 * comportement de la SÉANCE du jour + du PLAN 7 j. */
import { createClient } from "@supabase/supabase-js";
import { assembleCoachContext } from "../src/lib/coach-context";
import { buildAlgorithmicBriefing } from "../src/lib/briefing-algo";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY ?? "";

function show(label: string, ctx: any) {
  const b = buildAlgorithmicBriefing(ctx);
  const dot = ({ green: "🟢", amber: "🟡", red: "🔴" } as Record<string, string>)[b.readiness] ?? "•";
  const s0 = b.detailed_sessions[0];
  const band = s0?.target_hr_low ? ` ${s0.target_hr_low}-${s0.target_hr_high} bpm` : "";
  console.log(`\n===== ${label} =====`);
  console.log(`${dot} readiness=${b.readiness}  confidence=${b.confidence}`);
  console.log(`Séance du jour : ${s0?.title} — ${s0?.intensity_zone ?? "—"}${band}  (${s0?.target_duration_min ?? 0} min)`);
  console.log(`Why  : ${b.why}`);
  if (b.flag) console.log(`⚠️   ${b.flag}`);
  console.log(`État : ${b.state_assessment}`);
  console.log(`Plan 7 j :`);
  for (const d of b.week_plan) {
    console.log(`  +${d.day_offset}j  ${String(d.system_tag).padEnd(18)} ${String(d.sport_code).padEnd(16)} ${Math.round(d.target_load)} pts  — ${d.focus}`);
  }
}

async function main() {
  if (!URL || !KEY) {
    console.error("Manque NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (fais: set -a; . ../.env; set +a)");
    process.exit(1);
  }
  const sb = createClient(URL, KEY, { auth: { persistSession: false } });
  const { today, context } = await assembleCoachContext(sb as any);
  const clone = () => JSON.parse(JSON.stringify(context));

  // 1) État réel (référence).
  show("RÉEL (état actuel)", context);

  // 2) Comme ce matin : sans l'activité du jour.
  const noAct = clone();
  noAct.recent_activities_14d = (noAct.recent_activities_14d ?? []).filter((a: any) => a.date !== today);
  noAct.daily_load_21d = (noAct.daily_load_21d ?? []).map((d: any) => (d.date === today ? { ...d, load: 0, aerobic: 0, neuro: 0 } : d));
  show("DÉPART DE 0 — sans l'activité du jour", noAct);

  // 3) + sans la séance épinglée du jour → la PRESCRIPTION pure du coach pour aujourd'hui.
  const pure = clone();
  pure.recent_activities_14d = (pure.recent_activities_14d ?? []).filter((a: any) => a.date !== today);
  pure.daily_load_21d = noAct.daily_load_21d;
  pure.pinned_sessions = (pure.pinned_sessions ?? []).filter((p: any) => p.day_offset !== 0);
  show("DÉPART DE 0 — sans activité NI séance épinglée du jour (prescription pure du coach)", pure);

  console.log(`\n(lecture seule — aucune écriture en base)\n`);
}

main().catch((e) => { console.error("dry-run failed:", e?.message ?? e); process.exit(1); });
