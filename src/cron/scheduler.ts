import cron from 'node-cron';
import { supabase } from '../config/db';
import { notifyTelegram } from '../telegram/notifier';
import { scrapeMostaql } from '../automation/scrapers/mostaqlScraper';
import { scrapeKhamsat } from '../automation/scrapers/khamsatScraper';
import { SessionExpiredError } from '../automation/sessionManager';
import { runAnalysisPipeline } from '../ai/pipeline';
import { runMaintenance } from './maintenance';
import { agentConfig } from '../config/agentConfig';

const { cronEvery15Min: CRON_EVERY_15_MIN, cronMidnight: CRON_MIDNIGHT, lockTimeoutMinutes: LOCK_TIMEOUT_MINUTES } = agentConfig.scheduler;

async function acquireLock(): Promise<boolean> {
  const staleCutoff = new Date(Date.now() - LOCK_TIMEOUT_MINUTES * 60 * 1000).toISOString();

  // Force-release stale locks first
  const { error: staleError } = await supabase
    .from('scheduler_lock')
    .update({
      is_running: false,
      last_run_status: 'stale',
      last_run_end: new Date().toISOString(),
    })
    .eq('id', 'main')
    .eq('is_running', true)
    .lt('last_run_start', staleCutoff);

  if (staleError) {
    console.error(`[Scheduler] Stale lock cleanup error: ${staleError.message}`);
  }

  // Try to acquire
  const { data, error } = await supabase
    .from('scheduler_lock')
    .update({
      is_running: true,
      last_run_start: new Date().toISOString(),
      last_run_status: 'running',
      locked_by: `pid-${process.pid}`,
    })
    .eq('id', 'main')
    .eq('is_running', false)
    .select()
    .single();

  if (error) {
    console.error(`[Scheduler] Lock acquire error: ${error.message}`);
    return false;
  }

  return data !== null;
}

export async function releaseLock(status: string): Promise<void> {
  await supabase
    .from('scheduler_lock')
    .update({
      is_running: false,
      last_run_end: new Date().toISOString(),
      last_run_status: status,
    })
    .eq('id', 'main');
}

function logSystemEvent(type: string, summary: string, details?: Record<string, unknown>): void {
  supabase.from('system_log').insert({
    event_type: type,
    summary,
    details: details ?? {},
  }).then(({ error }) => {
    if (error) console.error(`[SystemLog] insert error: ${error.message}`);
  });
}

async function runFullCycle(): Promise<void> {
  const acquired = await acquireLock();
  if (!acquired) {
    console.log(`[Scheduler] ${new Date().toISOString()} — Previous run still active, skipping.`);
    logSystemEvent('scheduler_skip', 'Previous run still active');
    return;
  }

  const startTime = Date.now();
  console.log(`\n${'='.repeat(50)}`);
  console.log(`[Scheduler] Cycle started at ${new Date().toISOString()}`);
  console.log('='.repeat(50));

  let status = 'success';
  const platformResults: Record<string, number> = {};

  try {
    // Step 1: Scrape all platforms
    const scrapers = [
      ['mostaql', scrapeMostaql],
      ['khamsat', scrapeKhamsat],
    ] as const;

    let totalScraped = 0;
    for (const [name, fn] of scrapers) {
      try {
        console.log(`\n[${name}] Starting scrape...`);
        const results = await fn();
        platformResults[name] = results.length;
        totalScraped += results.length;
        console.log(`[${name}] Done: ${results.length} items`);
      } catch (err: any) {
        if (err instanceof SessionExpiredError) {
          console.error(`[${name}] Session expired — skipped`);
          platformResults[name] = -1;
        } else {
          console.error(`[${name}] Error: ${err.message}`);
          platformResults[name] = -2;
        }
      }
    }

    console.log(`\nTotal scraped: ${totalScraped}`);

    // Step 2: Run AI pipeline
    const { analyzed, highScore } = await runAnalysisPipeline();

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const summary = `Scraped ${totalScraped}, analyzed ${analyzed}, ${highScore} high-score`;
    console.log(`\n[Scheduler] Cycle complete in ${duration}s — ${summary}`);

    logSystemEvent('scheduler_cycle', summary, {
      duration_seconds: parseFloat(duration),
      scraped: totalScraped,
      analyzed,
      high_score: highScore,
      platform_results: platformResults,
    });

  } catch (err: any) {
    status = 'error';
    console.error(`[Scheduler] Cycle failed: ${err.message}`);
    logSystemEvent('scheduler_error', err.message);
  } finally {
    await releaseLock(status);
  }
}

export function startAutopilot(): void {
  console.log('[Scheduler] Starting autopilot...\n');

  cron.schedule(CRON_EVERY_15_MIN, () => {
    runFullCycle().catch(err => {
      console.error('[Scheduler] Unhandled error:', err.message);
    });
  });

  cron.schedule(CRON_MIDNIGHT, () => {
    runMaintenance().catch(err => {
      console.error('[Maintenance] Unhandled error:', err.message);
    });
  });

  console.log(`  ✓ Scrape cycle: every 15 min (${CRON_EVERY_15_MIN})`);
  console.log(`  ✓ Maintenance: daily midnight (${CRON_MIDNIGHT})`);
  console.log(`  ✓ Lock timeout: ${LOCK_TIMEOUT_MINUTES} min\n`);

  const now = new Date().toLocaleString('en-EG', { timeZone: 'Africa/Cairo' });
  console.log(`[Scheduler] Autopilot live at ${now} (Cairo time)`);

  notifyTelegram(`🤖 *Autopilot Activated*
  • Scrape + AI analysis every 15 min
  • Maintenance daily at midnight
  • Lock timeout: ${LOCK_TIMEOUT_MINUTES} min`);

  logSystemEvent('autopilot_start', 'Autopilot scheduler started', {
    cron_scrape: CRON_EVERY_15_MIN,
    cron_maintenance: CRON_MIDNIGHT,
    lock_timeout_minutes: LOCK_TIMEOUT_MINUTES,
  });

  // Keep process alive if this is the main entry
  if (process.env.AUTOPILOT_KEEP_ALIVE === 'true') {
    console.log('[Scheduler] Running in keep-alive mode. Press Ctrl+C to stop.');
  }
}

export { runFullCycle };
