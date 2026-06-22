-- Conversation chat with the coach (Phase 7+).
-- The timeline shown in the /coach page is a READ-TIME merge of three sources:
--   coach_briefings (the daily briefings) + activities (logged sessions) + this table.
-- So this table holds only the genuine chat turns — free-text Q&A and on-demand activity
-- comments — never a duplicate of briefings/activities (those stay the source of truth).

create table coach_messages (
  id           uuid primary key default gen_random_uuid(),
  role         text not null check (role in ('user','coach')),
  -- 'chat'             : free-text Q&A
  -- 'activity_comment' : the on-demand "comment my activities" exchange
  kind         text not null default 'chat' check (kind in ('chat','activity_comment')),
  content      text not null,
  briefing_id  uuid references coach_briefings(id) on delete set null,  -- briefing the comment grounds on
  activity_ids uuid[],                                                  -- activities a comment refers to
  model        text,                                                    -- model that produced a coach turn
  created_at   timestamptz not null default now()
);

create index coach_messages_created_idx on coach_messages (created_at);
