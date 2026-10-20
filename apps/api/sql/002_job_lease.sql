ALTER TABLE jobs ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
