/** ALGORITHMIC coach briefing — builds the FULL briefing object WITHOUT any LLM call (0 token).
 *
 *  This is the "free mode" engine and the always-on foundation of the "AI mode" (which only re-voices
 *  three text fields on top — see coach-briefing.ts enrichBriefingWithLLM). It is a PURE function over the
 *  assembled context (web/src/lib/coach-context.ts assembleCoachContext) — no DB, no network — so every
 *  rule is deterministic and unit-testable (briefing-algo.test.ts). It returns the SAME object shape the
 *  old LLM produced (readiness, state_assessment, week_plan[], detailed_sessions[], event_targets[], why,
 *  flag, confidence) so coach-briefing.ts keeps writing coach_briefings + buildForwardPlanRows unchanged.
 *
 *  Philosophy (token economy): the coach's JUDGMENT here is encoded as thresholds + rules, not prose.
 *  The numeric constants below are population STARTING POINTS — calibrate later from the athlete's history
 *  (like the load.py coefficients). The athlete keeps the nuanced, persona-voiced experience via (a) the
 *  optional AI mode and (b) the always-available chat. */
import { dateMinusDays, daysBetween } from "./coach-context";
import { frWeekday } from "./briefing-shared";
import { splitByTag } from "./planning";

export type Readiness = "green" | "amber" | "red";
export type SystemTag = "easy" | "hard_aerobic" | "hard_neuromuscular" | "hard_structural" | "recovery" | "rest";

export type WeekDay = {
  day_offset: number;
  sport_code: string;
  system_tag: SystemTag;
  focus: string;
  target_load: number;
  is_key: boolean;
  anchors_event_ref: string | null;
};
export type DetailedSession = {
  day_offset: number;
  title: string;
  description: string;
  intensity_zone: string | null;
  target_hr_low: number | null;
  target_hr_high: number | null;
  target_duration_min: number;
  target_aerobic_load: number;
  target_aerobic_min: number;
  target_aerobic_max: number;
  target_neuromuscular_load: number;
  target_neuromuscular_min: number;
  target_neuromuscular_max: number;
};
export type AlgoBriefing = {
  readiness: Readiness;
  state_assessment: string;
  week_plan: WeekDay[];
  detailed_sessions: DetailedSession[];
  event_targets: any[];
  why: string;
  flag: string | null;
  confidence: number;
};

// ── Calibrable constants (population starting points) ───────────────────────────────────────────
/** Readiness thresholds (TSB / per-channel TSB / ACWR / Garmin readiness). */
const R = {
  acwr_red: 1.5,
  tsb_neuro_red: -15,
  tsb_red: -20,
  readiness_red: 25,
  tsb_neuro_amber: -5,
  tsb_amber: -10,
  readiness_amber: 50,
  resting_hr_amber_delta: 5, // bpm above the athlete's baseline resting HR
  heat_acclim_low: 50,       // % — below this, a hot forecast day warrants caution
};
/** A day counts as "hard" (for spacing) at/above this realised load. */
const HARD_LOAD = 70;
/** Per-tag base target load (points ≈ 1 h at threshold) before the CTL scale. */
const BASE_LOAD: Record<SystemTag, number> = {
  rest: 0, recovery: 22, easy: 45, hard_aerobic: 95, hard_neuromuscular: 75, hard_structural: 85,
};
/** Per-tag base session duration (min) before the CTL scale. */
const BASE_MIN: Record<SystemTag, number> = {
  rest: 0, recovery: 30, easy: 60, hard_aerobic: 55, hard_neuromuscular: 50, hard_structural: 55,
};
/** HR zone (by name in hr_zones) the session should hold — null = not HR-piloted (force/neuro). */
const ZONE_BY_TAG: Record<SystemTag, string | null> = {
  easy: "Z2", recovery: "Z2", hard_aerobic: "Z4",
  hard_neuromuscular: null, hard_structural: null, rest: null,
};
const CHANNEL_BAND = 0.4; // ±40 % bounds around each channel target (verdict band)
const TAPER_DAYS = 2;     // days before a key event we lighten the load

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round = (n: number) => Math.round(n);

/** Deterministic, content-stable variant index (no Math.random → no flicker). Mirror of coach-voice.ts. */
function pickIndex(seed: string, n: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return n > 0 ? h % n : 0;
}
const pick = <T>(arr: T[], seed: string): T => arr[pickIndex(seed, arr.length)];

// ── Readiness (green / amber / red) ─────────────────────────────────────────────────────────────
export function computeReadiness(ctx: any): Readiness {
  const m = ctx.fitness_model_latest ?? null;
  const rec = ctx.recovery_today ?? null;
  const tsb = m?.tsb, tsbN = m?.tsb_neuromuscular, acwr = m?.acwr;
  const tr = rec?.training_readiness;

  // RED — clear gates for recovery/rest.
  if (acwr != null && acwr > R.acwr_red) return "red";
  if (tsbN != null && tsbN < R.tsb_neuro_red) return "red";
  if (tsb != null && tsb < R.tsb_red) return "red";
  if (tr != null && tr < R.readiness_red) return "red";

  // AMBER — caution, keep it easy/technical.
  if (tsbN != null && tsbN < R.tsb_neuro_amber) return "amber";
  if (tsb != null && tsb < R.tsb_amber) return "amber";
  if (rec && rec.available === false) return "amber"; // no Garmin signal this morning → don't push blind
  if (tr != null && tr < R.readiness_amber) return "amber";
  if (rec?.hrv_status && ["low", "poor", "unbalanced"].includes(String(rec.hrv_status))) return "amber";
  const baseRhr = ctx.thresholds?.resting_hr;
  if (rec?.resting_hr != null && baseRhr != null && rec.resting_hr > baseRhr + R.resting_hr_amber_delta) return "amber";
  if (heatRisk(ctx)) return "amber";

  return "green";
}

/** A hot forecast day soon + low heat acclimation → read HR cautiously today. */
function heatRisk(ctx: any): boolean {
  const acclim = ctx.environment?.heat_acclimation_pct;
  const soonHot = (ctx.weather ?? []).slice(0, 3).some((w: any) => w?.hot);
  return !!soonHot && acclim != null && acclim < R.heat_acclim_low;
}

// ── Recent-load helpers (spacing of hard days) ──────────────────────────────────────────────────
function lastHard(ctx: any): { daysSince: number; system: "aerobic" | "neuro" | null } {
  const acts = (ctx.recent_activities_14d ?? []).filter((a: any) => Number(a.load || 0) >= HARD_LOAD);
  if (!acts.length) return { daysSince: 99, system: null };
  // recent_activities_14d is newest-first; the first hard one is the most recent.
  const a = acts[0];
  const aero = Number(a.aerobic || 0), neu = Number(a.neuro || 0);
  const neuroFrac = aero + neu > 0 ? neu / (aero + neu) : 0;
  return { daysSince: Math.max(0, daysBetween(a.date, ctx.today)), system: neuroFrac > 0.4 ? "neuro" : "aerobic" };
}

const systemFamily = (tag: SystemTag): "aerobic" | "neuro" | null =>
  tag === "hard_aerobic" ? "aerobic" : tag === "hard_neuromuscular" || tag === "hard_structural" ? "neuro" : null;
const isHard = (tag: SystemTag) => tag.startsWith("hard");
const altHard = (lastSys: "aerobic" | "neuro" | null): SystemTag =>
  lastSys === "aerobic" ? "hard_neuromuscular" : "hard_aerobic";

// ── Per-day target load + channel split ─────────────────────────────────────────────────────────
export function targetLoadFor(tag: SystemTag, ctx: any): number {
  if (tag === "rest") return 0;
  const ctl = ctx.fitness_model_latest?.ctl;
  const scale = ctl != null && ctl > 0 ? clamp(ctl / 45, 0.7, 1.4) : 1;
  return round(BASE_LOAD[tag] * scale);
}
function durationFor(tag: SystemTag, ctx: any): number {
  if (tag === "rest") return 0;
  const ctl = ctx.fitness_model_latest?.ctl;
  const scale = ctl != null && ctl > 0 ? clamp(ctl / 45, 0.8, 1.3) : 1;
  return round(BASE_MIN[tag] * scale);
}

function zoneBand(ctx: any, zoneName: string | null): { low: number; high: number } | null {
  if (!zoneName) return null;
  const z = (ctx.hr_zones?.zones ?? []).find((zz: any) => zz.zone === zoneName);
  return z && z.low_bpm != null && z.high_bpm != null ? { low: z.low_bpm, high: z.high_bpm } : null;
}

// ── Declared events / pinned sessions as fixed anchors ──────────────────────────────────────────
type Anchor = { sport: string | null; system_tag: SystemTag; target_load: number; is_key: boolean; ref: string | null; kind: "event" | "pinned"; title: string | null };

function anchorsByOffset(ctx: any): Map<number, Anchor> {
  const map = new Map<number, Anchor>();
  for (const e of ctx.declared_events ?? []) {
    if (e.day_offset < 0 || e.day_offset > 6) continue;
    const aero = Number(e.estimated_load?.aerobic || 0), neu = Number(e.estimated_load?.neuro || 0);
    const total = aero + neu;
    const tag: SystemTag = neu > aero ? "hard_neuromuscular" : "hard_aerobic";
    map.set(e.day_offset, { sport: e.sport ?? null, system_tag: tag, target_load: round(total) || BASE_LOAD.hard_aerobic, is_key: !!e.is_key, ref: e.ref ?? null, kind: "event", title: e.title ?? null });
  }
  for (const p of ctx.pinned_sessions ?? []) {
    if (p.day_offset < 0 || p.day_offset > 6 || map.has(p.day_offset)) continue;
    map.set(p.day_offset, { sport: p.sport ?? null, system_tag: (p.system_tag as SystemTag) ?? "easy", target_load: Number(p.target_load) || BASE_LOAD.easy, is_key: !!p.is_key, ref: p.ref ?? null, kind: "pinned", title: p.title ?? null });
  }
  return map;
}

const truncate = (s: string, n = 48) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
/** The week-plan focus line for an anchored day = the anchor's REAL title (the accepted/declared session),
 *  never a generic template — so the coach card, the plan strip and the agenda all name the same session. */
function anchorFocus(a: Anchor): string {
  return a.title ? truncate(a.title) : focusFor(a.system_tag, a.kind === "event" ? "événement" : null);
}

// ── The 7-day plan ──────────────────────────────────────────────────────────────────────────────
export function buildWeekPlan(ctx: any, readiness: Readiness, anchors: Map<number, Anchor> = anchorsByOffset(ctx)): WeekDay[] {
  const noHard = new Set<string>((ctx.athlete_constraints?.no_hard_days ?? []).map((d: string) => String(d).toLowerCase()));
  const fav = (ctx.favourite_sports ?? [])[0] ?? "running";
  const keyEventOffsets = new Set<number>(
    (ctx.declared_events ?? []).filter((e: any) => e.is_key && e.day_offset >= 0 && e.day_offset <= 6).map((e: any) => e.day_offset),
  );

  const { daysSince, system } = lastHard(ctx);
  let sinceHard = daysSince;
  let lastSys = system;
  let hardCount = 0;
  let restPlaced = false;

  const days: WeekDay[] = [];
  for (let off = 0; off < 7; off++) {
    const date = dateMinusDays(ctx.today, -off);
    const wd = frWeekday(date);

    // 1) Fixed anchor (declared event / pinned session) — never overwrite its day.
    const anchor = anchors.get(off);
    if (anchor) {
      days.push({
        day_offset: off, sport_code: anchor.sport ?? fav, system_tag: anchor.system_tag,
        focus: anchorFocus(anchor),
        target_load: anchor.target_load, is_key: anchor.is_key,
        anchors_event_ref: anchor.kind === "event" ? anchor.ref : null,
      });
      if (isHard(anchor.system_tag)) { sinceHard = 0; lastSys = systemFamily(anchor.system_tag); hardCount++; } else { sinceHard++; }
      continue;
    }

    const dayBeforeKey = keyEventOffsets.has(off + 1); // taper the eve of a key event
    let tag: SystemTag;

    if (off === 0) {
      // Today is gated by this morning's readiness.
      if (readiness === "red") tag = "rest";
      else if (readiness === "amber") tag = "recovery";
      else tag = canHard(wd, noHard, sinceHard, hardCount, dayBeforeKey) ? altHard(lastSys) : "easy";
    } else {
      // Future days: assume recovery proceeds; still respect spacing + constraints + taper.
      if (dayBeforeKey) tag = "easy";
      else if (canHard(wd, noHard, sinceHard, hardCount, false)) tag = altHard(lastSys);
      else if (!restPlaced && sinceHard >= 1 && off >= 4) tag = "rest"; // one rest day later in the week
      else tag = sinceHard === 0 ? "recovery" : "easy"; // recovery the day after a hard day
    }

    days.push({
      day_offset: off, sport_code: fav, system_tag: tag, focus: focusFor(tag, null),
      target_load: targetLoadFor(tag, ctx), is_key: false, anchors_event_ref: null,
    });

    if (isHard(tag)) { sinceHard = 0; lastSys = systemFamily(tag); hardCount++; }
    else { sinceHard++; if (tag === "rest") restPlaced = true; }
  }
  return days;
}

/** A hard day is allowed iff: not a no-hard weekday, ≥2 days since the last hard, <2 hard so far this
 *  week (80/20), and it isn't the eve of a key event. */
function canHard(wd: string, noHard: Set<string>, sinceHard: number, hardCount: number, dayBeforeKey: boolean): boolean {
  return !noHard.has(wd) && sinceHard >= 2 && hardCount < 2 && !dayBeforeKey;
}

function focusFor(tag: SystemTag, eventNote: string | null): string {
  if (eventNote) return "Événement prévu — on planifie autour";
  return {
    rest: "Repos complet",
    recovery: "Récupération active",
    easy: "Endurance facile",
    hard_aerobic: "Travail au seuil",
    hard_neuromuscular: "Côtes / force",
    hard_structural: "Renforcement / dénivelé",
  }[tag];
}

// ── Detailed session(s): today + the week's key quality session ─────────────────────────────────
const TITLE_BY_TAG: Record<SystemTag, string> = {
  rest: "Repos", recovery: "Récupération", easy: "Endurance facile",
  hard_aerobic: "Séance seuil", hard_neuromuscular: "Côtes / force", hard_structural: "Renforcement",
};

function detailedFor(day: WeekDay, ctx: any, anchor: Anchor | null = null): DetailedSession {
  const tag = day.system_tag;
  const zoneName = ZONE_BY_TAG[tag];
  const band = zoneBand(ctx, zoneName);
  const dur = durationFor(tag, ctx);
  const split = splitByTag(day.target_load, tag);
  const bandTxt = band && zoneName ? ` en ${zoneName} (${band.low}-${band.high} bpm)` : "";
  const durTxt = dur > 0 ? ` ~${dur} min` : "";
  const tagDescription = {
    rest: "Journée de repos : laisse le corps assimiler, ce sont ces jours-là qui consolident la forme.",
    recovery: `Sortie très facile${bandTxt}${durTxt}, juste pour faire tourner les jambes sans ajouter de fatigue.`,
    easy: `Rythme confortable${bandTxt}${durTxt} : tu dois pouvoir tenir une conversation.`,
    hard_aerobic: `Après échauffement, travaille au seuil${bandTxt}, ~${Math.max(20, round(dur * 0.6))} min effectifs, puis retour au calme.`,
    hard_neuromuscular: `Travail de côtes / force${durTxt} : l'intensité est musculaire, la FC compte moins ici. Soigne tes appuis.`,
    hard_structural: `Renforcement / dénivelé${durTxt} : qualité du mouvement avant la quantité.`,
  }[tag];
  // An anchored day (declared event / chat-accepted pinned session) keeps its REAL title; the event note
  // explains it's a planned fixture, a pinned session keeps the tag's how-to guidance (zone/bpm).
  const description = anchor?.kind === "event"
    ? "Ton événement du jour — la semaine est planifiée autour. Garde l'énergie pour lui."
    : tagDescription;
  return {
    day_offset: day.day_offset,
    title: anchor?.title ?? TITLE_BY_TAG[tag],
    description,
    intensity_zone: zoneName,
    target_hr_low: band?.low ?? null,
    target_hr_high: band?.high ?? null,
    target_duration_min: dur,
    target_aerobic_load: round(split.aerobic),
    target_aerobic_min: round(split.aerobic * (1 - CHANNEL_BAND)),
    target_aerobic_max: round(split.aerobic * (1 + CHANNEL_BAND)),
    target_neuromuscular_load: round(split.neuro),
    target_neuromuscular_min: round(split.neuro * (1 - CHANNEL_BAND)),
    target_neuromuscular_max: round(split.neuro * (1 + CHANNEL_BAND)),
  };
}

// ── Event freshness targets (the eve-of-event TSB to aim for) ───────────────────────────────────
function buildEventTargets(ctx: any): any[] {
  return (ctx.declared_events ?? [])
    .filter((e: any) => e.day_offset >= 1 && e.day_offset <= 6)
    .map((e: any) => ({
      event_ref: e.ref,
      day_before_offset: e.day_offset - 1,
      target_tsb: e.is_key ? 12 : 5,
      target_tsb_aerobic: e.is_key ? 10 : 4,
      target_tsb_neuromuscular: e.is_key ? 8 : 3,
      rationale: e.is_key
        ? "Objectif prioritaire : jambes fraîches le jour J — on allège avant."
        : "Allègement léger la veille pour aborder l'événement en forme.",
    }));
}

// ── Templated narrative (neutral voice; AI mode re-voices these in persona) ─────────────────────
const WHY_BY_TAG: Record<SystemTag, string[]> = {
  rest: ["Repos aujourd'hui : ta récupération et ta fatigue l'imposent — c'est ça qui te fera progresser.", "On coupe aujourd'hui : laisser le corps encaisser vaut mieux que forcer."],
  recovery: ["Récup active aujourd'hui pour évacuer la fatigue sans ajouter de charge.", "Journée légère : on fait tourner les jambes, rien de plus."],
  easy: ["Séance facile aujourd'hui pour garder le moteur sans entamer ta fraîcheur.", "On reste sur du facile : c'est le socle aérobie qui paie sur la durée."],
  hard_aerobic: ["Forme au vert : on place une séance seuil pour faire progresser le moteur aérobie.", "Tu es frais — c'est le bon jour pour un vrai travail au seuil."],
  hard_neuromuscular: ["Tu es frais : séance de force / côtes pour muscler le neuromusculaire.", "Feu vert pour du dur : on cible la force et les appuis aujourd'hui."],
  hard_structural: ["Forme au vert : on en profite pour du renforcement structurel.", "Bon jour pour bosser le gainage et le dénivelé."],
};

function buildWhy(today: WeekDay, ctx: any, anchor: Anchor | null = null): string {
  if (anchor?.kind === "event") return `Ton événement du jour : ${anchor.title} — la semaine est calée autour.`;
  if (anchor?.kind === "pinned") return `Aujourd'hui, la séance que tu as validée : ${anchor.title}.`;
  return pick(WHY_BY_TAG[today.system_tag], ctx.today + ":why");
}

function tsbWord(tsb: number | null | undefined): string {
  if (tsb == null) return "stable";
  if (tsb > 8) return "fraîche";
  if (tsb < -8) return "entamée";
  return "stable";
}

function buildStateAssessment(ctx: any, readiness: Readiness, week: WeekDay[]): string {
  const m = ctx.fitness_model_latest ?? null;
  const rec = ctx.recovery_today ?? null;
  const tsb = m?.tsb;
  const hardN = week.filter((d) => isHard(d.system_tag)).length;
  const nextEvent = (ctx.declared_events ?? []).find((e: any) => e.day_offset >= 0 && e.day_offset <= 6) ?? null;

  const formeTxt = `Ta forme est ${tsbWord(tsb)}${tsb != null ? ` (TSB ${tsb > 0 ? "+" : ""}${round(tsb)})` : ""}.`;
  const recTxt = rec && rec.available === false
    ? "Pas de données Garmin ce matin — j'avance sans la récup du jour."
    : readiness === "red"
      ? "Les signaux de fatigue sont là : priorité à la récupération."
      : readiness === "amber"
        ? "Quelques signaux à surveiller : on reste prudent aujourd'hui."
        : "Les voyants de récupération sont au vert.";
  const weekTxt = nextEvent
    ? `Cette semaine : ${hardN} séance(s) de qualité, organisées autour de « ${nextEvent.title} ».`
    : `Cette semaine : ${hardN} séance(s) de qualité, le reste en endurance pour construire le fond.`;
  return `${formeTxt} ${recTxt} ${weekTxt}`;
}

function buildFlag(ctx: any, readiness: Readiness): string | null {
  const rec = ctx.recovery_today ?? null;
  const m = ctx.fitness_model_latest ?? null;
  if (rec && rec.available === false) return "Données Garmin du matin absentes — rafraîchis Garmin pour une lecture fiable de ta récupération.";
  if (m?.acwr != null && m.acwr > R.acwr_red) return `Charge aiguë élevée (ACWR ${round(m.acwr * 100) / 100}) : risque de surcharge, prudence sur l'intensité.`;
  if (m?.tsb_neuromuscular != null && m.tsb_neuromuscular < R.tsb_neuro_red) return "Fatigue neuromusculaire marquée (descentes / force) — protège les jambes même si la récup cardio semble bonne.";
  if (heatRisk(ctx)) return "Chaleur annoncée + acclimatation faible : la FC montera pour le même effort, pilote à la sensation.";
  return null;
}

/** Confidence heuristic: more data = more confident. */
function buildConfidence(ctx: any): number {
  let c = 0.5;
  if (ctx.fitness_model_latest?.ctl != null) c += 0.25;
  if (ctx.recovery_today?.available) c += 0.15;
  if ((ctx.recent_activities_14d ?? []).length >= 5) c += 0.1;
  return Math.round(clamp(c, 0, 1) * 100) / 100;
}

// ── Assemble the full briefing ──────────────────────────────────────────────────────────────────
export function buildAlgorithmicBriefing(ctx: any): AlgoBriefing {
  const readiness = computeReadiness(ctx);
  const anchors = anchorsByOffset(ctx);
  const week_plan = buildWeekPlan(ctx, readiness, anchors);

  const today = week_plan[0];
  const todayAnchor = anchors.get(0) ?? null;
  const detailed: DetailedSession[] = [detailedFor(today, ctx, todayAnchor)];
  // The week's key quality session (first hard day after today that isn't an anchored event/pinned day) —
  // gives the séance page a second detailed day. Anchored days are handed off (materializer skips them).
  const keyDay = week_plan.find((d) => d.day_offset > 0 && isHard(d.system_tag) && !d.anchors_event_ref && !anchors.has(d.day_offset));
  if (keyDay) detailed.push(detailedFor(keyDay, ctx, null));

  return {
    readiness,
    state_assessment: buildStateAssessment(ctx, readiness, week_plan),
    week_plan,
    detailed_sessions: detailed,
    event_targets: buildEventTargets(ctx),
    why: buildWhy(today, ctx, todayAnchor),
    flag: buildFlag(ctx, readiness),
    confidence: buildConfidence(ctx),
  };
}
