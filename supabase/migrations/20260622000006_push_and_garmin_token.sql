-- Massif — phone access (Phase 9 groundwork): web-push subscriptions + portable Garmin token.
--
-- Two unrelated needs for moving off the Mac, batched into one migration:
--   1. push_subscriptions — the iPhone's home-screen PWA registers a Web Push endpoint here so the
--      coach can notify the athlete each morning. One row per browser/device endpoint.
--   2. integration_tokens.data — the Garmin OAuth token is a small JSON blob the garminconnect lib
--      caches on disk (~/.garminconnect/garmin_tokens.json). To run the nightly pull in the cloud
--      (no Mac), we mirror that blob here verbatim (provider='garmin') and rehydrate it in CI, so the
--      MFA-gated first login is done ONCE locally and the refresh-token rotation is persisted back.
--
-- Still single-user / RLS-OFF: access is gated by the app's login + service-role server reads.

-- ─────────────────────────────────────────────────────────────────────────────
-- push_subscriptions — W3C PushSubscription endpoints (one per installed device/browser).
-- The endpoint URL is the natural key (re-subscribing updates keys in place). p256dh + auth are
-- the client's encryption keys the sender (coach) needs for the VAPID-signed payload.
-- ─────────────────────────────────────────────────────────────────────────────
create table push_subscriptions (
  endpoint                 text primary key,
  p256dh                   text not null,
  auth                     text not null,
  user_agent               text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create trigger trg_push_subscriptions_updated before update on push_subscriptions
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- integration_tokens.data — full provider token blob, stored verbatim so a format we don't model
-- column-by-column (Garmin's di_token / di_refresh_token / di_client_id) survives round-trips and
-- future lib changes. Garmin uses this; Strava keeps using the discrete columns.
-- ─────────────────────────────────────────────────────────────────────────────
alter table integration_tokens add column data jsonb;
