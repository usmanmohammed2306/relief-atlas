ALTER TABLE households ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/Phoenix';
