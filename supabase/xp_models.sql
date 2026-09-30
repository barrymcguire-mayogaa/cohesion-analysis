-- COHESION — published xP (expected points) models.
--
-- Run once in the Supabase SQL editor. Until it exists the site keeps using
-- the xP model bundled in cohesion-xp.js (v1.0.0): data.js 'xpModel' returns
-- null and the admin "Refit xP model" page says the table is missing.
--
-- Every publish is a new row (full history, nothing is overwritten).
-- The CURRENT model is the row with the latest made_current_at; rollback just
-- stamps an older row's made_current_at = now() (one atomic update). Clearing
-- made_current_at on every row reverts the site to the bundled v1.
--
-- Access: RLS on with NO policies and no grants for anon/authenticated — only
-- the service role (Netlify functions data.js / gameAdmin.js) can touch it.

create table if not exists public.xp_models (
  id              bigserial primary key,
  version         text        not null unique,            -- 1.1.0, 1.2.0 … (assigned by gameAdmin)
  created_at      timestamptz not null default now(),
  author          text        not null default '',        -- publishing admin's email
  model           jsonb       not null,                   -- exactly the xp_model.json schema
  training        jsonb,                                  -- dataset summary + game fingerprints
  validation      jsonb,                                  -- held-out CV: NEW v CURRENT, calibration, verdict
  notes           text        not null default '',
  made_current_at timestamptz                             -- latest non-null = the model the site uses
);

create index if not exists xp_models_current_idx on public.xp_models (made_current_at desc nulls last);

alter table public.xp_models enable row level security;
revoke all on table public.xp_models from anon, authenticated;
revoke all on sequence public.xp_models_id_seq from anon, authenticated;
