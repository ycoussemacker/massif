-- Traces d'exécution de l'agent conversationnel — une ligne par TOUR.
--
-- Pourquoi : jusqu'ici seul le texte final était persisté (coach_messages). Impossible de répondre à
-- « quels outils a-t-il appelés, avec quels arguments, en combien d'itérations, et pour quel coût ? ».
-- Sans ça, ni débogage, ni métrique citable, ni « trace d'exécution réelle » à montrer.
--
-- Additive et inerte : rien ne lit cette table pour décider quoi que ce soit ; l'écriture est
-- best-effort et n'interrompt jamais la réponse à l'athlète.

create table coach_agent_traces (
  id                uuid primary key default gen_random_uuid(),
  -- Le tour de chat correspondant, quand il y en a un (la CLI et les évals n'en ont pas).
  coach_message_id  uuid references coach_messages(id) on delete set null,
  source            text not null default 'chat'
                      check (source in ('chat', 'activity_comment', 'cli', 'eval')),
  question          text not null,
  model             text,
  iterations        smallint not null default 0,
  stop_reason       text,
  -- [{ i, tool, input, ok, error }] — l'argument EXACT passé à chaque outil, dans l'ordre d'appel.
  steps             jsonb not null default '[]'::jsonb,
  answer            text,
  -- { input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens, calls }
  usage             jsonb,
  -- Coût estimé en micro-dollars (entier : pas d'arrondi flottant qui s'accumule sur un agrégat).
  cost_micro_usd    integer,
  latency_ms        integer,
  created_at        timestamptz not null default now()
);

create index coach_agent_traces_created_idx on coach_agent_traces (created_at desc);
create index coach_agent_traces_message_idx on coach_agent_traces (coach_message_id);

comment on table coach_agent_traces is
  'Une ligne par tour de l''agent : question, outils appelés avec leurs arguments, itérations, réponse, tokens, coût estimé, latence. Audit + métriques ; jamais lue pour décider.';

-- RLS deny-all à anon/authenticated, comme toutes les tables publiques (voir 20260623000001) : la
-- trace contient la question de l'athlète et sa réponse.
alter table coach_agent_traces enable row level security;
