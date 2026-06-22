-- Coach persona selector: which pre-set character the athlete picked (and, for humanoid personas,
-- its gender so the prompt agrees in masculine/feminine and the right avatar is shown).
-- The 7 behaviour columns still hold the EFFECTIVE settings (copied from the persona, or hand-tuned
-- in the "expert" profile). persona just drives the avatar + the voice/tics block in the prompt.

alter table coach_settings
  add column persona        text not null default 'bouquetin',
  add column persona_gender text check (persona_gender in ('m','f'));

-- The seeded row keeps the neutral defaults; tag it as the recommended Bouquetin persona.
update coach_settings set persona = 'bouquetin' where id = 1 and persona is null;
