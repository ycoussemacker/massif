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
/** Readiness thresholds (TSB / per-channel TSB / ACWR / Garmin readiness). Tuned so a genuinely
 *  borderline morning (Garmin training-readiness "moderate" ~56, slightly negative TSB, mild lingering
 *  neuromuscular debt) reads AMBER (keep it easy/technical) rather than GREEN — matching a coach's call,
 *  especially in the days before a key event. Still population starting points; calibrate from history. */
const R = {
  acwr_red: 1.5,
  tsb_neuro_red: -15,
  tsb_red: -20,
  readiness_red: 25,
  tsb_neuro_amber: -4,    // lingering structural/tendon debt (slower τ) → caution
  tsb_amber: -8,
  readiness_amber: 60,    // Garmin "moderate" readiness (50–75) → caution, don't greenlight a hard day
  resting_hr_amber_delta: 5, // bpm above the athlete's baseline resting HR
  heat_acclim_low: 50,       // % — below this, a hot forecast day warrants caution
  acwr_amber: 1.3,        // ACWR vigilance band — armed ONLY alongside a rising absolute load + non-negative TSB
  acwr_neuro_amber: 1.3,  // per-channel neuromuscular ACWR vigilance (atl_neuro / ctl_neuro)
  ctl_neuro_floor: 12,    // min neuromuscular CTL to trust a neuro ACWR ratio (else low-confidence → ignored)
};
/** A day counts as "hard" (for spacing) at/above this realised load. */
const HARD_LOAD = 70;
/** Per-tag target load (points ≈ 1 h at threshold). Calibrated to the athlete's REAL sessions — a
 *  threshold run (3×6 min Z4 ~10 km) scores ~60-75, an easy run ~40-50 — NOT scaled up by CTL (a quality
 *  session is a quality session, whatever the fitness). Population values; refine from history later. */
const BASE_LOAD: Record<SystemTag, number> = {
  rest: 0, recovery: 22, easy: 42, hard_aerobic: 72, hard_neuromuscular: 62, hard_structural: 68,
};
/** Per-tag session duration (min). */
const BASE_MIN: Record<SystemTag, number> = {
  rest: 0, recovery: 30, easy: 60, hard_aerobic: 55, hard_neuromuscular: 50, hard_structural: 55,
};
/** HR zone (by name in hr_zones) the session should hold — null = not HR-piloted (force/neuro). */
const ZONE_BY_TAG: Record<SystemTag, string | null> = {
  easy: "Z2", recovery: "Z2", hard_aerobic: "Z4",
  hard_neuromuscular: null, hard_structural: null, rest: null,
};
const CHANNEL_BAND = 0.4; // ±40 % bounds around each channel target (verdict band)

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round = (n: number) => Math.round(n);

// ── Périodisation : phases + rampe de CTL + décharges (Q15/Q17 — MODELE_ENTRAINEMENT §5.2) ────────
/** Phases dérivées de la date de l'objectif PRINCIPAL (rank 1 daté). Bornes rétro-comptées depuis le
 *  jour J, donc un horizon court « compresse » naturellement (objectif à 30 j → on est déjà en peak).
 *  Sans objectif daté → "none" : le moteur se comporte exactement comme avant (inertie garantie). */
export type Phase = "base" | "build" | "peak" | "taper" | "none";
export type PhaseState = {
  phase: Phase;
  daysTo: number | null;   // jours jusqu'à l'objectif principal (null si non daté)
  weeksTo: number | null;  // ceil(daysTo/7) — S−N
  isDeload: boolean;       // semaine de décharge (Q17 : 3:1 en base, 2:1 en build)
  cycleLen: 3 | 4 | null;  // longueur du mésocycle (3 = 2:1 build, 4 = 3:1 base)
  weekInCycle: number | null; // 1..cycleLen (cycleLen = la semaine de décharge)
  goalTitle: string | null;
};

export const PHASE_PARAMS = {
  taper_days: 14,        // fenêtre d'affûtage objectif principal (alignée sur taperState)
  peak_weeks_to: 5,      // peak = S−3..S−5 (15-35 j ; table §5.2 : 1-4 sem)
  build_weeks_to: 13,    // build = S−6..S−13 (36-91 j ; table : 3-8 sem) ; au-delà = base
  deload_factor: 0.65,   // décharge : −35 % de volume (bande sourcée −30/−50 %), intensité conservée
  peak_factor: 0.85,     // peak : volume ↓, intensité-clé maintenue
  ramp_ctl_per_week: 4,  // cible de montée du CTL en semaine de charge (+3-5/sem aéro — point de départ)
  ramp_scale_max: 1.35,  // borne : ne jamais gonfler un jour easy de plus de +35 %
  base_hard_cap: 1,      // base = volume ↑, intensité basse → 1 seule séance dure générée / sem
};
/** Facteur EWMA τ=42 : ΔCTL_semaine = (L_quotidien − CTL)·(1−e^(−7/42)) ⇒ L = CTL + 6.51·ΔCTL. */
const CTL_WEEKLY_GAIN_FACTOR = 1 / (1 - Math.exp(-7 / 42)); // ≈ 6.51

export function phaseFromDaysTo(daysTo: number | null | undefined, goalTitle?: string | null): PhaseState {
  const none: PhaseState = { phase: "none", daysTo: null, weeksTo: null, isDeload: false, cycleLen: null, weekInCycle: null, goalTitle: null };
  if (daysTo == null || daysTo < 0) return none;
  const weeksTo = Math.max(1, Math.ceil(daysTo / 7));
  const common = { daysTo, weeksTo, goalTitle: goalTitle ?? null };
  if (daysTo <= PHASE_PARAMS.taper_days)
    return { ...common, phase: "taper", isDeload: false, cycleLen: null, weekInCycle: null };
  if (weeksTo <= PHASE_PARAMS.peak_weeks_to)
    return { ...common, phase: "peak", isDeload: false, cycleLen: null, weekInCycle: null };
  // Mésocycles ANCRÉS SUR LA FIN de la phase : la dernière semaine avant la phase suivante est une
  // décharge (on encaisse le bloc avant d'affûter/intensifier), puis on rétro-compte 2:1 ou 3:1.
  if (weeksTo <= PHASE_PARAMS.build_weeks_to) {
    const pos = weeksTo - (PHASE_PARAMS.peak_weeks_to + 1); // 0 = dernière semaine de build
    return { ...common, phase: "build", cycleLen: 3, isDeload: pos % 3 === 0, weekInCycle: 3 - (pos % 3) };
  }
  const pos = weeksTo - (PHASE_PARAMS.build_weeks_to + 1); // 0 = dernière semaine de base
  return { ...common, phase: "base", cycleLen: 4, isDeload: pos % 4 === 0, weekInCycle: 4 - (pos % 4) };
}

/** PhaseState depuis le contexte assemblé : l'objectif PRINCIPAL (rank 1) daté pilote les phases.
 *  (Les objectifs secondaires gardent leur mini-affûtage via taperState, mais ne périodisent pas.) */
export function derivePhaseState(ctx: any): PhaseState {
  const g = (ctx?.goals ?? []).find((x: any) => x?.rank === 1 && x?.days_to != null && x.days_to >= 0);
  return phaseFromDaysTo(g?.days_to ?? null, g?.title ?? null);
}

export const PHASE_FR: Record<Phase, string> = {
  base: "base", build: "build", peak: "pré-compétition", taper: "affûtage", none: "",
};

// ── Fenêtres de contrainte (Upgrade 10) — la vraie vie re-cadre les phases ──────────────────────
/** Période déclarée par l'athlète (table training_windows) : déplacement, terrain plat, temps réduit…
 *  Le plan s'y adapte : décharge calendaire REPORTÉE dessus, D+ chargé AVANT une fenêtre sans montagne,
 *  séances adaptées PENDANT (qualité → seuil sur plat, volume réduit). */
export type TrainingWindow = {
  id?: string;
  starts_on: string;
  ends_on: string;
  label: string;
  effect: "auto" | "deload" | "maintain" | "charge";
  no_mountains?: boolean | null;
  limited_hills?: boolean | null;
  reduced_volume?: boolean | null;
};
export type WindowEffect = "deload" | "maintain" | "charge";

export const WINDOW_PARAMS = {
  deload_snap_days: 21,   // une fenêtre décharge qui démarre d'ici ≤ N j ABSORBE la décharge calendaire (on charge avant)
  post_deload_grace_d: 7, // décharge calendaire ≤ N j après une fenêtre décharge → supprimée (déjà encaissé)
  auto_deload_min_d: 5,   // effet auto : capacité réduite ET ≥ N j → décharge, sinon entretien
  maintain_factor: 0.85,  // entretien : volume légèrement réduit, pas de rampe
};

/** Effet résolu d'une fenêtre : l'intention explicite gagne ; `auto` = décharge si la capacité est
 *  réduite (terrain/temps) sur une période assez longue pour encaisser, sinon simple entretien. */
export function resolveWindowEffect(w: TrainingWindow): WindowEffect {
  if (w.effect && w.effect !== "auto") return w.effect;
  const constrained = !!(w.no_mountains || w.limited_hills || w.reduced_volume);
  const days = daysBetween(w.starts_on, w.ends_on) + 1;
  return constrained && days >= WINDOW_PARAMS.auto_deload_min_d ? "deload" : "maintain";
}

const flatTerrain = (w: TrainingWindow | null): boolean => !!(w && (w.no_mountains || w.limited_hills));

/** Phase EFFECTIVE = phase calendaire (objectif) ajustée par les fenêtres de contrainte :
 *  - aujourd'hui DANS une fenêtre → son effet s'applique (la fenêtre prime sur le calendrier) ;
 *  - une fenêtre décharge démarre d'ici ≤ deload_snap_days → la décharge calendaire de cette semaine
 *    est REPORTÉE dessus (deloadMovedTo) : on charge avant, on encaisse pendant ;
 *  - décharge calendaire juste APRÈS une fenêtre décharge → supprimée (on vient d'encaisser). */
export type EffectivePhase = PhaseState & {
  window: { label: string; effect: WindowEffect; flat: boolean } | null;
  deloadMovedTo: string | null;
};
export function effectivePhase(ctx: any): EffectivePhase {
  const cal = derivePhaseState(ctx);
  const wins = (ctx?.training_windows ?? []) as TrainingWindow[];
  const today = ctx?.today as string;
  const todayWin = wins.find((w) => w.starts_on <= today && today <= w.ends_on) ?? null;

  let st: PhaseState = cal;
  let deloadMovedTo: string | null = null;
  if (cal.isDeload && !todayWin) {
    const upcoming = wins.find((w) =>
      w.starts_on > today && daysBetween(today, w.starts_on) <= WINDOW_PARAMS.deload_snap_days &&
      resolveWindowEffect(w) === "deload");
    const justAfter = wins.find((w) =>
      w.ends_on < today && daysBetween(w.ends_on, today) <= WINDOW_PARAMS.post_deload_grace_d &&
      resolveWindowEffect(w) === "deload");
    if (upcoming) { st = { ...cal, isDeload: false }; deloadMovedTo = upcoming.label; }
    else if (justAfter) st = { ...cal, isDeload: false };
  }
  return {
    ...st,
    window: todayWin ? { label: todayWin.label, effect: resolveWindowEffect(todayWin), flat: flatTerrain(todayWin) } : null,
    deloadMovedTo,
  };
}

/** Rampe de charge (Q15) — UNIQUEMENT en semaine de charge base/build : on vise +ramp_ctl_per_week de
 *  CTL en gonflant les jours EASY générés (le volume est le levier ; une séance de qualité reste une
 *  séance de qualité). Bornée (≤ +35 %/jour easy), inerte sans CTL connu, jamais à la baisse (les
 *  baisses passent par décharge/peak/taper), et jamais si la semaine dépasse déjà la cible (grosses
 *  ancres). Mutation en place des jours easy non ancrés. */
function applyRampTarget(days: WeekDay[], ctx: any, phase: PhaseState, anchors: Map<number, Anchor>): void {
  if ((phase.phase !== "base" && phase.phase !== "build") || phase.isDeload) return;
  const ctl = ctx.fitness_model_latest?.ctl;
  if (ctl == null) return;
  // L_quotidien = CTL + 6.51·ΔCTL_cible (dérivation EWMA ci-dessus) → cible hebdo = 7·L_quotidien.
  const weeklyTarget = 7 * (Number(ctl) + CTL_WEEKLY_GAIN_FACTOR * PHASE_PARAMS.ramp_ctl_per_week);
  const total = days.reduce((s, d) => s + d.target_load, 0);
  if (total >= weeklyTarget) return;
  // Jamais de rampe sur un jour couvert par une fenêtre décharge/entretien (Upgrade 10) : la fenêtre
  // réduit délibérément le volume de CES jours, la rampe ne doit pas les regonfler.
  const wins = (ctx.training_windows ?? []) as TrainingWindow[];
  const inConstrainedWin = (off: number): boolean => {
    const date = dateMinusDays(ctx.today, -off);
    const w = wins.find((x) => x.starts_on <= date && date <= x.ends_on);
    return !!w && resolveWindowEffect(w) !== "charge";
  };
  const easies = days.filter((d) => d.system_tag === "easy" && !anchors.has(d.day_offset) && !inConstrainedWin(d.day_offset));
  const easySum = easies.reduce((s, d) => s + d.target_load, 0);
  if (easySum <= 0) return;
  const scale = clamp((weeklyTarget - (total - easySum)) / easySum, 1, PHASE_PARAMS.ramp_scale_max);
  for (const d of easies) d.target_load = round(d.target_load * scale);
}

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

  // ACWR vigilance (F5) — ORTHOGONAL + anti-flicker: only when the ratio is high AND the absolute load is
  // RISING AND TSB isn't already negative (else it's redundant with the TSB ambers above, or fires on noise).
  if (recentLoadRising(ctx)) {
    if (acwr != null && acwr > R.acwr_amber && tsb != null && tsb >= R.tsb_amber) return "amber";
    const ctlN = m?.ctl_neuromuscular, atlN = m?.atl_neuromuscular;
    if (ctlN != null && ctlN >= R.ctl_neuro_floor && atlN != null && tsbN != null
        && tsbN >= R.tsb_neuro_amber && atlN / ctlN > R.acwr_neuro_amber) return "amber";
  }

  return "green";
}

/** A hot forecast day soon + low heat acclimation → read HR cautiously today. */
function heatRisk(ctx: any): boolean {
  const acclim = ctx.environment?.heat_acclimation_pct;
  const soonHot = (ctx.weather ?? []).slice(0, 3).some((w: any) => w?.hot);
  return !!soonHot && acclim != null && acclim < R.heat_acclim_low;
}

/** Absolute load trending UP: last-7-d sum > prior-7-d sum (from daily_load_21d). Used to qualify the
 *  ACWR amber so it never fires on a high-but-stable or decaying ratio — the ACWR is a DESCRIPTIVE signal,
 *  not a deterministic gate (Impellizzeri 2020, Lolli 2019). Inert (false) without ≥14 d of daily load. */
function recentLoadRising(ctx: any): boolean {
  const dl = (ctx.daily_load_21d ?? []) as any[];
  if (dl.length < 14) return false;
  const sum = (arr: any[]) => arr.reduce((s, d) => s + Number(d?.load || 0), 0);
  return sum(dl.slice(-7)) > sum(dl.slice(-14, -7));
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

/** Sport of a GENERATED day (quick-win precursor to the discipline-profile layer J). The default put the
 *  SAME single sport on every day — so a rest/recovery/easy day showed the mountain-sport icon (🥾 rando).
 *  Instead: a REST day carries NO sport (no icon); easy & recovery run on the flat (a foot-sport athlete's
 *  base is running 🏃, not the mountain sport); quality/structural days carry the goal sport (⛰️ trail).
 *  Full per-day multi-sport (rotating renfo/vélo/escalade onto the right days) is the J layer. */
const FOOT_GOAL = new Set(["trail_running", "hiking", "running", "trail"]);
const baseSport = (goalSport: string): string => (FOOT_GOAL.has(goalSport) ? "running" : goalSport);
function sportForDay(tag: SystemTag, fav: string): string {
  if (tag === "rest") return "";                                   // rest → no sport (no icon)
  if (tag === "easy" || tag === "recovery") return baseSport(fav); // base endurance ≠ the mountain sport
  return fav;                                                      // quality / structural → the goal sport
}

// ── Per-day target load + channel split ─────────────────────────────────────────────────────────
/** Target load for a coach-prescribed day. PERSONALISED: the athlete's own per-session-type baseline
 *  (ctx.session_baselines, derived from ~90 d of their efforts) when it exists, else the population
 *  default BASE_LOAD. Not scaled by CTL (taper is applied separately in buildWeekPlan). */
export function targetLoadFor(tag: SystemTag, ctx?: any): number {
  if (tag === "rest") return 0;
  const personal = ctx?.session_baselines?.[tag];
  return typeof personal === "number" && personal > 0 ? personal : BASE_LOAD[tag];
}
function durationFor(tag: SystemTag): number {
  return BASE_MIN[tag];
}

/** Taper for GOALS only (not declared events — those are anchored and planned AROUND, never tapered for).
 *  Primary goal (rank 1) begins tapering up to 14 d out; secondary/other goals up to 7 d. Returns a
 *  volume factor (1 = full week, → 0.5 on the goal day) and how many hard days to still allow this week. */
function taperState(ctx: any): { active: boolean; factor: number; daysTo: number; hardCap: number; title: string } {
  let best: { daysTo: number; primary: boolean; title: string } | null = null;
  for (const g of (ctx.goals ?? [])) {
    if (g.days_to == null || g.days_to < 0) continue;
    const primary = g.rank === 1;
    const window = primary ? 14 : 7; // primary objective → longer, deeper taper
    if (g.days_to <= window && (!best || g.days_to < best.daysTo)) best = { daysTo: g.days_to, primary, title: g.title };
  }
  if (!best) return { active: false, factor: 1, daysTo: Infinity, hardCap: 2, title: "" };
  const win = best.primary ? 14 : 7;
  // EXPONENTIAL taper (Bosquet 2007, Mujika 2003): front-loaded volume cut held low, NOT a linear ramp.
  // factor ≈ 1.0 at the taper's start → ~0.5 on the goal day (−50 %, in the 41-60 % evidence band).
  const daysIn = win - best.daysTo;
  const factor = clamp(0.45 + 0.55 * Math.exp(-2.3 * daysIn / win), 0.5, 1);
  // hardCap = 1 (NOT 0): MAINTAIN intensity — keep ONE short, volume-scaled quality reminder through the
  // taper rather than killing all intensity near the goal. (The eccentric/neuro cut happens in buildWeekPlan.)
  return { active: true, factor, daysTo: best.daysTo, hardCap: 1, title: best.title };
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
  // Prefer the PRIMARY GOAL's sport for generated days — a trail-goal athlete shouldn't get an all-rando
  // week just because base-phase volume is logged as hiking. Fall back to the most-frequent sport, then
  // running. (Full multi-sport allocation — goal sport on key days + rotation on easy days — is the
  // discipline-profile layer J; this is the minimal quick-win.)
  const fav = ctx.primary_goal?.sport ?? (ctx.favourite_sports ?? [])[0] ?? "running";
  // Taper is driven by GOALS, never by declared events (events are anchored + planned around, not tapered for).
  const taper = taperState(ctx);
  // Périodisation (Q15/Q17) : la phase module les jours GÉNÉRÉS (jamais les ancres, jamais la readiness).
  // Priorités : affûtage actif (n'importe quel objectif ≤ fenêtre) > décharge/peak > semaine de charge.
  // La phase est l'EFFECTIVE (Upgrade 10) : les fenêtres de contrainte ont déjà déplacé la décharge.
  const phase = effectivePhase(ctx);
  const hardCap = taper.active ? taper.hardCap
    : phase.isDeload ? 1                                  // décharge : volume −35 %, UNE qualité conservée
    : phase.phase === "base" ? PHASE_PARAMS.base_hard_cap // base : volume ↑, intensité basse
    : 2;
  const loadMul = taper.active ? taper.factor
    : phase.isDeload ? PHASE_PARAMS.deload_factor
    : phase.phase === "peak" ? PHASE_PARAMS.peak_factor
    : 1;

  // Fenêtres de contrainte couvrant/encadrant la semaine du plan (Upgrade 10).
  const wins = (ctx.training_windows ?? []) as TrainingWindow[];
  const winAt = (date: string): TrainingWindow | null =>
    wins.find((w) => w.starts_on <= date && date <= w.ends_on) ?? null;
  // Fenêtre terrain-plat qui DÉMARRE dans la semaine → d'ici là, les qualités « mangent du D+ »
  // (le dénivelé sera indisponible pendant ; on front-charge la qualité contrainte).
  const flatSoon = wins.find((w) =>
    w.starts_on > ctx.today && daysBetween(ctx.today, w.starts_on) <= 6 && flatTerrain(w)) ?? null;
  const winMul = (e: WindowEffect): number =>
    e === "deload" ? PHASE_PARAMS.deload_factor : e === "maintain" ? WINDOW_PARAMS.maintain_factor : 1;
  let winHardUsed = false; // dans une fenêtre décharge/entretien : UNE seule qualité sur la semaine

  const { daysSince, system } = lastHard(ctx);
  let sinceHard = daysSince;
  let lastSys = system;
  let hardCount = 0;
  let restPlaced = false;

  const days: WeekDay[] = [];
  for (let off = 0; off < 7; off++) {
    const date = dateMinusDays(ctx.today, -off);
    const wd = frWeekday(date);

    // 1) Fixed anchor (declared event / pinned session) — never overwrite its day, never taper it.
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

    let tag: SystemTag;
    if (off === 0) {
      // Today is gated by this morning's readiness.
      if (readiness === "red") tag = "rest";
      else if (readiness === "amber") tag = "recovery";
      else tag = canHard(wd, noHard, sinceHard, hardCount, hardCap) ? altHard(lastSys) : "easy";
    } else {
      // Future days: assume recovery proceeds; respect spacing + constraints + the goal taper (hardCap).
      if (canHard(wd, noHard, sinceHard, hardCount, hardCap)) tag = altHard(lastSys);
      else if (!restPlaced && sinceHard >= 1 && off >= 4) tag = "rest"; // one rest day later in the week
      else tag = sinceHard === 0 ? "recovery" : "easy"; // recovery the day after a hard day
    }

    // Fenêtres de contrainte (Upgrade 10) — trois règles, dans cet ordre :
    const win = winAt(date);
    const winEffect = win ? resolveWindowEffect(win) : null;
    // 1) AVANT une fenêtre terrain-plat : les qualités restantes ciblent le dénivelé/la force
    //    (« manger du D+ » tant que la montagne est disponible).
    if (flatSoon && date < flatSoon.starts_on && isHard(tag)) tag = "hard_neuromuscular";
    // 2) DANS une fenêtre décharge/entretien : une seule qualité sur la semaine, jamais plus.
    if (win && winEffect !== "charge" && isHard(tag)) { tag = winHardUsed ? "easy" : "hard_aerobic"; }
    // 3) Terrain plat : jamais de côtes/force générées dans la fenêtre — la qualité devient du seuil.
    if (flatTerrain(win) && (tag === "hard_neuromuscular" || tag === "hard_structural")) tag = "hard_aerobic";

    // F4 taper (≤14 d to a goal): keep the quality AEROBIC — cut GENERATED eccentric/structural work so
    // legs/tendons arrive fresh (intensity maintained, not killed). Anchors are returned above, never retagged.
    if (taper.active && taper.daysTo <= 14 && (tag === "hard_neuromuscular" || tag === "hard_structural")) {
      tag = "hard_aerobic";
    }

    // Multiplicateur du jour : la fenêtre couvrant CE jour prime sur le facteur de la semaine
    // (une semaine coupée en deux — charge lun-mar, déplacement dès mercredi — se module jour par jour).
    const dayMul = win ? winMul(winEffect!) : loadMul;
    days.push({
      day_offset: off,
      // Terrain plat : même la qualité se court sur le plat (running), pas le sport montagne.
      sport_code: flatTerrain(win) && tag !== "rest" ? baseSport(fav) : sportForDay(tag, fav),
      system_tag: tag,
      focus: focusFor(tag, null) + (flatTerrain(win) && isHard(tag) ? " — terrain plat" : ""),
      target_load: round(targetLoadFor(tag, ctx) * dayMul), is_key: false, anchors_event_ref: null,
    });

    if (isHard(tag)) { sinceHard = 0; lastSys = systemFamily(tag); hardCount++; if (win) winHardUsed = true; }
    else { sinceHard++; if (tag === "rest") restPlaced = true; }
  }

  // Rampe de CTL (Q15) — semaines de charge base/build uniquement : gonfle les jours easy générés
  // (borné) pour viser +ramp_ctl_per_week de CTL, au lieu de retomber sur la semaine « type » qui ne
  // fait que maintenir. Inerte sans objectif daté / sans CTL / en décharge / peak / taper.
  if (!taper.active) applyRampTarget(days, ctx, phase, anchors);
  return days;
}

/** A hard day is allowed iff: not a no-hard weekday, ≥2 days since the last hard, and under the week's
 *  hard-day cap (2 normally; 1 or 0 during a goal taper). */
function canHard(wd: string, noHard: Set<string>, sinceHard: number, hardCount: number, hardCap: number): boolean {
  return !noHard.has(wd) && sinceHard >= 2 && hardCount < hardCap;
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
  // For an anchored day (event / pinned session) the REAL duration lives on that session (its title +
  // its planned_sessions row, shown on /seance) — don't fabricate a generic one that contradicts it.
  const dur = anchor ? 0 : durationFor(tag);
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

/** Résumé FR de la phase (partagé moteur ↔ UI PhaseChip). null quand pas d'objectif daté NI fenêtre.
 *  Accepte la phase EFFECTIVE : une fenêtre active ou une décharge reportée redessine le libellé. */
export function phaseSummaryFr(
  ps: PhaseState & Partial<Pick<EffectivePhase, "window" | "deloadMovedTo">>,
): { name: string; detail: string } | null {
  // Fenêtre couvrant aujourd'hui : elle prime sur le calendrier (c'est elle que vit l'athlète).
  if (ps.window) {
    const effFr: Record<WindowEffect, string> = {
      deload: "on encaisse — volume réduit",
      maintain: "entretien — on garde le moteur",
      charge: "bloc de charge assumé",
    };
    const name = ps.phase === "none" ? "contrainte" : PHASE_FR[ps.phase];
    return {
      name,
      detail: `« ${ps.window.label} » · ${effFr[ps.window.effect]}${ps.window.flat ? " · terrain plat" : ""}`,
    };
  }
  if (ps.phase === "none") return null;
  if (ps.phase === "taper")
    return { name: "affûtage", detail: `J−${ps.daysTo} · on évacue la fatigue, l'intensité reste` };
  if (ps.phase === "peak")
    return { name: "pré-compétition", detail: `S−${ps.weeksTo} · volume réduit, intensité-clé maintenue` };
  const bloc = ps.isDeload
    ? "semaine de décharge — on encaisse le bloc"
    : ps.deloadMovedTo
      ? `on charge — décharge reportée sur « ${ps.deloadMovedTo} »`
      // weekInCycle === cycleLen sans décharge = décharge calendaire supprimée (déjà encaissée dans
      // une fenêtre qui vient de se terminer — grâce post-fenêtre) : le dire, sinon « 3/3 » intrigue.
      : ps.weekInCycle === ps.cycleLen
        ? "on charge — décharge déjà encaissée"
        : `semaine ${ps.weekInCycle}/${ps.cycleLen} du bloc — on charge`;
  return { name: PHASE_FR[ps.phase], detail: `S−${ps.weeksTo} · ${bloc}` };
}

/** Marqueur COMPACT de la phase pour l'agenda (strip de début de semaine — sobre, une ligne).
 *  null quand rien à dire (pas d'objectif daté ni fenêtre). */
export function phaseMarkFr(
  ps: PhaseState & Partial<Pick<EffectivePhase, "window" | "deloadMovedTo">>,
): string | null {
  if (ps.window) {
    const eff = { deload: "on encaisse", maintain: "entretien", charge: "charge" }[ps.window.effect];
    return `${truncate(ps.window.label, 22)} · ${eff}`;
  }
  if (ps.phase === "none") return null;
  if (ps.phase === "taper") return `affûtage · J−${ps.daysTo}`;
  if (ps.phase === "peak") return `pré-compét. · S−${ps.weeksTo}`;
  const state = ps.isDeload ? "décharge"
    : ps.deloadMovedTo ? "charge (décharge reportée)"
    : ps.weekInCycle === ps.cycleLen ? "charge (décharge déjà prise)"
    : `charge ${ps.weekInCycle}/${ps.cycleLen}`;
  return `${PHASE_FR[ps.phase]} · S−${ps.weeksTo} · ${state}`;
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
  // Phase de périodisation EFFECTIVE (Q15 + fenêtres Upgrade 10) — situe la semaine dans la préparation.
  const eff = effectivePhase(ctx);
  const phase = phaseSummaryFr(eff);
  const phaseTxt = phase ? `Phase ${phase.name} (${phase.detail}). ` : "";
  // Fenêtre terrain-plat imminente : dire explicitement qu'on front-charge le dénivelé d'ici là.
  const flatSoon = ((ctx.training_windows ?? []) as TrainingWindow[]).find((w) =>
    w.starts_on > ctx.today && daysBetween(ctx.today, w.starts_on) <= 6 && flatTerrain(w));
  const preTxt = flatSoon && !eff.window
    ? `D'ici « ${flatSoon.label} » (J−${daysBetween(ctx.today, flatSoon.starts_on)}), on privilégie le dénivelé — il sera indisponible pendant. `
    : "";
  return `${phaseTxt}${preTxt}${formeTxt} ${recTxt} ${weekTxt}`;
}

function buildFlag(ctx: any, readiness: Readiness): string | null {
  const rec = ctx.recovery_today ?? null;
  const m = ctx.fitness_model_latest ?? null;
  if (rec && rec.available === false) return "Données Garmin du matin absentes — rafraîchis Garmin pour une lecture fiable de ta récupération.";
  if (m?.acwr != null && m.acwr > R.acwr_red) return `Charge aiguë élevée (ACWR ${round(m.acwr * 100) / 100}) : risque de surcharge, prudence sur l'intensité.`;
  if (m?.tsb_neuromuscular != null && m.tsb_neuromuscular < R.tsb_neuro_red) return "Fatigue neuromusculaire marquée (descentes / force) — protège les jambes même si la récup cardio semble bonne.";
  if (m?.acwr != null && m.acwr > R.acwr_amber && m?.tsb != null && m.tsb >= R.tsb_amber && recentLoadRising(ctx))
    return `Charge aiguë en hausse (ACWR ${round(m.acwr * 100) / 100}) : signal de prudence, on garde de la marge cette semaine.`;
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
