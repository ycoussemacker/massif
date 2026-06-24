import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { runRegen } from "@/lib/regen";
import { sendPush } from "@/lib/push";

/** Background week-plan regeneration. Triggered by a plain fetch (NOT a Server Action) so it never
 *  blocks navigation — the client keeps browsing while this runs. On completion it revalidates the
 *  affected pages and pushes a notification (best-effort) so the athlete is told even if they left the
 *  app. Behind the app's login gate (proxy gates /api/* for the authenticated client). */
export const maxDuration = 60; // the Anthropic call can take ~15-30 s

export async function POST() {
  const sb = await createServiceClient();
  try {
    const { briefing, pulled } = await runRegen(sb);
    revalidatePath("/");
    revalidatePath("/coach");
    revalidatePath("/calendrier");
    const dot = { green: "🟢", amber: "🟡", red: "🔴" }[briefing.readiness] ?? "•";
    try {
      await sendPush(sb, {
        title: `${dot} Massif — plan mis à jour`,
        body: briefing.today_session ? `Aujourd'hui : ${briefing.today_session}` : "Ton plan de la semaine est à jour.",
        url: "/",
      });
    } catch { /* push is best-effort */ }
    return NextResponse.json({ ok: true, readiness: briefing.readiness, today_session: briefing.today_session, pulled });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error)?.message ?? "Échec de la régénération." }, { status: 429 });
  }
}
