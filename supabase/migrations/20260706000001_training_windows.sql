-- Fenêtres de contrainte (périodisation personnalisée — Upgrade 10).
-- L'athlète déclare une période de vie qui contraint l'entraînement (déplacement, terrain plat,
-- semaine chargée…) : le moteur de plan REPORTE les décharges calendaires dessus (« on charge avant,
-- on encaisse pendant »), charge le D+ avant une fenêtre sans montagne, et adapte les séances pendant
-- (qualité → seuil sur plat). Lues par le briefing/chat (coach-context) et affichées dans l'agenda.
create table if not exists public.training_windows (
  id uuid primary key default gen_random_uuid(),
  starts_on date not null,
  ends_on date not null,
  label text not null,
  -- Intention sur la période : comment le plan doit la traiter.
  --   auto     = dérivée des drapeaux (capacité réduite + ≥5 j → décharge, sinon entretien)
  --   deload   = on encaisse (volume ×0.65, une qualité max)
  --   maintain = entretien (volume ×0.85, pas de rampe)
  --   charge   = bloc assumé (stage) : plan normal, rampe active
  effect text not null default 'auto' check (effect in ('auto', 'deload', 'maintain', 'charge')),
  -- Drapeaux de capacité : ce que la période rend impossible/difficile.
  no_mountains boolean not null default false,   -- pas de montagne (D+/D− impossibles)
  limited_hills boolean not null default false,  -- très peu de côtes possibles
  reduced_volume boolean not null default false, -- temps d'entraînement réduit
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);

-- RLS : même posture que le reste du schéma (deny-all à l'anon ; l'app passe par le service-role).
alter table public.training_windows enable row level security;
