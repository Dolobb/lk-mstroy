ALTER TABLE analytics.track_sessions ADD COLUMN IF NOT EXISTS visited_objects text[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_track_sessions_visited_objects
  ON analytics.track_sessions USING GIN (visited_objects);
