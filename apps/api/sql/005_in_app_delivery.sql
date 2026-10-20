ALTER TABLE offers DROP CONSTRAINT offers_status_check;
ALTER TABLE offers ADD CONSTRAINT offers_status_check CHECK (status IN ('queued','sent','simulated','in_app_available','accepted','declined','expired','cancelled','delivery_failed'));
