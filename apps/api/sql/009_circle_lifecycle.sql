ALTER TABLE households ADD COLUMN IF NOT EXISTS closed_at timestamptz;
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_status_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_status_check CHECK (status IN ('pending','running','done','failed','cancelled'));
