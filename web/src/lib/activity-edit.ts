/** Corrections utilisateur d'une activité synchronisée — le socle partagé de trois écritures :
 *  l'édition de données (updateActivityData), le reclassement de sport (applySportReassignment) et,
 *  côté sync, la ré-application des overrides (strava-sync.ts ↔ strava.py, MIRROIRS — keep in sync).
 *
 *  Principe (même contrat que les RPE user) : chaque champ corrigé est écrit sur la colonne ET
 *  mémorisé dans `activities.user_overrides` (jsonb champ→valeur, + `sport_code` pour la catégorie).
 *  Les deux syncs ré-appliquent ces overrides APRÈS avoir reconstruit la ligne provider et AVANT
 *  compute_load — une correction (ex. D− aberrant sur un canyoning) survit donc à toute re-sync. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPaged } from "./db-paged";
import {
  computeLoad, resolveProfile, descentFamiliarityRatios,
  type LoadActivity, type LoadSport, type LoadProfile, type LoadParams, type LoadResult, type ThresholdRow,
} from "./load";

/** Champs numériques corrigeables — tous lus par computeLoad (ou contexte environnement du coach).
 *  `int` ⇒ entier requis. Bornes larges : on garde le garde-fou, pas la nounou. */
export const EDITABLE_FIELDS = {
  duration_s: { min: 60, max: 30 * 86400, int: true },
  moving_s: { min: 0, max: 30 * 86400, int: true },
  distance_m: { min: 0, max: 1_000_000, int: false },
  vertical_gain_m: { min: 0, max: 20_000, int: false },
  vertical_loss_m: { min: 0, max: 20_000, int: false },
  avg_hr: { min: 30, max: 230, int: true },
  max_hr: { min: 30, max: 250, int: true },
  avg_power_w: { min: 0, max: 1_500, int: false },
  np_power_w: { min: 0, max: 1_500, int: false },
  carried_load_kg: { min: 0, max: 80, int: false },
  avg_altitude_m: { min: -430, max: 8_850, int: false },
  avg_temp_c: { min: -60, max: 60, int: false },
} as const;
export type EditableField = keyof typeof EDITABLE_FIELDS;
export type ActivityEdits = Partial<Record<EditableField, number>>;

/** Le blob user_overrides tel que stocké : champs numériques + éventuellement le sport reclassé. */
export type UserOverrides = Partial<Record<EditableField, number>> & { sport_code?: string };

/** Valide/normalise des edits bruts (issus du formulaire). Jette en français sur une valeur hors borne.
 *  Les clés inconnues sont rejetées (jamais écrites en DB). */
export function sanitizeEdits(edits: Record<string, unknown>): ActivityEdits {
  const out: ActivityEdits = {};
  for (const [k, v] of Object.entries(edits ?? {})) {
    const spec = EDITABLE_FIELDS[k as EditableField];
    if (!spec) throw new Error(`Champ non éditable : ${k}`);
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`Valeur invalide pour ${k}`);
    if (spec.int && !Number.isInteger(n)) throw new Error(`${k} doit être un entier`);
    if (n < spec.min || n > spec.max) throw new Error(`${k} doit être entre ${spec.min} et ${spec.max}`);
    out[k as EditableField] = n;
  }
  return out;
}

/** Ré-applique les overrides numériques sur une ligne provider fraîchement reconstruite (sync).
 *  `sport_code` est géré par l'appelant (il faut résoudre la ligne sports AVANT le calcul de charge).
 *  Recalcule l'allure moyenne à partir des valeurs finales quand distance/moving ont été corrigés
 *  (le rtss la lit). Mutation en place, retourne la ligne. */
export function applyFieldOverrides(
  row: Record<string, unknown>,
  overrides: UserOverrides | null | undefined,
): Record<string, unknown> {
  if (!overrides) return row;
  let paceInputsTouched = false;
  for (const k of Object.keys(EDITABLE_FIELDS) as EditableField[]) {
    const v = overrides[k];
    if (v == null) continue;
    row[k] = v;
    if (k === "distance_m" || k === "moving_s") paceInputsTouched = true;
  }
  if (paceInputsTouched) row.avg_pace_s_per_km = derivedPace(row.distance_m as number | null, row.moving_s as number | null);
  return row;
}

/** Allure moyenne (s/km) dérivée — même formule que les deux syncs. */
export function derivedPace(distanceM: number | null | undefined, movingS: number | null | undefined): number | null {
  if (!distanceM || !movingS || distanceM <= 0) return null;
  return Math.round((movingS / (distanceM / 1000)) * 100) / 100;
}

// Colonnes nécessaires au recalcul complet (mirror des inputs de compute_load + le sport).
const RECOMPUTE_COLS =
  "id,sport_id,local_date,started_at,duration_s,moving_s,avg_hr,np_power_w,avg_power_w," +
  "avg_pace_s_per_km,vertical_gain_m,vertical_loss_m,carried_load_kg,perceived_rpe,rpe_source," +
  "avg_altitude_m,rpe_cardio,rpe_legs,rpe_grip";

/** Recalcule la charge d'UNE activité depuis ses champs stockés, avec TOUT le contexte du modèle
 *  (ladder du sport, seuils datés, coefficients personnalisés, familiarité descente) — parité avec le
 *  recompute Python. Écrit les colonnes de charge et retourne le résultat. NE fait PAS le rollup
 *  daily_metrics : c'est à l'action appelante de le déclencher (une fois) pour propager aux graphs. */
export async function recomputeActivityLoad(sb: SupabaseClient, activityId: string): Promise<LoadResult> {
  const { data, error } = await sb.from("activities").select(RECOMPUTE_COLS).eq("id", activityId).single();
  if (error || !data) throw new Error("Activité introuvable");
  // Le parseur de types supabase-js ne sait pas inférer ce select concaténé — on type la ligne nous-mêmes.
  const act = data as unknown as LoadActivity & { sport_id: number; local_date: string };

  const [{ data: sport }, { data: profileRow }, { data: paramRows }, { data: thresholdRows }, { data: descRows }] =
    await Promise.all([
      sb.from("sports").select("taxonomy_group,load_method_ladder").eq("id", act.sport_id).single(),
      sb.from("athlete_profile").select("ftp_watts,resting_hr,max_hr,lthr,threshold_pace_s_per_km,weight_kg").limit(1).maybeSingle(),
      sb.from("athlete_load_params").select("param,value"),
      sb.from("athlete_thresholds").select("*").order("effective_date", { ascending: true }),
      fetchAllPaged<{ local_date: string; vertical_loss_m: number | null }>(
        (from, to) => sb.from("activities").select("local_date,vertical_loss_m")
          .order("local_date", { ascending: true }).range(from, to),
        { what: "série D− (recompute)" },
      ).then((data) => ({ data })),
    ]);
  if (!sport) throw new Error("Sport introuvable");

  const params: LoadParams = Object.fromEntries(
    ((paramRows ?? []) as { param: string; value: number }[]).filter((r) => r.value != null).map((r) => [r.param, Number(r.value)]),
  );
  const dailyDescent: Record<string, number> = {};
  for (const dr of (descRows ?? []) as { local_date: string; vertical_loss_m: number | null }[]) {
    dailyDescent[dr.local_date] = (dailyDescent[dr.local_date] ?? 0) + Number(dr.vertical_loss_m || 0);
  }
  const fam = descentFamiliarityRatios(dailyDescent)[act.local_date as string] ?? null;
  const effProfile = resolveProfile((profileRow ?? {}) as LoadProfile, (thresholdRows ?? []) as ThresholdRow[], act.local_date as string);

  const res = computeLoad({ ...(act as LoadActivity), descent_familiarity: fam }, sport as LoadSport, effProfile, params);
  const { error: upErr } = await sb.from("activities").update({
    aerobic_load: res.aerobic_load,
    neuromuscular_load: res.neuromuscular_load,
    load_method_used: res.load_method_used,
    intensity_factor: res.intensity_factor,
    effective_days: res.effective_days,
    needs_review: res.needs_review,
  }).eq("id", activityId);
  if (upErr) throw new Error(upErr.message);
  return res;
}
