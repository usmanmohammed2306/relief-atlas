ALTER TABLE helper_preferences ADD COLUMN unavailable_dates jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE helper_preferences ADD CONSTRAINT helper_unavailable_dates_array CHECK (jsonb_typeof(unavailable_dates) = 'array' AND jsonb_array_length(unavailable_dates) <= 60);
