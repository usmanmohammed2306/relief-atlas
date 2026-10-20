CREATE TABLE IF NOT EXISTS atlas_plans (
  id text PRIMARY KEY,
  household_id text NOT NULL REFERENCES households(id),
  organizer_id text NOT NULL REFERENCES app_users(id),
  source_text text NOT NULL,
  payload jsonb NOT NULL,
  digest text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved')),
  expires_at timestamptz NOT NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE coverage_requests ADD COLUMN IF NOT EXISTS plan_id text REFERENCES atlas_plans(id);
ALTER TABLE coverage_requests ADD COLUMN IF NOT EXISTS plan_task_index integer;
CREATE UNIQUE INDEX IF NOT EXISTS coverage_plan_task ON coverage_requests(plan_id,plan_task_index) WHERE plan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS atlas_plans_household ON atlas_plans(household_id,created_at DESC);
ALTER TABLE offers DROP CONSTRAINT IF EXISTS offers_status_check;
ALTER TABLE offers ADD CONSTRAINT offers_status_check CHECK (status IN ('queued','sent','simulated','in_app_available','accepted','declined','expired','cancelled','delivery_failed'));
ALTER TABLE offers ADD COLUMN IF NOT EXISTS message_subject text;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS message_html text;
