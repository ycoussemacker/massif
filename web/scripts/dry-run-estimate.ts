/* Read-only preview of the EVENT load estimate after the same-sport moving-fraction fix.
 * Replicates estimateForDeclared via REST (no next/headers) + the PURE estimateFromNeighbours, so it
 * writes NOTHING. Shows, per declared event: old stored estimate vs new (same-sport ratio applied).
 * Run from web/:  set -a; . ../.env; set +a; npx tsx scripts/dry-run-estimate.ts */
import { createClient } from "@supabase/supabase-js";
import { estimateFromNeighbours, type DeclaredActivity } from "../src/lib/estimate";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY ?? "";

const MOVING_FRACTION_BY_SPORT: Record<string, number> = {
  grande_voie: 0.35, rock_climbing: 0.4, alpinism: 0.55, via_ferrata: 0.55,
  ski_touring: 0.65, snowshoeing: 0.8, hiking: 0.82, walking: 0.9, trail_running: 0.92, running: 0.95,
};
const MOVING_FRACTION_BY_TAXONOMY: Record<string, number> = {
  mountain_technical: 0.4, technical_strength: 0.45, mountain_vertical: 0.7, paced_endurance: 0.93,
};
const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

async function main() {
  if (!URL || !KEY) { console.error("env manquant"); process.exit(1); }
  const sb = createClient(URL, KEY, { auth: { persistSession: false } });
  const ACT_COLS = "id,sport_id,needs_review,aerobic_load,neuromuscular_load,moving_s,duration_s,distance_m,vertical_gain_m,vertical_loss_m";

  const { data: sports } = await sb.from("sports").select("id,code,taxonomy_group");
  const byId = new Map<number, any>((sports ?? []).map((s: any) => [s.id, s]));
  const { data: events } = await sb.from("planned_sessions")
    .select("title,sport_id,target_distance_m,target_vertical_m,target_duration_s,predicted_aerobic_load,predicted_neuromuscular_load")
    .eq("is_event", true);

  for (const e of events ?? []) {
    const sp = byId.get(e.sport_id);
    const tax = sp?.taxonomy_group ?? null;
    // Exact-sport history (for the ratio + first-choice candidates).
    const { data: exact } = await sb.from("activities").select(ACT_COLS)
      .eq("sport_id", e.sport_id).gte("local_date", "2024-12-01").order("training_load", { ascending: false }).limit(300);
    const exactRows = (exact ?? []) as any[];
    // Same-sport moving ratio (else per-sport default — never the rando set).
    const ratios = exactRows.map((c) => (c.moving_s && c.duration_s > 0 ? c.moving_s / c.duration_s : null))
      .filter((r): r is number => r != null && r > 0.2 && r <= 1);
    const frac = ratios.length >= 3 ? Math.max(0.4, Math.min(1, median(ratios)))
      : (sp?.code && MOVING_FRACTION_BY_SPORT[sp.code]) || (tax && MOVING_FRACTION_BY_TAXONOMY[tax]) || 0.85;

    // Candidates: exact sport, widen to taxonomy if thin (mirror of estimateForDeclared).
    let candidates = exactRows;
    if (exactRows.length < 5 && tax) {
      const taxIds = (sports ?? []).filter((s: any) => s.taxonomy_group === tax).map((s: any) => s.id);
      const { data: wide } = await sb.from("activities").select(ACT_COLS)
        .in("sport_id", taxIds).gte("local_date", "2024-12-01").order("training_load", { ascending: false }).limit(300);
      candidates = (wide ?? []) as any[];
    }

    const declared: DeclaredActivity = {
      sportId: e.sport_id, taxonomyGroup: tax, distanceM: e.target_distance_m,
      verticalGainM: e.target_vertical_m, durationS: e.target_duration_s, name: e.title,
    };
    const adj: DeclaredActivity = e.target_duration_s != null
      ? { ...declared, durationS: Math.round(e.target_duration_s * frac) } : declared;

    const oldEst = (e.predicted_aerobic_load ?? 0) + (e.predicted_neuromuscular_load ?? 0);
    const before = estimateFromNeighbours(declared, candidates as any);   // matched on declared TOTAL (bug)
    const after = estimateFromNeighbours(adj, candidates as any);          // matched on estimated MOVING (fix)
    console.log(`\n• ${e.title}`);
    console.log(`  sport=${sp?.code} (tax ${tax}) · exact-sport history: ${exactRows.length} act · ratio mouvement=${frac.toFixed(2)} ${ratios.length >= 3 ? "(tes données)" : "(défaut sport)"}`);
    console.log(`  durée déclarée ${(e.target_duration_s / 3600).toFixed(1)}h → mouvement estimé ${(e.target_duration_s * frac / 3600).toFixed(1)}h`);
    console.log(`  estimation STOCKÉE : ${Math.round(oldEst)} pts`);
    console.log(`  re-calc SANS fix   : ${before ? Math.round(before.total) : "n/a"} pts (${before?.basisLabel ?? ""})`);
    console.log(`  re-calc AVEC fix   : ${after ? Math.round(after.total) : "n/a"} pts (${after?.basisLabel ?? ""})`);
  }
  console.log("\n(lecture seule — rien écrit en base)\n");
}
main().catch((e) => { console.error("dry-run failed:", e?.message ?? e); process.exit(1); });
