-- Coach personalization — how the athlete wants the AI coach to behave/communicate.
-- Single-row table (id = 1), mirrors the athlete_profile pattern. Defaults are chosen to be sensible
-- for most athletes; the athlete tunes them from the modal on the /coach page. These prefs are injected
-- into the coach's system prompt (chat + activity comments).

create table coach_settings (
  id                  smallint primary key default 1 check (id = 1),
  verbosity           text not null default 'balanced'    check (verbosity in ('concise','balanced','detailed')),
  tone                text not null default 'encouraging' check (tone in ('encouraging','direct','neutral')),
  demandingness       text not null default 'balanced'    check (demandingness in ('gentle','balanced','demanding')),
  address             text not null default 'tu'          check (address in ('tu','vous')),
  emojis              text not null default 'sparing'     check (emojis in ('none','sparing','liberal')),
  jargon              text not null default 'mixed'       check (jargon in ('plain','mixed','technical')),
  focus               text not null default 'balanced'    check (focus in ('performance','balanced','health_fun')),
  coach_name          text,
  custom_instructions text,
  updated_at          timestamptz not null default now()
);

-- Seed the single row with the defaults so the coach has a baseline persona immediately.
insert into coach_settings (id) values (1) on conflict (id) do nothing;
