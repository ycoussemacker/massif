-- Heart-rate training zones (bpm) — so "Z2" in the coach's prescription means the SAME thing as on the
-- athlete's Garmin watch. Until now Massif had NO numeric zone: the coach emitted a free-text label
-- ("Z2") with no bpm anchor, while the watch's Z2 is defined by Garmin's own zone config — the two were
-- unrelated, so a session the watch flagged as too hot could read "respecté" here. We now ingest the
-- athlete's REAL zones (Garmin first; a %HRR fallback computed from thresholds when Garmin yields none)
-- and feed their bpm bounds to the coach, which translates each aerobic target into a concrete band.
--
-- hr_zones is a single JSONB blob on the single-row athlete_profile (the athlete's CURRENT zones — no
-- effective-dated history yet; the load model already resolves dated thresholds separately, and zones
-- here are GUIDANCE/context, never a load input). Shape written by ingest/massif_ingest/zones.py:
--   { "source": "garmin"|"computed", "model": "garmin"|"%HRR", "updated_at": "YYYY-MM-DD",
--     "zones": [ {"n":1,"name":"Z1","low_bpm":95,"high_bpm":114}, … 5 zones ] }
alter table athlete_profile add column if not exists hr_zones jsonb;

-- The coach's per-session HR target band (bpm) — the concrete zone to hold, mirrored from the briefing's
-- detailed_sessions onto the materialized planned_sessions row (sibling of target_aerobic_load etc.).
-- Null for sessions not driven by HR (strength/climbing/neuromuscular). Surfaced on the séance page.
alter table planned_sessions add column if not exists target_hr_low  int;
alter table planned_sessions add column if not exists target_hr_high int;
