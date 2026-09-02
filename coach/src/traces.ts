/** Agrégat des traces d'exécution de l'agent — la métrique citable.
 *
 *   pnpm -C coach traces            # 30 derniers jours
 *   pnpm -C coach traces --days=7
 *
 *  Répond aux questions qu'on pose à un agent en production : combien coûte une requête, combien
 *  d'itérations il lui faut, quels outils il appelle vraiment, et où part la latence. Les moyennes
 *  seules mentent sur une distribution à longue traîne, donc on sort aussi la médiane et le p95. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { formatUsd } from "../../web/src/lib/agent/pricing.js";

const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, "../../.env"), quiet: true });

const days = Number(process.argv.find((a) => a.startsWith("--days="))?.split("=")[1]) || 30;
const since = new Date(Date.now() - days * 86_400_000).toISOString();

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const { data, error } = await sb.from("coach_agent_traces")
  .select("source,model,iterations,stop_reason,steps,usage,cost_micro_usd,latency_ms,created_at")
  .gte("created_at", since).order("created_at", { ascending: false }).limit(1000);

if (error) {
  console.error(
    `Lecture impossible : ${error.message}\n` +
    `Si la table n'existe pas encore, applique la migration : supabase db push`);
  process.exit(1);
}

const rows = data ?? [];
if (!rows.length) {
  console.log(`Aucune trace sur ${days} jours. (L'agent n'a pas tourné, ou la migration n'est pas appliquée.)`);
  process.exit(0);
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))];
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

const costs = rows.map((r: any) => r.cost_micro_usd).filter((x: any) => x != null) as number[];
const iters = rows.map((r: any) => Number(r.iterations || 0));
const lat = rows.map((r: any) => Number(r.latency_ms || 0));
const tokens = rows.reduce((t: number, r: any) => t + Number(r.usage?.input_tokens || 0)
  + Number(r.usage?.output_tokens || 0) + Number(r.usage?.cache_read_input_tokens || 0), 0);
const cacheRead = rows.reduce((t: number, r: any) => t + Number(r.usage?.cache_read_input_tokens || 0), 0);
const inputAll = rows.reduce((t: number, r: any) => t + Number(r.usage?.input_tokens || 0)
  + Number(r.usage?.cache_read_input_tokens || 0) + Number(r.usage?.cache_creation_input_tokens || 0), 0);

const toolCount = new Map<string, number>();
let noTool = 0;
for (const r of rows as any[]) {
  const steps = (r.steps ?? []) as { tool: string }[];
  if (!steps.length) noTool++;
  for (const s of steps) toolCount.set(s.tool, (toolCount.get(s.tool) ?? 0) + 1);
}

console.log(`\nAgent Massif — ${rows.length} tours sur ${days} jours\n`);
console.log(`  Coût moyen par requête    ${formatUsd(costs.length ? Math.round(mean(costs)) : null)}`);
console.log(`  Coût médian / p95         ${formatUsd(pct(costs, 0.5))} / ${formatUsd(pct(costs, 0.95))}`);
console.log(`  Coût total sur la période ${formatUsd(costs.reduce((a, b) => a + b, 0))}`);
console.log(`  Itérations médiane / max  ${pct(iters, 0.5)} / ${Math.max(...iters)}`);
console.log(`  Latence médiane / p95     ${Math.round(pct(lat, 0.5) / 100) / 10} s / ${Math.round(pct(lat, 0.95) / 100) / 10} s`);
console.log(`  Tokens (total)            ${tokens.toLocaleString("fr-FR")}`);
console.log(`  Servis par le cache       ${inputAll ? Math.round((cacheRead / inputAll) * 100) : 0} % de l'entrée`);
console.log(`  Tours sans aucun outil    ${noTool} (${Math.round((noTool / rows.length) * 100)} %)`);
console.log(`\n  Outils appelés :`);
for (const [tool, n] of [...toolCount].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${tool.padEnd(24)} ${n}`);
}
console.log();
