-- Briefing mode: the athlete chooses (in the Profil) how the daily briefing is generated.
--   'free' = 100 % algorithmic (web/src/lib/briefing-algo.ts) — ZERO LLM tokens (default).
--   'ai'   = same algorithmic plan, then ONE small cached LLM call re-voices three text fields in the
--            coach persona's voice (web/src/lib/coach-briefing.ts enrichBriefingWithLLM).
-- This governs ONLY the briefing; the conversational chat stays AI-on-demand in both modes.
-- Additive + safe: existing rows default to 'free' (cheapest), so behaviour is free-mode until opted in.
alter table coach_settings
  add column if not exists briefing_mode text not null default 'free'
  check (briefing_mode in ('free', 'ai'));
