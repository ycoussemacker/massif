import { createServiceClient } from "@/lib/supabase/server";
import { loadCoachSettings, personaName } from "@/lib/coach-settings";
import { CoachAsk } from "./coach-ask";

/** Enveloppe serveur : résout le nom de la persona (comme CoachHero) et rend le champ client.
 *  Le champ lui-même est interactif, donc client ; la lecture des réglages reste côté serveur. */
export async function CoachAskSection() {
  const settings = await loadCoachSettings(await createServiceClient());
  return <CoachAsk coachName={personaName(settings.persona, settings.persona_gender)} />;
}
