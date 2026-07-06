import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { runRegen } from "@/lib/regen";

/** On-demand briefing regeneration. Triggered by a plain fetch (NOT a Server Action) so it never blocks
 *  navigation — the client keeps browsing while this runs. On completion it revalidates the affected
 *  pages. Behind the app's login gate (proxy gates /api/* for the authenticated client).
 *
 *  The briefing now reads the CURRENT DB state (no inline Strava/Garmin sync) and is built algorithmically
 *  — in 'free' mode that's ZERO Anthropic calls (sub-second); in 'ai' mode it's ONE small, cached call.
 *  Either way it finishes in seconds, so the old 300 s (Fluid Compute) ceiling is no longer needed. */
export const maxDuration = 60;

export async function POST() {
  const sb = await createServiceClient();
  try {
    const { briefing } = await runRegen(sb);
    revalidatePath("/");
    revalidatePath("/coach");
    revalidatePath("/calendrier");
    return NextResponse.json({
      ok: true, readiness: briefing.readiness, today_session: briefing.today_session, mode: briefing.mode,
      // Diff du plan coach (une ligne FR par jour modifié ; [] = plan confirmé à l'identique) — le
      // bandeau de régénération l'affiche pour montrer que le coach a bien réévalué la semaine.
      changes: briefing.changes,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error)?.message ?? "Échec de la régénération." }, { status: 429 });
  }
}
