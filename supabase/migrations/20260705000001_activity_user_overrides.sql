-- Corrections utilisateur sur les données d'une activité synchronisée.
-- Problème résolu : le provider (Strava) fait parfois n'importe quoi (ex. D− 2000 m sur un canyoning)
-- et chaque re-sync ÉCRASAIT les corrections de l'athlète (sport reclassé, D− corrigé…).
-- `user_overrides` mémorise, champ par champ, ce que l'athlète a corrigé :
--   clés numériques = duration_s, moving_s, distance_m, vertical_gain_m, vertical_loss_m,
--                     avg_hr, max_hr, avg_power_w, np_power_w, carried_load_kg,
--                     avg_altitude_m, avg_temp_c
--   clé texte       = sport_code (reclassement de la catégorie)
-- Les DEUX syncs (web/src/lib/strava-sync.ts et ingest/massif_ingest/strava.py) ré-appliquent ces
-- overrides APRÈS avoir reconstruit la ligne provider et AVANT compute_load, exactement comme les
-- RPE utilisateur (rpe_source='user') — les corrections survivent donc à toute re-sync.
alter table public.activities
  add column if not exists user_overrides jsonb;

comment on column public.activities.user_overrides is
  'Corrections manuelles de l''athlète (champ -> valeur), ré-appliquées à chaque re-sync provider. '
  'Clés : champs numériques du calcul de charge + sport_code. NULL = aucune correction.';
