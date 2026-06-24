-- Coach WRITE proposals (the "coach can change my plan / activities" epic). The conversational coach
-- never writes directly: a `propose_*` tool emits a PENDING proposal here; the athlete validates it from
-- a card in the chat, and only then does an accept action commit through the existing write paths.
-- Additive + inert until the new code lands (so the app behaves identically until then).

create table coach_proposals (
  id                uuid primary key default gen_random_uuid(),
  -- The coach chat turn that raised this proposal (so the timeline renders the card under that bubble).
  -- Nullable + on delete set null: deleting a message must not cascade-delete the proposal audit.
  coach_message_id  uuid references coach_messages(id) on delete set null,
  kind              text not null check (kind in ('session','event','delete','activity_edit','reshape')),
  status            text not null default 'pending'
                      check (status in ('pending','accepted','dismissed','superseded')),
  -- The proposed change: { payload, target_planned_id?, target_activity_id?, expected_fingerprint?,
  -- regen_week? }. payload mirrors the propose_* tool input (sport_code, targets, rationale, …).
  operations        jsonb not null,
  summary           text,             -- short FR summary for the card header / fallback
  simulation        jsonb,            -- optional snapshot of the form impact shown on the card (cas 2)
  committed_ids     uuid[],           -- planned_sessions / activities written on accept (audit)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index coach_proposals_message_idx on coach_proposals (coach_message_id);
create index coach_proposals_status_idx  on coach_proposals (status);

-- set_updated_at() helper defined in 20260619000001_init.sql.
create trigger trg_coach_proposals_updated before update on coach_proposals
  for each row execute function set_updated_at();

-- RLS deny-all to anon/authenticated (the app reads/writes via the service-role client, BYPASSRLS),
-- matching 20260623000001_enable_rls.sql. No policy added → those public roles are denied all rows.
alter table coach_proposals enable row level security;

-- planned_sessions provenance + the PINNED anchor flag. A coach session the athlete accepted via chat is
-- written modified_by='user' (so the briefing-regen delete, scoped to modified_by='coach', never clobbers
-- it) with is_pinned=true so the regen treats it as a fixed anchor to plan AROUND — like a declared event,
-- but it is a PRESCRIPTION (target_*) not an event estimate (predicted_*), so is_pinned stays distinct from
-- is_event. All defaults keep existing rows inert until the new code writes these columns.
alter table planned_sessions
  add column if not exists is_pinned   boolean not null default false,
  add column if not exists source      text,            -- 'coach_proposal' | 'briefing' | 'declared'
  add column if not exists proposal_id uuid references coach_proposals(id) on delete set null;

comment on column planned_sessions.is_pinned is
  'true = a coach session the athlete accepted via chat. modified_by=user (immune to the regen delete) and treated as a fixed anchor like a declared event, but a prescription (target_*), not an event (predicted_*).';
