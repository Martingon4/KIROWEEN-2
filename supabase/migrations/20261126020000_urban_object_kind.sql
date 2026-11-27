-- Add the enum in its own migration so PostgreSQL can use it after commit.
alter type public.intervention_kind add value 'urban_object';
