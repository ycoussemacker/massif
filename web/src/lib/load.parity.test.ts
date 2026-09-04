/** PARITÉ load.py ↔ load.ts — le rejeu TypeScript du jeu de cas d'or.
 *  Run : `npx tsx --test src/lib/load.parity.test.ts` (inclus dans `pnpm -C web test`).
 *
 *  C'EST LE TEST QUI COMPTE. Le modèle de charge est écrit deux fois : `ingest/massif_ingest/load.py`
 *  (601 lignes, source de vérité, exécutée par le cron et le re-scoring) et ce `load.ts` (516 lignes,
 *  exécutée par la synchro à la demande et par chaque correction depuis l'app). Si les deux divergent,
 *  la charge d'une activité dépend du CHEMIN par lequel elle a été calculée — et rien ne le signale,
 *  puisque les deux valeurs sont plausibles.
 *
 *  La parité reposait jusqu'ici sur une vérification manuelle unique (« 395/395 activités, CTL
 *  exact »), faite une fois et invalidée depuis par chaque évolution du modèle, plus des commentaires
 *  « KEEP IN SYNC ». Un commentaire n'est pas un test.
 *
 *  Les valeurs attendues sont produites par Python (`ingest/scripts/gen_load_golden.py`) et versionnées
 *  dans `tests/golden/load-parity.json`. Tolérance 1e-9 : on compare le même calcul en IEEE754, pas
 *  deux approximations. Après un changement volontaire du modèle : régénérer, committer le fichier
 *  d'or avec le changement — son diff montre exactement ce que le changement déplace. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  computeLoad, descentFactor, descentRecoveryFactor, altitudePowerFactor, ewmaVariableTau,
  descentFamiliarityRatios, resolveProfile,
  type LoadActivity, type LoadSport, type LoadProfile, type LoadParams, type ThresholdRow,
} from "./load";

type Golden = {
  tolerance: number;
  compute_load: {
    id: string; why: string;
    activity: LoadActivity; sport: LoadSport; profile: LoadProfile; params: LoadParams | null;
    expected: {
      aerobic_load: number; neuromuscular_load: number; load_method_used: string;
      intensity_factor: number | null; effective_days: number; needs_review: boolean;
    };
  }[];
  helpers: Record<string, any[]>;
};

const G: Golden = JSON.parse(
  readFileSync(new URL("../../../tests/golden/load-parity.json", import.meta.url), "utf8"));
const TOL = G.tolerance;

function close(got: number | null | undefined, exp: number | null | undefined, what: string) {
  if (got == null || exp == null) return assert.equal(got ?? null, exp ?? null, what);
  assert.ok(Math.abs(got - exp) <= TOL,
    `${what} : ${got} vs ${exp} attendu (écart ${Math.abs(got - exp)}, tolérance ${TOL})`);
}

test("le fichier d'or exerce bien toutes les méthodes de l'échelle", () => {
  const used = new Set(G.compute_load.map((c) => c.expected.load_method_used));
  for (const m of ["hrtss", "tss", "rtss", "vertical_duration", "session_rpe", "duration_fallback"]) {
    assert.ok(used.has(m), `aucun cas n'atteint la méthode ${m}`);
  }
  assert.ok(G.compute_load.length >= 100, "trop peu de cas pour couvrir le modèle");
});

test("computeLoad rend exactement ce que compute_load rend", () => {
  const diffs: string[] = [];
  for (const c of G.compute_load) {
    const r = computeLoad(c.activity, c.sport, c.profile, c.params ?? undefined);
    const e = c.expected;
    const bad = (what: string, got: unknown, exp: unknown) =>
      diffs.push(`${c.id} (${c.why}) — ${what} : ${got} vs ${exp}`);
    if (Math.abs(r.aerobic_load - e.aerobic_load) > TOL) bad("aérobie", r.aerobic_load, e.aerobic_load);
    if (Math.abs(r.neuromuscular_load - e.neuromuscular_load) > TOL) bad("neuro", r.neuromuscular_load, e.neuromuscular_load);
    if (r.load_method_used !== e.load_method_used) bad("méthode", r.load_method_used, e.load_method_used);
    if (r.effective_days !== e.effective_days) bad("jours effectifs", r.effective_days, e.effective_days);
    if (r.needs_review !== e.needs_review) bad("à revoir", r.needs_review, e.needs_review);
    const gi = r.intensity_factor, ei = e.intensity_factor;
    if ((gi == null) !== (ei == null) || (gi != null && ei != null && Math.abs(gi - ei) > TOL)) bad("IF", gi, ei);
  }
  // Tous les écarts d'un coup : sur une divergence de modèle on veut le TABLEAU, pas le premier cas.
  assert.deepEqual(diffs, [], `${diffs.length} divergence(s) sur ${G.compute_load.length} cas :\n` + diffs.slice(0, 25).join("\n"));
});

test("descentFactor", () => {
  for (const c of G.helpers.descent_factor) close(descentFactor(c.ratio), c.expected, `ratio=${c.ratio}`);
});

test("descentRecoveryFactor", () => {
  for (const c of G.helpers.descent_recovery_factor) close(descentRecoveryFactor(c.ratio), c.expected, `ratio=${c.ratio}`);
});

test("altitudePowerFactor", () => {
  for (const c of G.helpers.altitude_power_factor) {
    close(altitudePowerFactor(c.altitude_m, c.acclimatized), c.expected, `alt=${c.altitude_m} acc=${c.acclimatized}`);
  }
});

test("ewmaVariableTau — la forme de la fatigue, pas seulement la charge", () => {
  for (const [i, c] of G.helpers.ewma_variable_tau.entries()) {
    const got = ewmaVariableTau(c.values, c.tau_days);
    assert.equal(got.length, c.expected.length, `série ${i} : longueur`);
    got.forEach((g: number, j: number) => close(g, c.expected[j], `série ${i}[${j}]`));
  }
});

test("descentFamiliarityRatios", () => {
  for (const [i, c] of G.helpers.descent_familiarity_ratios.entries()) {
    const got = descentFamiliarityRatios(c.daily_descent);
    assert.deepEqual(Object.keys(got).sort(), Object.keys(c.expected).sort(), `jeu ${i} : dates`);
    for (const [k, e] of Object.entries(c.expected)) close(got[k], e as number, `jeu ${i} ratio[${k}]`);
  }
});

test("resolveProfile — les seuils datés", () => {
  for (const [i, c] of G.helpers.resolve_profile.entries()) {
    assert.deepEqual(resolveProfile(c.profile, (c.history ?? []) as ThresholdRow[], c.on_date), c.expected, `cas ${i}`);
  }
});
