/**
 * Centralized table name configuration.
 * Switches between production and dev tables based on SUPABASE_TABLE_PREFIX env var.
 *
 * Production: SUPABASE_TABLE_PREFIX="" (default) → scraped_jobs
 * Development: SUPABASE_TABLE_PREFIX="dev_" → dev_scraped_jobs
 *
 * Add new tables here as the schema grows.
 */

const TABLE_PREFIX = process.env.SUPABASE_TABLE_PREFIX || '';

export const TABLES = {
  scrapedJobs: `${TABLE_PREFIX}scraped_jobs`,
  browserSessions: `${TABLE_PREFIX}browser_sessions`,
  aiUsageLog: `${TABLE_PREFIX}ai_usage_log`,
  schedulerLocks: `${TABLE_PREFIX}scheduler_locks`,
} as const;

/**
 * Returns the table name for scraped_jobs, respecting the dev prefix.
 * Kept for backward compatibility with code that imports this directly.
 */
export function scrapedJobsTable(): string {
  return TABLES.scrapedJobs;
}
