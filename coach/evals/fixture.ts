/** L'athlète synthétique des évals — généré, jamais extrait de la vraie base.
 *
 *  Le dépôt est public : y committer un instantané réel publierait des données de santé (sommeil, VFC,
 *  FC de repos). La fixture est donc construite ici, ce qui règle la confidentialité ET rend les évals
 *  exécutables par quiconque clone le dépôt — sans accès à la base de personne.
 *
 *  Elle n'est pas « des données au hasard » : chaque trait existe pour qu'un cas d'éval ait une réponse
 *  VÉRIFIABLE.
 *
 *    · une colonne quotidienne de 2021 à aujourd'hui (2 072 lignes > le plafond de 1000) — sans quoi le
 *      cas de non-régression « compare 2022 à 2026 » ne prouverait rien ;
 *    · un TROU de 14 jours dans les activités (13–26 juillet 2026) — l'agent doit le signaler, pas
 *      conclure « tu as coupé » ;
 *    · AUCUNE récupération pour aujourd'hui — l'agent doit nommer la donnée qui lui manque au lieu
 *      d'inventer un Body Battery ;
 *    · une charge neuromusculaire récente dominée par l'ESCALADE (≈ 4× celle du trail sur 14 j) — le cas
 *      « c'est l'escalade ou le trail ? » a une bonne réponse ;
 *    · un objectif DATÉ à J−21 — le cas « est-ce que je suis prêt dans trois semaines ? » a un horizon ;
 *    · un volume 2026 nettement supérieur à 2022 — la comparaison inter-annuelle a un sens.
 *
 *  Tirages pseudo-aléatoires à graine fixe : deux générations donnent la même fixture, octet pour octet. */

export const FIXTURE_TODAY = "2026-09-02";
const SPINE_START = "2021-01-01";
const GAP = { from: "2026-07-13", to: "2026-07-26" }; // le trou de deux semaines

/** mulberry32 — générateur à graine, pour que la fixture soit rejouable à l'identique. */
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const day = 86_400_000;
const iso = (d: number) => new Date(d).toISOString().slice(0, 10);
const parse = (s: string) => Date.parse(s + "T00:00:00Z");
const addDays = (s: string, n: number) => iso(parse(s) + n * day);
const between = (a: string, b: string) => Math.round((parse(b) - parse(a)) / day);

const SPORTS = [
  { id: 1, code: "trail_running", display_name: "Trail", taxonomy_group: "endurance", needs_manual_rpe: false, load_method_ladder: ["hrtss", "duration_fallback"], uses_distance: true, uses_hr: true, source_aliases: ["TrailRun"] },
  { id: 2, code: "running", display_name: "Course à pied", taxonomy_group: "endurance", needs_manual_rpe: false, load_method_ladder: ["hrtss", "rtss", "duration_fallback"], uses_distance: true, uses_hr: true, source_aliases: ["Run"] },
  { id: 3, code: "hiking", display_name: "Randonnée", taxonomy_group: "endurance", needs_manual_rpe: false, load_method_ladder: ["vertical_duration", "duration_fallback"], uses_distance: true, uses_hr: true, source_aliases: ["Hike"] },
  { id: 4, code: "bouldering", display_name: "Bloc", taxonomy_group: "climbing", needs_manual_rpe: true, load_method_ladder: ["session_rpe", "duration_fallback"], uses_distance: false, uses_hr: false, source_aliases: ["RockClimbing"] },
  { id: 5, code: "rock_climbing", display_name: "Falaise", taxonomy_group: "climbing", needs_manual_rpe: true, load_method_ladder: ["session_rpe", "duration_fallback"], uses_distance: false, uses_hr: false, source_aliases: [] },
  { id: 6, code: "cycling", display_name: "Vélo", taxonomy_group: "endurance", needs_manual_rpe: false, load_method_ladder: ["tss", "hrtss", "duration_fallback"], uses_distance: true, uses_hr: true, source_aliases: ["Ride"] },
  { id: 7, code: "strength", display_name: "Renforcement", taxonomy_group: "strength", needs_manual_rpe: true, load_method_ladder: ["session_rpe", "duration_fallback"], uses_distance: false, uses_hr: false, source_aliases: ["WeightTraining"] },
];

type Act = Record<string, any>;

/** Les 21 derniers jours, ÉCRITS À LA MAIN — pas tirés au sort.
 *  C'est sur eux que portent les assertions : forme légèrement négative (la zone productive à J−21 d'un
 *  objectif), ratio aigu/chronique dans la bande sûre, et une charge neuromusculaire dominée par
 *  l'escalade d'un facteur ≈ 2,2 sur le trail. Laisser les dés décider de ces chiffres reviendrait à
 *  écrire des cas dont on ne connaît pas la bonne réponse. `d` = jours AVANT aujourd'hui. */
const RECENT: { d: number; sport: number; min: number; dminus: number; aer: number; neu: number }[] = [
  { d: 1,  sport: 1, min: 75,  dminus: 520,  aer: 68, neu: 24 },
  { d: 2,  sport: 4, min: 105, dminus: 0,    aer: 16, neu: 64 },
  { d: 4,  sport: 1, min: 155, dminus: 1150, aer: 112, neu: 46 },
  { d: 5,  sport: 4, min: 95,  dminus: 0,    aer: 15, neu: 60 },
  { d: 6,  sport: 2, min: 45,  dminus: 60,   aer: 34, neu: 9 },
  { d: 8,  sport: 4, min: 110, dminus: 0,    aer: 17, neu: 68 },
  { d: 9,  sport: 1, min: 85,  dminus: 640,  aer: 72, neu: 27 },
  { d: 11, sport: 4, min: 100, dminus: 0,    aer: 14, neu: 56 },
  { d: 12, sport: 1, min: 65,  dminus: 380,  aer: 55, neu: 19 },
  { d: 13, sport: 7, min: 50,  dminus: 0,    aer: 11, neu: 36 },
  { d: 15, sport: 1, min: 130, dminus: 980,  aer: 96, neu: 40 },
  { d: 16, sport: 4, min: 90,  dminus: 0,    aer: 13, neu: 52 },
  { d: 18, sport: 2, min: 55,  dminus: 90,   aer: 42, neu: 11 },
  { d: 19, sport: 1, min: 70,  dminus: 470,  aer: 60, neu: 22 },
  { d: 20, sport: 3, min: 240, dminus: 1300, aer: 88, neu: 50 },
];

/** L'historique. Tiré aux dés jusqu'à J−22 (le volume monte d'année en année : 2022 bas, 2026 haut),
 *  puis remplacé par le bloc RECENT sur les trois dernières semaines. */
function buildActivities(): Act[] {
  const rand = rng(20260902);
  const acts: Act[] = [];
  const total = between(SPINE_START, FIXTURE_TODAY);
  let n = 0;

  const push = (date: string, sportId: number, durMin: number, dminus: number, aerobic: number, neuro: number) => {
    const sport = SPORTS.find((s) => s.id === sportId)!;
    n++;
    acts.push({
      id: `act-${String(n).padStart(4, "0")}`,
      source: "strava", source_activity_id: `s-${n}`,
      local_date: date, started_at: `${date}T09:12:00Z`, sport_id: sport.id,
      duration_s: durMin * 60, moving_s: durMin * 60,
      distance_m: sport.uses_distance ? Math.round(durMin * 160) : null,
      vertical_gain_m: dminus, vertical_loss_m: dminus,
      avg_hr: sport.uses_hr ? 128 + Math.floor(rand() * 26) : null,
      max_hr: sport.uses_hr ? 165 + Math.floor(rand() * 20) : null,
      avg_power_w: null, np_power_w: null, avg_pace_s_per_km: null, carried_load_kg: null,
      avg_altitude_m: 600 + Math.floor(rand() * 700), max_altitude_m: 900 + Math.floor(rand() * 1400),
      time_high_altitude_s: 0, avg_temp_c: 12 + Math.floor(rand() * 16),
      aerobic_load: Math.round(aerobic * 10) / 10,
      neuromuscular_load: Math.round(neuro * 10) / 10,
      training_load: Math.round((aerobic + neuro) * 10) / 10,
      load_method_used: sport.taxonomy_group === "endurance" ? "hrtss" : "duration_fallback",
      intensity_factor: null, effective_days: 1,
      perceived_rpe: sport.needs_manual_rpe ? 7 : null,
      rpe_source: sport.needs_manual_rpe ? "user" : "estimated",
      rpe_cardio: null, rpe_legs: null, rpe_grip: null, user_overrides: null,
      sport_specific: { strava_name: `${sport.display_name} ${date}` },
      raw_payload: { description: "" },
      updated_at: `${date}T20:00:00Z`,
    });
  };

  for (let i = 0; i <= total - 22; i++) {
    const date = addDays(SPINE_START, i);
    if (date >= GAP.from && date <= GAP.to) continue;          // le trou volontaire
    const year = Number(date.slice(0, 4));
    // Densité croissante : ~1 séance/semaine en 2021, ~3 en 2026.
    const density = { 2021: 0.14, 2022: 0.17, 2023: 0.21, 2024: 0.27, 2025: 0.34, 2026: 0.42 }[year] ?? 0.25;
    if (rand() > density) continue;
    const sport = SPORTS[Math.floor(rand() * SPORTS.length)];
    const climbing = sport.taxonomy_group === "climbing";
    const strength = sport.taxonomy_group === "strength";
    const durMin = climbing ? 90 + Math.floor(rand() * 60) : strength ? 45 : 55 + Math.floor(rand() * 120);
    const dminus = climbing || strength ? 0 : Math.floor(rand() * (sport.code === "hiking" ? 1200 : 700));
    const aerobic = climbing ? 12 + rand() * 14 : strength ? 8 + rand() * 6 : 25 + (durMin / 60) * (22 + rand() * 20);
    const neuro = climbing ? 48 + rand() * 26 : strength ? 30 + rand() * 12 : 6 + (dminus / 1000) * 32 + rand() * 6;
    push(date, sport.id, durMin, dminus, aerobic, neuro);
  }

  for (const r of [...RECENT].sort((a, b) => b.d - a.d)) {
    push(addDays(FIXTURE_TODAY, -r.d), r.sport, r.min, r.dminus, r.aer, r.neu);
  }
  return acts;
}

/** La colonne quotidienne : UNE ligne par jour depuis 2021, jours de repos compris (les EWMA n'ont pas
 *  de trou), avec le modèle CTL/ATL/TSB/ACWR et la récupération Garmin. */
function buildDailyMetrics(acts: Act[]): Record<string, any>[] {
  const rand = rng(777);
  const byDate = new Map<string, Act[]>();
  for (const a of acts) (byDate.get(a.local_date) ?? byDate.set(a.local_date, []).get(a.local_date)!).push(a);

  const rows: Record<string, any>[] = [];
  let ctl = 18, atl = 18, ctlA = 12, atlA = 12, ctlN = 6, atlN = 6;
  const loads: number[] = [];
  const total = between(SPINE_START, FIXTURE_TODAY);

  for (let i = 0; i <= total; i++) {
    const date = addDays(SPINE_START, i);
    const dayActs = byDate.get(date) ?? [];
    const aer = dayActs.reduce((t, a) => t + a.aerobic_load, 0);
    const neu = dayActs.reduce((t, a) => t + a.neuromuscular_load, 0);
    const load = aer + neu;
    loads.push(load);

    const ew = (prev: number, x: number, tau: number) => prev + (x - prev) * (1 - Math.exp(-1 / tau));
    ctl = ew(ctl, load, 42); atl = ew(atl, load, 7);
    ctlA = ew(ctlA, aer, 42); atlA = ew(atlA, aer, 7);
    ctlN = ew(ctlN, neu, 42); atlN = ew(atlN, neu, 11.5);

    const acute = loads.slice(-7).reduce((t, x) => t + x, 0) / 7;
    const chronic = loads.slice(-28).reduce((t, x) => t + x, 0) / Math.min(28, loads.length);
    const r1 = (x: number) => Math.round(x * 10) / 10;

    // Récupération Garmin : présente partout SAUF aujourd'hui — le cas « données manquantes ».
    const noRecovery = date === FIXTURE_TODAY;
    rows.push({
      local_date: date,
      daily_load: r1(load), daily_aerobic_load: r1(aer), daily_neuromuscular_load: r1(neu),
      ctl: r1(ctl), atl: r1(atl), tsb: r1(ctl - atl), acwr: chronic > 0 ? r1(acute / chronic) : null,
      ctl_aerobic: r1(ctlA), atl_aerobic: r1(atlA), tsb_aerobic: r1(ctlA - atlA),
      ctl_neuromuscular: r1(ctlN), atl_neuromuscular: r1(atlN), tsb_neuromuscular: r1(ctlN - atlN),
      vertical_gain_m: dayActs.reduce((t, a) => t + (a.vertical_gain_m || 0), 0),
      vertical_loss_m: dayActs.reduce((t, a) => t + (a.vertical_loss_m || 0), 0),
      sleep_score: noRecovery ? null : 62 + Math.floor(rand() * 30),
      sleep_duration_s: noRecovery ? null : (6.2 + rand() * 1.8) * 3600,
      hrv_overnight_ms: noRecovery ? null : 48 + Math.floor(rand() * 22),
      hrv_status: noRecovery ? null : (rand() < 0.7 ? "balanced" : "unbalanced"),
      resting_hr: noRecovery ? null : 46 + Math.floor(rand() * 6),
      body_battery_high: noRecovery ? null : 70 + Math.floor(rand() * 25),
      body_battery_low: noRecovery ? null : 15 + Math.floor(rand() * 20),
      stress_avg: noRecovery ? null : 25 + Math.floor(rand() * 20),
      training_readiness: noRecovery ? null : 50 + Math.floor(rand() * 40),
      heat_acclimation_pct: noRecovery ? null : 70,
      altitude_acclimation_m: noRecovery ? null : 1100,
      soreness: null,
    });
  }
  return rows;
}

export function buildFixture() {
  const activities = buildActivities();
  const daily_metrics = buildDailyMetrics(activities);
  const plan = (d: number, sport: number, title: string, tag: string, aer: number, neu: number, key = false) => ({
    id: `plan-${d}`, planned_date: addDays(FIXTURE_TODAY, d), order_in_day: 0, sport_id: sport,
    title, description: null, system_tag: tag, intensity_zone: tag === "easy" ? "Z2" : "Z3",
    is_event: false, is_pinned: false, is_key: key, status: "planned", modified_by: "coach",
    target_aerobic_load: aer, target_neuromuscular_load: neu, target_load: aer + neu,
    target_duration_s: 3600, target_distance_m: null, target_vertical_m: null, expected_altitude_m: null,
    predicted_aerobic_load: null, predicted_neuromuscular_load: null,
    linked_activity_id: null, source: "briefing", proposal_id: null,
    updated_at: `${FIXTURE_TODAY}T06:00:00Z`,
  });

  return {
    sports: SPORTS,
    activities,
    daily_metrics,
    planned_sessions: [
      plan(0, 1, "Sortie Z2 vallonnée", "easy", 55, 18),
      plan(1, 2, "Seuil 3×8'", "hard_aerobic", 78, 12, true),
      plan(2, 0 + 4, "Bloc technique", "easy", 14, 40),
      plan(3, 1, "Longue avec D+", "hard_neuromuscular", 95, 55, true),
      plan(5, 2, "Footing souple", "easy", 40, 10),
      {
        id: "event-ossau", planned_date: "2026-09-23", order_in_day: 0, sport_id: 1,
        title: "Trail de l'Ossau 60K", description: "Objectif de la saison", system_tag: "hard_aerobic",
        is_event: true, is_pinned: false, is_key: true, status: "planned", modified_by: "user",
        target_distance_m: 60000, target_vertical_m: 3400, target_duration_s: 8 * 3600,
        target_aerobic_load: null, target_neuromuscular_load: null, target_load: null,
        predicted_aerobic_load: 210, predicted_neuromuscular_load: 190,
        expected_altitude_m: 2100, linked_activity_id: null, source: "declared", proposal_id: null,
        updated_at: `${FIXTURE_TODAY}T06:00:00Z`,
      },
    ],
    goals: [{
      id: "goal-1", title: "Trail de l'Ossau 60K", sport_id: 1, kind: "race", priority_rank: 1,
      target_date: "2026-09-23", target_horizon: null, target_detail: "60 km / 3400 D+", notes: null,
      status: "active",
    }],
    athlete_profile: [{
      id: 1, display_name: "Athlète test", max_hr: 188, resting_hr: 48, lthr: 172, ftp_watts: null,
      threshold_pace_s_per_km: 258, weight_kg: 68, timezone: "Europe/Paris",
      hr_zones: { source: "garmin", zones: [
        { zone: "Z1", low_bpm: 97, high_bpm: 116 }, { zone: "Z2", low_bpm: 116, high_bpm: 135 },
        { zone: "Z3", low_bpm: 135, high_bpm: 154 }, { zone: "Z4", low_bpm: 154, high_bpm: 179 },
        { zone: "Z5", low_bpm: 179, high_bpm: 193 },
      ] },
    }],
    athlete_load_params: [], athlete_thresholds: [], training_windows: [], daily_weather: [],
    coach_briefings: [], coach_messages: [], coach_proposals: [],
    coach_settings: [{ id: 1, briefing_mode: "free", voice: "direct", coach_animal: "bouquetin", custom_instructions: null }],
  };
}

/** Quelques vérités de la fixture, utilisées par les assertions des cas d'éval. */
export const FIXTURE_FACTS = {
  today: FIXTURE_TODAY,
  goalDate: "2026-09-23",
  daysToGoal: 21,
  gap: GAP,
  spineStart: SPINE_START,
};
