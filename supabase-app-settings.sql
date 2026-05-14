-- ============================================================================
-- App Settings Table Migration
-- Run this in your Supabase SQL Editor to create the settings table
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Enable Row Level Security (allow public read/write for this app)
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read" ON app_settings
  FOR SELECT USING (true);

CREATE POLICY "Allow public insert" ON app_settings
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public update" ON app_settings
  FOR UPDATE USING (true);

-- Seed default preferences
INSERT INTO app_settings (key, value)
VALUES
  ('show_officers_list', 'true'),
  ('hide_names', 'false')
ON CONFLICT (key) DO NOTHING;
