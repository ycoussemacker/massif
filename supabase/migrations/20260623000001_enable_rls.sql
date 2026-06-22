-- Massif — enable Row Level Security (deny-all to anon/authenticated) on every public table.
--
-- The app reads AND writes exclusively through the service-role server client (web/src/lib/supabase/
-- server.ts createServiceClient, ingest/coach use the secret key), and service_role has BYPASSRLS —
-- so this is a near-zero-behaviour change: it just closes the direct anonymous REST surface.
-- (Verified pre-migration: the publishable key already returned [] thanks to default-privilege
-- changes; this makes that protection EXPLICIT and robust against a future GRANT re-opening it.)
--
-- No anon/authenticated policies are added → with RLS enabled and no policy, those public roles are
-- denied all rows. Per-user policies (auth.uid() = athlete_id) arrive with the multi-user epic
-- (Phase 9); until then, deny-all is correct for a single-user, server-only-read app.

alter table sports               enable row level security;
alter table athlete_profile      enable row level security;
alter table activities           enable row level security;
alter table activity_streams     enable row level security;
alter table climbing_sets        enable row level security;
alter table strength_sets        enable row level security;
alter table daily_metrics        enable row level security;
alter table planned_sessions     enable row level security;
alter table coach_briefings      enable row level security;
alter table integration_tokens   enable row level security;
alter table coach_messages       enable row level security;
alter table goals                enable row level security;
alter table coach_settings       enable row level security;
alter table push_subscriptions   enable row level security;
