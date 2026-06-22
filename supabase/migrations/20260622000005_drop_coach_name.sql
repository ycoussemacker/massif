-- The coach's name is now fixed by the chosen persona (Gaston, Génie, Maud…), no longer free-typed.
-- Drop the obsolete custom-name column.
alter table coach_settings drop column if exists coach_name;
