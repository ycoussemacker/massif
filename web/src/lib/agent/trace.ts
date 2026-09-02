/** Écriture des traces d'exécution de l'agent.
 *
 *  Une ligne par tour : la question, les outils appelés AVEC leurs arguments, le nombre d'itérations,
 *  la réponse, les tokens, le coût estimé et la latence. Sans ça, « quels outils a-t-il appelés et
 *  pourquoi ça a coûté ça ? » n'a pas de réponse — ni pour déboguer, ni pour citer une métrique.
 *
 *  L'écriture est BEST-EFFORT : une trace qui échoue ne doit jamais faire échouer la réponse à
 *  l'athlète. La trace est un instrument de mesure, pas une dépendance du produit. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { costMicroUsd, type Usage } from "./pricing";

export type TraceStep = { name: string; input: unknown; ok: boolean; error?: string };

export type TraceInput = {
  source: "chat" | "activity_comment" | "cli" | "eval";
  question: string;
  model: string;
  answer: string;
  steps: TraceStep[];
  iterations: number;
  stopReason: string;
  usage: Usage;
  latencyMs: number;
  coachMessageId?: string | null;
};

/** Tronque les arguments d'outil stockés : une trace sert à comprendre un appel, pas à archiver un
 *  payload. Les propositions portent des textes longs (description, rationale) qui gonfleraient la
 *  table sans rien apprendre. */
function compactInput(input: unknown): unknown {
  const json = JSON.stringify(input ?? null);
  if (json.length <= 800) return input;
  return { _truncated: true, preview: json.slice(0, 800) };
}

export async function writeTrace(sb: SupabaseClient, t: TraceInput): Promise<string | null> {
  try {
    const { data, error } = await sb.from("coach_agent_traces").insert({
      coach_message_id: t.coachMessageId ?? null,
      source: t.source,
      question: t.question.slice(0, 4000),
      model: t.model,
      iterations: t.iterations,
      stop_reason: t.stopReason,
      steps: t.steps.map((s, i) => ({
        i: i + 1, tool: s.name, input: compactInput(s.input), ok: s.ok, error: s.error ?? null,
      })),
      answer: t.answer.slice(0, 20000),
      usage: t.usage,
      cost_micro_usd: costMicroUsd(t.model, t.usage),
      latency_ms: t.latencyMs,
    }).select("id").single();
    if (error) throw new Error(error.message);
    return (data as { id: string }).id;
  } catch (e) {
    // Table absente (migration non poussée) ou écriture refusée : on le dit dans les logs et on
    // continue. Perdre une mesure est acceptable ; perdre la réponse de l'athlète ne l'est pas.
    console.warn("[agent] trace non écrite :", (e as Error)?.message ?? e);
    return null;
  }
}

/** Rattache après coup une trace au message de coach qu'elle a produit (l'id du message n'existe
 *  qu'une fois la réponse insérée). */
export async function linkTraceToMessage(sb: SupabaseClient, traceId: string | null, messageId: string) {
  if (!traceId) return;
  try {
    await sb.from("coach_agent_traces").update({ coach_message_id: messageId }).eq("id", traceId);
  } catch { /* best-effort */ }
}
