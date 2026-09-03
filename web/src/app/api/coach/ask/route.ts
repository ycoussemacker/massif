import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { runCoachTurn } from "@/lib/coach-turn";

/** Poser une question au coach — la route API de l'agent.
 *
 *  Pourquoi une route et pas seulement la Server Action : une action bloque la navigation le temps de
 *  la réponse (13-17 s mesurées sur les évals), alors qu'un `fetch` laisse l'athlète continuer à
 *  naviguer — même raisonnement que /api/coach/regen. Elle rend aussi l'agent testable de l'extérieur
 *  sur le déploiement : un POST suffit.
 *
 *  Derrière le mot de passe de l'app : le proxy (web/src/proxy.ts) filtre tout /api sauf /api/login.
 *  La limite de débit du coach s'applique dans runCoachTurn, comme pour l'action.
 *
 *  POST { text } → { ok, answer, tools[], iterations, proposals, traceId }
 *  Le tour est persisté dans la conversation : la réponse est aussi lisible sur /coach. */
export const maxDuration = 60;

export async function POST(req: Request) {
  let text = "";
  try {
    const body = await req.json();
    text = String(body?.text ?? "").trim();
  } catch {
    return NextResponse.json({ ok: false, error: "Corps de requête JSON invalide." }, { status: 400 });
  }
  if (!text) return NextResponse.json({ ok: false, error: "Question vide." }, { status: 400 });
  if (text.length > 4000) {
    return NextResponse.json({ ok: false, error: "Question trop longue (4000 caractères max)." }, { status: 400 });
  }

  const sb = await createServiceClient();
  try {
    const r = await runCoachTurn(sb, { userBubble: text, kind: "chat" });
    revalidatePath("/coach");
    return NextResponse.json({
      ok: true, answer: r.answer, tools: r.tools, iterations: r.iterations,
      proposals: r.proposalIds.length, traceId: r.traceId,
    });
  } catch (e) {
    // La limite de débit remonte ici : 429 plutôt que 500, c'est une information pour l'appelant.
    const msg = (e as Error)?.message ?? "Échec de la demande au coach.";
    const rateLimited = /Doucement|Limite quotidienne/.test(msg);
    return NextResponse.json({ ok: false, error: msg }, { status: rateLimited ? 429 : 500 });
  }
}
