-- Massif — add the "Grande voie" (multi-pitch climbing) sport + its taxonomy group.
--
-- WHY: Strava offers no "alpinism" / "grande voie" activity type, so these get logged as Hike and
-- scored as a hike on ELAPSED time — the long belays / approach / transitions inflate the aerobic load
-- (and trip the needs_review flag). A grande voie loads BOTH physiological systems: the aerobic engine
-- of a long mountain day (+ approach / D+) AND a real technical / forearm / core neuromuscular cost.
--
-- A dedicated, ADDITIVE taxonomy group `mountain_technical` (an aerobic-engine group, so it keeps the
-- independent eccentric-descent term) with a higher IMPACT_FRAC (0.40, see load.py) captures that —
-- unlike `technical_strength` (15/85 split, no descent term) which would erase the long aerobic day and
-- the walk-off descent. needs_manual_rpe=true: the RPE is the truth for technical effort. The ladder has
-- NO hrtss (the average HR is contaminated by belay time) → it scores on vertical_duration
-- (moving-time-corrected for mostly-stopped days, see load._scored_duration) then session_rpe.
--
-- Reached via the web keyword detector (hiking → grande_voie suggestion, validated by the athlete) and
-- by manual reclassification; no provider alias (Strava can't emit it).

alter table sports drop constraint sports_taxonomy_group_check;
alter table sports add constraint sports_taxonomy_group_check check (taxonomy_group in (
  'paced_endurance','mountain_vertical','mountain_technical','technical_strength',
  'resistance','aquatic','other'));

insert into sports
  (code, display_name, taxonomy_group, load_method_ladder,
   uses_distance, uses_hr, uses_vertical, needs_manual_rpe, is_priority, source_aliases)
values
  ('grande_voie', 'Multi-pitch climbing', 'mountain_technical',
     '{vertical_duration,session_rpe,duration_fallback}',
     true, true, true, true, true,
     '{}')                                             -- no provider type; keyword-detected + manual reclass
on conflict (code) do nothing;
