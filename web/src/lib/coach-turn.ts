/** UN tour de conversation avec le coach — le chemin partagé par la Server Action et la route API.
 *
 *  Il existe pour qu'il n'y ait qu'UNE implémentation : limite de débit, historique borné, appel de
 *  l'agent, persistance des deux messages, rattachement des propositions, écriture de la trace. Deux
 *  points d'entrée qui dupliqueraient cette séquence divergeraient au premier oubli. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateCoachReply, COACH_MODEL, type ChatTurn } from "./coach-chat";
import { LIMITS, fetchBounded } from "./agent/limits";
import { stampProposalMessage } from "./coach-proposals";
import { writeTrace, linkTraceToMessage, type TraceStep } from "./agent/trace";

/** Les tours réinjectés dans le prompt — les N plus RÉCENTS, jamais les N plus anciens.
 *
 *  Cette lecture était le même piège que `daily_metrics` : ascendante et SANS limite, donc une fois
 *  `coach_messages` au-delà des 1000 lignes de PostgREST elle aurait renvoyé les 1000 tours les PLUS
 *  ANCIENS — le coach aurait perdu, sans erreur ni trace, tous les échanges récents tout en continuant
 *  à les afficher sur /coach, qui pagine de son côté. La table est append-only et grossit d'environ 3
 *  lignes par jour d'usage : le plafond serait atteint en moins d'un an.
 *
 *  Au-delà de la limite on le DIT au modèle par un tour de contexte synthétique : mieux vaut un coach
 *  qui sait sa mémoire partielle qu'un coach qui l'ignore. Effet de bord utile : le coût par tour
 *  cesse de croître sans borne. */
export async function loadHistory(sb: SupabaseClient): Promise<ChatTurn[]> {
  const { rows, truncation } = await fetchBounded<{ role: ChatTurn["role"]; content: string }>(
    sb.from("coach_messages").select("role,content").order("created_at", { ascending: false }),
    LIMITS.chatHistoryTurns, { what: "tours de conversation", newestFirst: true },
  );
  const turns: ChatTurn[] = rows.map((m) => ({ role: m.role, content: m.content }));
  if (!truncation.truncated) return turns;
  console.warn(`[coach] historique tronqué aux ${LIMITS.chatHistoryTurns} tours les plus récents`);
  return [
    {
      role: "user",
      content:
        `[Contexte système — pas un message de l'athlète : seuls les ${LIMITS.chatHistoryTurns} derniers ` +
        `tours de votre conversation te sont fournis ; les échanges plus anciens ne sont PAS dans ce ` +
        `prompt. Si l'athlète renvoie à quelque chose que tu n'y retrouves pas, dis-lui que ça sort de ` +
        `ta fenêtre de conversation plutôt que de le reconstituer.]`,
    },
    ...turns,
  ];
}

/** Garde-fou coût/abus sur un chemin payant : le chat n'est protégé que par le mot de passe partagé,
 *  donc un mot de passe fuité pourrait sinon enchaîner les appels Claude. Compté en base (et non en
 *  mémoire) pour tenir sur du serverless. Ceinture, la bretelle étant le plafond mensuel côté console. */
export async function enforceCoachRateLimit(sb: SupabaseClient): Promise<void> {
  const now = Date.now();
  const [burst, daily] = await Promise.all([
    sb.from("coach_messages").select("id", { count: "exact", head: true })
      .eq("role", "user").gte("created_at", new Date(now - 60_000).toISOString()),
    sb.from("coach_messages").select("id", { count: "exact", head: true })
      .eq("role", "user").gte("created_at", new Date(now - 86_400_000).toISOString()),
  ]);
  if ((burst.count ?? 0) >= 3) throw new Error("Doucement — attends quelques secondes avant de relancer le coach.");
  if ((daily.count ?? 0) >= 50) throw new Error("Limite quotidienne atteinte (50 messages/jour au coach).");
}

export type CoachTurnResult = {
  answer: string;
  proposalIds: string[];
  messageId: string;
  traceId: string | null;
  iterations: number;
  tools: string[];
};

/** Exécute un tour complet. `userBubble` est ce que l'athlète VOIT dans le fil ; `promptContent` est ce
 *  que le modèle REÇOIT — les deux diffèrent pour le commentaire de séance, où la bulle est courte et
 *  le prompt porte le détail des activités. */
export async function runCoachTurn(sb: SupabaseClient, opts: {
  userBubble: string;
  promptContent?: string;
  kind: "chat" | "activity_comment";
  activityIds?: string[];
  briefingId?: string | null;
}): Promise<CoachTurnResult> {
  const prompt = opts.promptContent ?? opts.userBubble;
  await enforceCoachRateLimit(sb);

  // L'historique est lu AVANT l'insertion, sinon le nouveau tour serait compté deux fois dans le prompt.
  const history = await loadHistory(sb);

  const insU = await sb.from("coach_messages").insert({
    role: "user", kind: opts.kind, content: opts.userBubble,
    ...(opts.activityIds?.length ? { activity_ids: opts.activityIds } : {}),
  });
  if (insU.error) throw new Error(insU.error.message);

  const toolTrace: TraceStep[] = [];
  const r = await generateCoachReply({ sb, history, newUserContent: prompt, toolTrace });

  const traceId = await writeTrace(sb, {
    source: opts.kind, question: prompt, model: r.model, answer: r.text, steps: toolTrace,
    iterations: r.iterations, stopReason: r.stopReason, usage: r.usage, latencyMs: r.latencyMs,
  });

  const insC = await sb.from("coach_messages").insert({
    role: "coach", kind: opts.kind, content: r.text, model: COACH_MODEL,
    ...(opts.activityIds?.length ? { activity_ids: opts.activityIds } : {}),
    ...(opts.briefingId ? { briefing_id: opts.briefingId } : {}),
  }).select("id").single();
  if (insC.error) throw new Error(insC.error.message);

  const messageId = (insC.data as { id: string }).id;
  await stampProposalMessage(sb, r.proposalIds, messageId);
  await linkTraceToMessage(sb, traceId, messageId);

  return {
    answer: r.text, proposalIds: r.proposalIds, messageId, traceId,
    iterations: r.iterations, tools: [...new Set(toolTrace.map((t) => t.name))],
  };
}
