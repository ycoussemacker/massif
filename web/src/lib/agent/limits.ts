/** Bornes de lecture des outils de l'agent — et SIGNALEMENT explicite de la troncature.
 *
 *  POURQUOI. PostgREST plafonne CHAQUE réponse à 1000 lignes (`max-rows` du projet). Une lecture dont le
 *  résultat dépasse ce plafond renvoie 1000 lignes SANS erreur, SANS exception, SANS indication : le code
 *  appelant prend une tranche pour la réponse complète. Pire, avec `.order(col, { ascending: true })` ce
 *  sont les 1000 lignes les PLUS ANCIENNES qui survivent — la période récente, la seule qui compte pour
 *  un coach, est celle qui disparaît. Le même piège a déjà gelé les graphes du dashboard deux ans en
 *  arrière (voir la note « PostgREST 1000-row cap » dans CLAUDE.md).
 *
 *  Pour un OUTIL D'AGENT la conséquence est plus grave que pour une page : le modèle ne voit pas la
 *  troncature, donc il répond avec assurance à partir de données fausses. « Ton volume a chuté » alors
 *  que ce sont les données qui manquent, pas l'entraînement.
 *
 *  LA RÈGLE, appliquée à toutes les lectures d'outil :
 *    1. une limite EXPLICITE, jamais implicite ;
 *    2. quand la limite est atteinte, la réponse de l'outil le DIT (`truncated: true` + une note en
 *       français qui indique quoi faire) — jamais de troncature muette ;
 *    3. on garde le bout RÉCENT de la fenêtre, pas le bout ancien.
 *
 *  Ce module n'importe que `@supabase/supabase-js` (types) : il doit rester exécutable par `tsx` depuis
 *  `coach/`, donc pas d'alias `@/` et aucun import Next/React. */

/** Plafonds explicites. Volontairement bien en dessous des 1000 lignes de PostgREST : le but n'est pas
 *  de frôler le plafond du serveur, c'est de tenir un contexte de modèle lisible et bon marché. */
export const LIMITS = {
  /** activités renvoyées par `query_activities` (une ligne ≈ 20 tokens) */
  activities: 300,
  /** jours de `daily_metrics` renvoyés jour par jour ; au-delà, la fenêtre est resserrée */
  dailyMetricsDays: 400,
  /** séances planifiées renvoyées par `read_plan` */
  plannedSessions: 200,
  /** horizon maximal accepté pour une lecture du plan (au-delà : borné + signalé) */
  planHorizonDays: 365,
  /** tours de conversation réinjectés dans le prompt (les plus RÉCENTS) */
  chatHistoryTurns: 150,
  /** lignes de `daily_metrics` lues pour amorcer une simulation (90 j d'historique suffisent) */
  simulationSeedDays: 120,
} as const;

/** Ce que tout outil de lecture ajoute à sa réponse quand il a dû borner. `truncated: false` reste
 *  présent dans la réponse : dire explicitement « rien n'a été coupé » vaut mieux qu'un champ absent,
 *  que le modèle interpréterait comme « je n'en sais rien ». */
export type Truncation = {
  truncated: boolean;
  /** message en français destiné AU MODÈLE : ce qui a été coupé et comment obtenir le reste */
  note?: string;
  /** fenêtre réellement lue, quand elle diffère de celle demandée */
  window_applied?: { since: string; until: string };
};

export const NOT_TRUNCATED: Truncation = { truncated: false };

/** Fusionne plusieurs troncatures (fenêtre resserrée ET débordement de lignes, par exemple) en un seul
 *  drapeau + une seule note : le modèle doit lire UN message clair, pas trois champs à recouper. */
export function mergeTruncation(...parts: Truncation[]): Truncation {
  const hit = parts.filter((p) => p.truncated);
  if (!hit.length) return NOT_TRUNCATED;
  const window_applied = hit.find((p) => p.window_applied)?.window_applied;
  return {
    truncated: true,
    note: hit.map((p) => p.note).filter(Boolean).join(" "),
    ...(window_applied ? { window_applied } : {}),
  };
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(v: unknown): v is string {
  return typeof v === "string" && ISO_RE.test(v) && !Number.isNaN(Date.parse(v + "T00:00:00Z"));
}

/** Nombre de jours inclusifs entre deux dates ISO (`2026-01-01` → `2026-01-01` = 1). */
export function daysBetween(since: string, until: string): number {
  const a = Date.parse(since + "T00:00:00Z");
  const b = Date.parse(until + "T00:00:00Z");
  return Math.floor((b - a) / 86_400_000) + 1;
}

/** Décale une date ISO de `n` jours (n négatif = vers le passé). */
export function shiftDate(date: string, n: number): string {
  return new Date(Date.parse(date + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);
}

/** Resserre une fenêtre de dates sur ses `maxDays` derniers jours, et dit ce qu'elle a fait.
 *  On garde le bout RÉCENT : sur « 2022 → 2026 », les données proches de la question sont celles de
 *  2026. Le modèle reçoit la consigne de découper sa fenêtre s'il lui faut aussi le début. */
export function clampWindow(
  since: string, until: string, maxDays: number, what: string,
): { since: string; until: string } & Truncation {
  const span = daysBetween(since, until);
  if (span <= maxDays) return { since, until, truncated: false };
  const clamped = shiftDate(until, -(maxDays - 1));
  return {
    since: clamped,
    until,
    truncated: true,
    window_applied: { since: clamped, until },
    note:
      `Fenêtre demandée trop large (${span} jours de ${what}, plafond ${maxDays}). Seuls les ${maxDays} ` +
      `derniers jours ont été lus (${clamped} → ${until}) ; la partie ANTÉRIEURE à ${clamped} n'est PAS ` +
      `dans cette réponse. Ne conclus rien sur cette partie manquante : refais un appel sur une fenêtre ` +
      `plus étroite pour la couvrir (par exemple une période à la fois quand tu compares deux périodes).`,
  };
}

/** Exécute une requête PostgREST en demandant `limit + 1` lignes pour DÉTECTER le débordement, puis
 *  renvoie au plus `limit` lignes accompagnées du drapeau. Sans le `+1` on ne peut pas distinguer
 *  « exactement limit lignes existent » de « il y en a davantage », et c'est précisément cette
 *  ambiguïté qui rend la troncature muette.
 *
 *  `newestFirst` : quand la requête est ordonnée du plus récent au plus ancien pour que la troncature
 *  morde sur le bout ANCIEN, on remet les lignes en ordre chronologique avant de les rendre. */
export async function fetchBounded<T = Record<string, unknown>>(
  query: PostgrestLike<T>, limit: number, opts: { what: string; newestFirst?: boolean } ,
): Promise<{ rows: T[]; truncation: Truncation }> {
  const { data, error } = await query.limit(limit + 1);
  if (error) throw new Error(error.message);
  const all = (data ?? []) as T[];
  const overflow = all.length > limit;
  const rows = overflow ? all.slice(0, limit) : all;
  if (opts.newestFirst) rows.reverse();
  if (!overflow) return { rows, truncation: NOT_TRUNCATED };
  return {
    rows,
    truncation: {
      truncated: true,
      note:
        `Plus de ${limit} ${opts.what} correspondent à cette demande ; seules les ${limit} plus RÉCENTES ` +
        `sont renvoyées, les plus anciennes sont absentes. Dis-le à l'athlète si ça change ta réponse, ` +
        `et resserre ta fenêtre (dates plus proches, ou un sport à la fois) si tu as besoin du reste.`,
    },
  };
}

/** Le sous-ensemble du builder PostgREST dont `fetchBounded` a besoin — évite d'importer un type
 *  générique lourd de `@supabase/supabase-js` juste pour appeler `.limit()`. */
type PostgrestLike<T> = {
  limit: (n: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
};
