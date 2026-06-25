/* Re-estimate declared events with the same-sport moving-fraction fix. Faithful to estimateForDeclared
 * (same PURE estimateActivityLoad + resolveProfile), with deps fetched via REST so it runs outside Next.
 *   read-only preview:  set -a; . ../.env; set +a; npx tsx scripts/dry-run-estimate.ts
 *   PERSIST:            ...                          npx tsx scripts/dry-run-estimate.ts --write
 * --write updates planned_sessions.predicted_aerobic_load/predicted_neuromuscular_load/prediction_basis. */
import { createClient } from "@supabase/supabase-js";
import { estimateActivityLoad, type DeclaredActivity } from "../src/lib/estimate";
import { resolveProfile, type LoadProfile, type ThresholdRow } from "../src/lib/load";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY ?? "";
const WRITE = process.argv.includes("--write");

const FRAC_BY_SPORT: Record<string, number> = {
  grande_voie: 0.35, rock_climbing: 0.4, alpinism: 0.55, via_ferrata: 0.55,
  ski_touring: 0.65, snowshoeing: 0.8, hiking: 0.82, walking: 0.9, trail_running: 0.92, running: 0.95,
};
const FRAC_BY_TAX: Record<string, number> = { mountain_technical: 0.4, technical_strength: 0.45, mountain_vertical: 0.7, paced_endurance: 0.93 };
const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const ACT = "id,sport_id,needs_review,aerobic_load,neuromuscular_load,moving_s,duration_s,distance_m,vertical_gain_m,vertical_loss_m";

async function main() {
  if (!URL || !KEY) { console.error("env manquant"); process.exit(1); }
  const sb = createClient(URL, KEY, { auth: { persistSession: false } });
  const today = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - 540 * 86_400_000).toISOString().slice(0, 10);

  const [{ data: sports }, { data: prof }, { data: paramRows }, { data: thr }] = await Promise.all([
    sb.from("sports").select("id,code,taxonomy_group,load_method_ladder"),
    sb.from("athlete_profile").select("max_hr,resting_hr,lthr,ftp_watts,threshold_pace_s_per_km,weight_kg").limit(1).maybeSingle(),
    sb.from("athlete_load_params").select("param,value"),
    sb.from("athlete_thresholds").select("*").order("effective_date", { ascending: true }),
  ]);
  const byId = new Map<number, any>((sports ?? []).map((s: any) => [s.id, s]));
  const params = Object.fromEntries(((paramRows ?? []) as any[]).filter((r) => r.value != null).map((r) => [r.param, Number(r.value)]));
  const profile = resolveProfile((prof ?? {}) as LoadProfile, (thr ?? []) as ThresholdRow[], today);

  const { data: events } = await sb.from("planned_sessions")
    .select("id,title,sport_id,target_distance_m,target_vertical_m,target_duration_s,predicted_aerobic_load,predicted_neuromuscular_load")
    .eq("is_event", true).eq("status", "planned").gte("planned_date", today);

  for (const e of events ?? []) {
    const sp = byId.get(e.sport_id); const tax = sp?.taxonomy_group ?? null;
    const { data: exact } = await sb.from("activities").select(ACT).eq("sport_id", e.sport_id)
      .gte("local_date", since).order("training_load", { ascending: false }).limit(300);
    const exactRows = (exact ?? []) as any[];
    const ratios = exactRows.map((c) => (c.moving_s && c.duration_s > 0 ? c.moving_s / c.duration_s : null)).filter((r): r is number => r != null && r > 0.2 && r <= 1);
    const frac = ratios.length >= 3 ? Math.max(0.4, Math.min(1, median(ratios))) : (sp?.code && FRAC_BY_SPORT[sp.code]) || (tax && FRAC_BY_TAX[tax]) || 0.85;

    let candidates = exactRows;
    if (exactRows.length < 5 && tax) {
      const taxIds = (sports ?? []).filter((s: any) => s.taxonomy_group === tax).map((s: any) => s.id);
      const { data: wide } = await sb.from("activities").select(ACT).in("sport_id", taxIds)
        .gte("local_date", since).order("training_load", { ascending: false }).limit(300);
      candidates = (wide ?? []) as any[];
    }
    const declared: DeclaredActivity = { sportId: e.sport_id, taxonomyGroup: tax, distanceM: e.target_distance_m, verticalGainM: e.target_vertical_m, durationS: e.target_duration_s, name: e.title };
    const adj: DeclaredActivity = e.target_duration_s != null ? { ...declared, durationS: Math.round(e.target_duration_s * frac) } : declared;
    const sport = { taxonomy_group: tax, load_method_ladder: sp?.load_method_ladder ?? null };
    const est = estimateActivityLoad(adj, { candidates: candidates as any, hist: candidates as any, sport, profile, params });

    const old = Math.round((e.predicted_aerobic_load ?? 0) + (e.predicted_neuromuscular_load ?? 0));
    console.log(`\n• ${e.title} (${sp?.code}, ratio mvt ${frac.toFixed(2)})`);
    console.log(`  ${(e.target_duration_s / 3600).toFixed(1)}h déclarées → ${(e.target_duration_s * frac / 3600).toFixed(1)}h mvt`);
    console.log(`  ${old} pts (stocké)  →  ${Math.round(est.total)} pts [aéro ${Math.round(est.aerobic)} / neuro ${Math.round(est.neuro)}] · ${est.basisLabel}`);
    if (WRITE) {
      const { error } = await sb.from("planned_sessions")
        .update({ predicted_aerobic_load: est.aerobic, predicted_neuromuscular_load: est.neuro, prediction_basis: est.basisLabel })
        .eq("id", e.id);
      console.log(error ? `  ✗ écriture: ${error.message}` : `  ✓ écrit en base`);
    }
  }
  console.log(WRITE ? "\n(écrit)\n" : "\n(lecture seule — relance avec --write pour persister)\n");
}
main().catch((e) => { console.error("failed:", e?.message ?? e); process.exit(1); });
