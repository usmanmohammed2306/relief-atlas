CREATE TABLE IF NOT EXISTS app_users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS households (
  id text PRIMARY KEY,
  name text NOT NULL,
  care_recipient_name text NOT NULL,
  timezone text NOT NULL DEFAULT 'America/Phoenix',
  consent_attested_at timestamptz NOT NULL,
  created_by text NOT NULL REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS memberships (
  id text PRIMARY KEY,
  household_id text NOT NULL REFERENCES households(id),
  user_id text REFERENCES app_users(id),
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('organizer','helper')),
  status text NOT NULL CHECK (status IN ('pending','active','removed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id,email)
);
CREATE TABLE IF NOT EXISTS helper_preferences (
  membership_id text PRIMARY KEY REFERENCES memberships(id),
  task_types text[] NOT NULL DEFAULT '{}',
  quiet_start integer NOT NULL DEFAULT 22 CHECK (quiet_start BETWEEN 0 AND 23),
  quiet_end integer NOT NULL DEFAULT 7 CHECK (quiet_end BETWEEN 0 AND 23),
  timezone text NOT NULL DEFAULT 'America/Phoenix',
  opted_in boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS coverage_requests (
  id text PRIMARY KEY,
  household_id text NOT NULL REFERENCES households(id),
  organizer_id text NOT NULL REFERENCES app_users(id),
  type text NOT NULL CHECK (type IN ('meal','visit','ride')),
  title text NOT NULL,
  brief text NOT NULL,
  instructions text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  due_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('seeking','accepted','helper_reported_done','confirmed_done','uncovered','cancelled','disputed')),
  accepted_by text REFERENCES app_users(id),
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organizer_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS coverage_household_due ON coverage_requests(household_id,due_at);
CREATE TABLE IF NOT EXISTS request_drafts (
  id text PRIMARY KEY,
  household_id text NOT NULL REFERENCES households(id),
  organizer_id text NOT NULL REFERENCES app_users(id),
  input_text text NOT NULL,
  payload jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS offers (
  id text PRIMARY KEY,
  request_id text NOT NULL REFERENCES coverage_requests(id),
  membership_id text NOT NULL REFERENCES memberships(id),
  wave integer NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','sent','accepted','declined','expired','cancelled','delivery_failed')),
  sent_at timestamptz,
  responded_at timestamptz,
  UNIQUE(request_id,membership_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_accepted_offer_per_request ON offers(request_id) WHERE status = 'accepted';
CREATE TABLE IF NOT EXISTS events (
  id text PRIMARY KEY,
  request_id text REFERENCES coverage_requests(id),
  household_id text NOT NULL REFERENCES households(id),
  actor_id text REFERENCES app_users(id),
  kind text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_household_time ON events(household_id,created_at DESC);
CREATE TABLE IF NOT EXISTS notifications (
  id text PRIMARY KEY,
  household_id text NOT NULL REFERENCES households(id),
  user_id text NOT NULL REFERENCES app_users(id),
  request_id text REFERENCES coverage_requests(id),
  kind text NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
CREATE TABLE IF NOT EXISTS jobs (
  id text PRIMARY KEY,
  kind text NOT NULL,
  payload jsonb NOT NULL,
  run_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed')),
  claimed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_ready ON jobs(status,run_at);
