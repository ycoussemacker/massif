-- Massif — seed the sports reference table.
--
-- source_aliases hold raw activity-type strings from Strava (CamelCase) and Garmin
-- (snake_case activityType keys) so the Python ingestion maps any incoming activity to a
-- normalized sport + load-method ladder. Anything unmatched falls through to 'unknown'.
--
-- IMPORTANT ingestion rule: read Strava `sport_type`, NOT the legacy `type` field. The legacy
-- `type` returns 'Ride' for road/gravel/MTB/e-bike alike, and 'Run' for road/trail; only
-- `sport_type` disambiguates them. These aliases are a best-effort starting point and get
-- validated against real data in Phase 2/3 (unmatched activities are flagged, not silently lost).
--
-- load_method_ladder is ordered: the job uses the first method whose inputs are present,
-- always ending in a duration/sRPE fallback so every activity gets a non-NULL load.

insert into sports
  (code, display_name, taxonomy_group, load_method_ladder,
   uses_distance, uses_hr, uses_vertical, needs_manual_rpe, is_priority, source_aliases)
values
  -- ── paced endurance ──
  ('running',         'Running',           'paced_endurance',
     '{hrtss,session_rpe,duration_fallback}',
     true,  true,  false, false, true,
     '{Run,VirtualRun,running,treadmill_running,track_running,virtual_run}'),
  ('trail_running',   'Trail running',     'paced_endurance',
     '{hrtss,session_rpe,duration_fallback}',
     true,  true,  true,  false, true,
     '{TrailRun,trail_running}'),
  ('cycling',         'Cycling',           'paced_endurance',
     '{tss,hrtss,session_rpe,duration_fallback}',
     true,  true,  false, false, false,
     '{Ride,VirtualRide,cycling,road_biking,indoor_cycling,virtual_ride}'),
  ('gravel_cycling',  'Gravel cycling',    'paced_endurance',
     '{tss,hrtss,session_rpe,duration_fallback}',
     true,  true,  true,  false, false,
     '{GravelRide,gravel_cycling}'),
  ('mountain_biking', 'Mountain biking',   'paced_endurance',
     '{tss,hrtss,session_rpe,duration_fallback}',
     true,  true,  true,  false, false,
     '{MountainBikeRide,mountain_biking}'),
  ('nordic_skiing',   'Nordic skiing',     'paced_endurance',
     '{hrtss,session_rpe,duration_fallback}',
     true,  true,  false, false, false,
     '{NordicSki,cross_country_skiing}'),
  ('rowing',          'Rowing',            'paced_endurance',
     '{hrtss,session_rpe,duration_fallback}',
     true,  true,  false, false, false,
     '{Rowing,rowing,indoor_rowing}'),
  -- ── mountain / vertical ──
  ('hiking',          'Hiking',            'mountain_vertical',
     '{vertical_duration,hrtss,session_rpe,duration_fallback}',
     true,  true,  true,  false, true,
     '{Hike,hiking}'),
  ('alpinism',        'Alpinism',          'mountain_vertical',
     '{vertical_duration,session_rpe,duration_fallback}',
     true,  true,  true,  true,  true,
     '{mountaineering}'),                              -- mostly Garmin/manual (Strava logs as Hike)
  ('ski_touring',     'Ski touring',       'mountain_vertical',
     '{vertical_duration,hrtss,session_rpe,duration_fallback}',
     true,  true,  true,  false, false,
     '{BackcountrySki,backcountry_skiing,ski_touring}'),
  ('snowshoeing',     'Snowshoeing',       'mountain_vertical',
     '{vertical_duration,hrtss,session_rpe,duration_fallback}',
     true,  true,  true,  false, false,
     '{Snowshoe,snowshoeing}'),
  ('via_ferrata',     'Via ferrata',       'mountain_vertical',
     '{vertical_duration,session_rpe,duration_fallback}',
     true,  true,  true,  true,  false,
     '{via_ferrata}'),                                 -- manual-only (no provider type)
  -- ── technical / strength (climbing) ──
  ('rock_climbing',   'Rock climbing',     'technical_strength',
     '{grade_volume,session_rpe,duration_fallback}',
     false, false, false, true,  true,
     '{RockClimbing,rock_climbing}'),
  ('bouldering',      'Bouldering',        'technical_strength',
     '{grade_volume,session_rpe,duration_fallback}',
     false, false, false, true,  true,
     '{Bouldering,bouldering}'),
  ('indoor_climbing', 'Indoor climbing',   'technical_strength',
     '{grade_volume,session_rpe,duration_fallback}',
     false, false, false, true,  false,
     '{indoor_climbing}'),                             -- Garmin-only; Strava can't split indoor/outdoor
  -- ── resistance ──
  ('strength',        'Strength training', 'resistance',
     '{tonnage_rpe,session_rpe,duration_fallback}',
     false, false, false, true,  false,
     '{WeightTraining,strength_training}'),            -- NB: Strava 'Workout' is generic → 'unknown'
  -- ── aquatic ──
  ('swimming',        'Swimming',          'aquatic',
     '{rtss,session_rpe,duration_fallback}',           -- rtss = pace-TSS keyed on css_pace
     true,  true,  false, false, false,
     '{Swim,lap_swimming,open_water_swimming,swimming}'),
  -- ── downhill / resort (lift-served: low aerobic, sRPE captures it) ──
  ('downhill_skiing', 'Downhill ski/board','other',
     '{session_rpe,duration_fallback}',
     true,  false, false, true,  false,
     '{AlpineSki,Snowboard,resort_skiing,resort_snowboarding,resort_skiing_snowboarding}'),
  -- ── other / catch-all (universal sRPE / duration fallback) ──
  ('walking',         'Walking',           'other',
     '{hrtss,duration_fallback}',
     true,  true,  false, false, false,
     '{Walk,walking}'),
  ('yoga',            'Yoga & mobility',   'other',
     '{session_rpe,duration_fallback}',
     false, false, false, true,  false,
     '{Yoga,yoga,pilates}'),
  ('elliptical',      'Elliptical / misc', 'other',
     '{hrtss,duration_fallback}',
     false, true,  false, false, false,
     '{Elliptical,elliptical}'),
  ('unknown',         'Unknown / generic', 'other',
     '{session_rpe,duration_fallback}',
     false, false, false, true,  false,
     '{Workout,workout}');                             -- Strava generic catch-all lands here
