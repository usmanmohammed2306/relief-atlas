ALTER TABLE atlas_plans ADD COLUMN IF NOT EXISTS proposal_metadata jsonb NOT NULL DEFAULT '{}';
ALTER TABLE atlas_plans ADD COLUMN IF NOT EXISTS proposal_key text UNIQUE;
CREATE TABLE IF NOT EXISTS model_budget (
  day text PRIMARY KEY,
  calls integer NOT NULL DEFAULT 0 CHECK (calls>=0),
  reserved_micros bigint NOT NULL DEFAULT 0 CHECK (reserved_micros>=0)
);
CREATE TABLE IF NOT EXISTS model_calls (
  id text PRIMARY KEY,
  household_id text NOT NULL REFERENCES households(id),
  actor_id text NOT NULL REFERENCES app_users(id),
  input_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','complete','failed')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
