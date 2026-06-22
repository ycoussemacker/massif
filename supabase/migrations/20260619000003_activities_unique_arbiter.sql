-- Fix the activities dedupe arbiter so the Strava/Garmin upsert works.
--
-- The init migration created activities_source_uniq as a PARTIAL unique index
-- (... WHERE source_activity_id IS NOT NULL). PostgreSQL can only use a partial index as an
-- ON CONFLICT arbiter when the statement repeats the index predicate, but PostgREST / supabase-py
-- emit `on_conflict=source,source_activity_id` with no WHERE clause — so every upsert_activity
-- raised SQLSTATE 42P10 ("no unique or exclusion constraint matching the ON CONFLICT specification")
-- and ingestion crashed on the first row.
--
-- Make the index unconditional: it becomes inferable for ON CONFLICT, and manual rows
-- (source='manual', source_activity_id NULL) still never collide because NULLs are distinct under
-- a normal unique index. Imported rows (strava/garmin) always carry a non-NULL source_activity_id.
drop index if exists activities_source_uniq;
create unique index activities_source_uniq on activities (source, source_activity_id);
