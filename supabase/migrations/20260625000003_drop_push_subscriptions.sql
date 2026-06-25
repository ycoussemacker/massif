-- Web push is retired (the morning cron + notification are gone — the briefing is now on-demand only).
-- Drop the push subscriptions table. IMPORTANT: this does NOT touch the Garmin token mirror in
-- integration_tokens (added by the SAME original migration 20260622000006) — that stays, the cloud
-- Garmin refresh still needs it.
drop table if exists push_subscriptions;
