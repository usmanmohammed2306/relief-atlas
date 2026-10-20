ALTER TABLE jobs ADD COLUMN IF NOT EXISTS lease_token text;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS delivery_mode text;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS recipient_email text;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS delivery_generation integer NOT NULL DEFAULT 0;
ALTER TABLE atlas_plans ADD COLUMN IF NOT EXISTS delivery_mode text NOT NULL DEFAULT 'in_app';
ALTER TABLE atlas_plans ADD COLUMN IF NOT EXISTS review_snapshot jsonb NOT NULL DEFAULT '[]';
ALTER TABLE atlas_plans ADD COLUMN IF NOT EXISTS recovery_source_id text REFERENCES coverage_requests(id);
