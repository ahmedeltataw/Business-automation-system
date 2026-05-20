-- Add advanced lead-scoring metadata columns to scraped_jobs
-- Run this in Supabase SQL Editor

ALTER TABLE scraped_jobs
  ADD COLUMN IF NOT EXISTS execution_time text,
  ADD COLUMN IF NOT EXISTS proposals_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS client_hiring_rate text,
  ADD COLUMN IF NOT EXISTS client_notes text,
  ADD COLUMN IF NOT EXISTS ai_lead_score_warning text;
