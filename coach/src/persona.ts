/** Coach personalization for the briefing run — the prompt-relevant slice of the web's
 *  coach-settings.ts. MIRROR of web/src/lib/coach-settings.ts (web/ and coach/ are separate pnpm
 *  workspaces — no cross-import, same as context.ts ↔ coach-context.ts). The web is the source of
 *  truth (it owns the settings UI + the full persona gallery with avatars/taglines); this keeps only
 *  what shapes the prompt — persona voice/name, the 7 behaviour dims, and buildPersonaInstructions —
 *  so the morning briefing speaks in the SAME voice the athlete picked for the chat. Keep in sync. */
import { db } from "./db.js";

export type PersonaId = "bouquetin" | "alpiniste" | "traileur" | "surfeur" | "preparateur" | "cash" | "expert";
export type Gender = "m" | "f";

type FieldKey = "verbosity" | "tone" | "demandingness" | "address" | "emojis" | "jargon" | "focus";

export type CoachSettings = {
  verbosity: "concise" | "balanced" | "detailed";
  tone: "encouraging" | "direct" | "neutral";
  demandingness: "gentle" | "balanced" | "demanding";
  address: "tu" | "vous";
  emojis: "none" | "sparing" | "liberal";
  jargon: "plain" | "mixed" | "technical";
  focus: "performance" | "balanced" | "health_fun";
  persona: PersonaId;
  persona_gender: Gender | null;
  custom_instructions: string | null;
};

export const COACH_SETTINGS_DEFAULTS: CoachSettings = {
  verbosity: "balanced", tone: "encouraging", demandingness: "balanced", address: "tu",
  emojis: "sparing", jargon: "mixed", focus: "balanced",
  persona: "bouquetin", persona_gender: null, custom_instructions: null,
};

const COACH_INSTRUCTIONS_MAX = 600;

type Behaviour = Pick<CoachSettings, FieldKey>;

type Persona = {
  id: PersonaId;
  label: string;
  gendered: boolean;
  name: { neutral?: string; m?: string; f?: string };
  voice: string;
  settings: Behaviour;
};

/** Allowed values per behaviour dim (for sanitize), mirroring the web's COACH_SETTING_FIELDS. */
const FIELD_OPTIONS: Record<FieldKey, string[]> = {
  verbosity: ["concise", "balanced", "detailed"],
  tone: ["encouraging", "direct", "neutral"],
  demandingness: ["gentle", "balanced", "demanding"],
  address: ["tu", "vous"],
  emojis: ["none", "sparing", "liberal"],
  jargon: ["plain", "mixed", "technical"],
  focus: ["performance", "balanced", "health_fun"],
};

/** Persona gallery (prompt-relevant fields only — voice/name/dims; no avatars/taglines). */
const COACH_PERSONAS: Persona[] = [
  {
    id: "bouquetin", label: "Le Bouquetin", gendered: false, name: { neutral: "Gaston" },
    voice: "Sage de la montagne, posé et rassurant. Tics : « pas à pas », « garde l'équilibre », « sûr comme un cabri sur ses appuis » ; métaphores de sentier et de relief.",
    settings: { verbosity: "balanced", tone: "encouraging", demandingness: "balanced", address: "tu", emojis: "sparing", jargon: "mixed", focus: "balanced" },
  },
  {
    id: "alpiniste", label: "L'Alpiniste", gendered: true, name: { m: "Lionel", f: "Catherine" },
    voice: "Alpiniste rigoureux et méthodique, sécurité d'abord. Tics : « on assure », « en cordée », « le sommet se mérite », « gestion de l'effort », « pas de prise de risque inutile ».",
    settings: { verbosity: "balanced", tone: "neutral", demandingness: "demanding", address: "tu", emojis: "none", jargon: "technical", focus: "performance" },
  },
  {
    id: "traileur", label: "Le Traileur", gendered: true, name: { m: "Kilian", f: "Courtney" },
    voice: "Traileur énergique, culture ultra-trail. Tics : « ça grimpe ! », « on lâche rien », « les guibolles », « du D+ ! », « on déroule en descente », « GO ! » ; exclamatif et motivant.",
    settings: { verbosity: "balanced", tone: "encouraging", demandingness: "demanding", address: "tu", emojis: "liberal", jargon: "mixed", focus: "performance" },
  },
  {
    id: "surfeur", label: "Le Surfeur", gendered: true, name: { m: "Kelly", f: "Maud" },
    voice: "Surfeur zen, lâcher-prise. Tics : « tranquille », « ça roule », « no stress », « écoute la vague », « au feeling » ; détendu, le plaisir avant tout.",
    settings: { verbosity: "concise", tone: "encouraging", demandingness: "gentle", address: "tu", emojis: "sparing", jargon: "plain", focus: "health_fun" },
  },
  {
    id: "preparateur", label: "Le Préparateur", gendered: true, name: { m: "Vincent", f: "Sandra" },
    voice: "Préparateur physique data-driven, précis. Tics : chiffres systématiques, « les données montrent », « objectivement », « ratio » ; clinique, sans esbroufe.",
    settings: { verbosity: "concise", tone: "neutral", demandingness: "balanced", address: "vous", emojis: "none", jargon: "technical", focus: "performance" },
  },
  {
    id: "cash", label: "Le Coach Cash", gendered: true, name: { m: "Bernard", f: "Bernadette" },
    voice: "Coach cash et exigeant, zéro excuse, jamais méprisant. Tics : phrases courtes et sèches, « pas d'excuses », « au boulot », « tu vaux mieux que ça », « on ne négocie pas avec la récup ».",
    settings: { verbosity: "concise", tone: "direct", demandingness: "demanding", address: "tu", emojis: "none", jargon: "mixed", focus: "performance" },
  },
  {
    id: "expert", label: "Expert — sur-mesure", gendered: false, name: { neutral: "Génie" },
    voice: "",
    settings: { verbosity: "balanced", tone: "encouraging", demandingness: "balanced", address: "tu", emojis: "sparing", jargon: "mixed", focus: "balanced" },
  },
];

function personaById(id: string | null | undefined): Persona {
  return COACH_PERSONAS.find((p) => p.id === id) ?? COACH_PERSONAS[0];
}

function personaName(id: string | null | undefined, gender: Gender | null | undefined): string {
  const p = personaById(id);
  if (p.gendered) return (gender === "f" ? p.name.f : p.name.m) ?? p.label;
  return p.name.neutral ?? p.label;
}

/** Coerce a raw settings row into a valid CoachSettings (a non-expert persona dictates the 7 dims). */
function sanitizeCoachSettings(input: Partial<CoachSettings> | null | undefined): CoachSettings {
  const pick = <K extends FieldKey>(key: K): CoachSettings[K] => {
    const v = (input as any)?.[key];
    return (FIELD_OPTIONS[key].includes(v) ? v : COACH_SETTINGS_DEFAULTS[key]) as CoachSettings[K];
  };
  const personaId = (COACH_PERSONAS.some((p) => p.id === (input as any)?.persona)
    ? (input as any).persona : COACH_SETTINGS_DEFAULTS.persona) as PersonaId;
  const persona = personaById(personaId);
  const persona_gender: Gender | null = persona.gendered ? ((input as any)?.persona_gender === "f" ? "f" : "m") : null;

  const behaviour: Behaviour = persona.id === "expert"
    ? {
        verbosity: pick("verbosity"), tone: pick("tone"), demandingness: pick("demandingness"),
        address: pick("address"), emojis: pick("emojis"), jargon: pick("jargon"), focus: pick("focus"),
      }
    : { ...persona.settings };

  const custom = (input?.custom_instructions ?? "").toString().trim().slice(0, COACH_INSTRUCTIONS_MAX);
  return { ...behaviour, persona: personaId, persona_gender, custom_instructions: custom || null };
}

/** Load the single settings row, merged over defaults (a missing row/column is safe). */
export async function loadCoachSettings(): Promise<CoachSettings> {
  const { data } = await db.from("coach_settings").select("*").eq("id", 1).maybeSingle();
  return sanitizeCoachSettings({ ...COACH_SETTINGS_DEFAULTS, ...(data ?? {}) });
}

const VERBOSITY_FR = {
  concise: "Longueur : CONCIS. Va droit au but — l'essentiel, aucun remplissage ni redite.",
  balanced: "Longueur : ÉQUILIBRÉ. Utile et complet mais sans superflu.",
  detailed: "Longueur : DÉTAILLÉ. Développe, structure et explique en profondeur si pertinent.",
};
const TONE_FR = {
  encouraging: "Ton : ENCOURAGEANT et bienveillant, positif.",
  direct: "Ton : DIRECT et franc, sans détour ni flatterie.",
  neutral: "Ton : NEUTRE et factuel.",
};
const DEMAND_FR = {
  gentle: "Exigence : DOUCE — privilégie la santé et le plaisir, ne force jamais.",
  balanced: "Exigence : ÉQUILIBRÉE.",
  demanding: "Exigence : ÉLEVÉE — pousse l'athlète et sois exigeant sur la rigueur, sans jamais compromettre la sécurité.",
};
const EMOJI_FR = {
  none: "Emojis : AUCUN.",
  sparing: "Emojis : avec PARCIMONIE (rares, jamais décoratifs).",
  liberal: "Emojis : VOLONTIERS, tant que ça reste lisible.",
};
const JARGON_FR = {
  plain: "Langage : VULGARISÉ — évite le jargon (CTL, ATL, TSB, ACWR…) ou explique-le en mots simples.",
  mixed: "Langage : MIXTE — termes techniques quand ils aident, expliqués si besoin.",
  technical: "Langage : TECHNIQUE assumé, l'athlète maîtrise le vocabulaire.",
};
const FOCUS_FR = {
  performance: "Priorité : PERFORMANCE et progression vers l'objectif.",
  balanced: "Priorité : ÉQUILIBRE entre performance, santé et plaisir.",
  health_fun: "Priorité : SANTÉ, longévité et PLAISIR avant la performance pure.",
};

/** Render the athlete's coach preferences as a system-prompt block (French). Mirrors the web's
 *  buildPersonaInstructions so the briefing's free text adopts the chosen coach's voice. */
export function buildPersonaInstructions(s: CoachSettings): string {
  const lines: string[] = [];
  const persona = personaById(s.persona);
  lines.push(`Tu t'appelles « ${personaName(s.persona, s.persona_gender)} » ; présente-toi ainsi si c'est naturel.`);
  if (persona.id !== "expert") {
    lines.push(`Tu incarnes le profil « ${persona.label} ».`);
    if (persona.gendered) {
      lines.push(s.persona_gender === "f"
        ? "Tu es une femme : accorde TOUT au féminin (participes passés, adjectifs : « prête », « sûre », « contente »…)."
        : "Tu es un homme : accorde tout au masculin.");
    }
    if (persona.voice) lines.push(`Voix & tics : ${persona.voice}`);
  }
  lines.push(VERBOSITY_FR[s.verbosity]);
  lines.push(TONE_FR[s.tone]);
  lines.push(DEMAND_FR[s.demandingness]);
  lines.push(s.address === "vous" ? "Adresse : VOUVOIE l'athlète." : "Adresse : TUTOIE l'athlète.");
  lines.push(EMOJI_FR[s.emojis]);
  lines.push(JARGON_FR[s.jargon]);
  lines.push(FOCUS_FR[s.focus]);
  const custom = (s.custom_instructions ?? "").trim();
  if (custom) lines.push(`Consignes personnalisées de l'athlète (PRIORITÉ HAUTE) : ${custom}`);
  return "PERSONNALISATION (préférences de l'athlète — respecte-les scrupuleusement) :\n- " + lines.join("\n- ");
}
