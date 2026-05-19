import 'dotenv/config';
import http from 'http';
import { startAutopilot, runFullCycle, releaseLock } from './scheduler';
import { runMaintenance } from './maintenance';
import { startBot } from '../telegram/bot';
import { supabase } from '../config/db';
import cron from 'node-cron';
import { agentConfig } from '../config/agentConfig';
import { notifyTelegram } from '../telegram/notifier';

const { cronEvery15Min: CRON_EVERY_15_MIN, cronMidnight: CRON_MIDNIGHT } = agentConfig.scheduler;

async function dryRun(): Promise<void> {
  console.log('=== Autopilot Dry-Run Check ===\n');

  // 1. Test lock mechanism
  console.log('1) Testing concurrency lock...');
  const { data: lock } = await supabase
    .from('scheduler_lock')
    .select('*')
    .single();
  console.log(`   Lock status: ${lock?.last_run_status ?? 'N/A'}`);

  // 2. Test cron expression registration (dry)
  console.log('2) Cron expressions valid:');
  console.log(`   15-min: ${cron.validate(CRON_EVERY_15_MIN) ? 'OK' : 'FAIL'}`);
  console.log(`   Midnight: ${cron.validate(CRON_MIDNIGHT) ? 'OK' : 'FAIL'}`);

  // 3. Check tables exist
  console.log('4) DB tables:');
  const { count: lockCount } = await supabase
    .from('scheduler_lock')
    .select('id', { count: 'exact', head: true });
  const { count: logCount } = await supabase
    .from('system_log')
    .select('id', { count: 'exact', head: true });
  console.log(`   scheduler_lock: ${lockCount !== null ? 'OK' : 'FAIL'} (${lockCount} rows)`);
  console.log(`   system_log: ${logCount !== null ? 'OK' : 'FAIL'} (${logCount} rows)`);

  console.log('\n=== Dry-run complete. System ready for autopilot. ===');
}

async function handleShutdown(signal: string): Promise<void> {
  console.log(`\n[Autopilot] Received ${signal}. Gracefully shutting down...`);
  try {
    // Attempt to release the lock
    await releaseLock('shutdown');
    console.log('[Autopilot] System gracefully stopped.');
  } catch (err) {
    console.error('[Autopilot] Error during graceful shutdown:', err);
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

const mode = process.argv[2];

switch (mode) {
  case 'start':
    startAutopilot();
    break;
  case 'production': {
    console.log('[Production] Starting scheduler + Telegram bot...\n');

    // Health HTTP server for Docker HEALTHCHECK / Zeabur health checks
    const PORT = parseInt(process.env.PORT || '8080', 10);
    const server = http.createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    server.listen(PORT, () => console.log(`[Health] HTTP health endpoint on :${PORT}`));

    startAutopilot();
    startBot().catch(err => {
      console.error('[Bot] Unhandled error:', err.message);
    });
    notifyTelegram('🚀 *Production mode activated*\nScheduler + Telegram bot listener running.');
    break;
  }
  case 'bot':
    startBot().catch(err => {
      console.error('[Bot] Unhandled error:', err.message);
      process.exit(1);
    });
    break;
  case 'cycle':
    runFullCycle().catch(console.error).finally(() => process.exit(0));
    break;
  case 'maintenance':
    runMaintenance().catch(console.error).finally(() => process.exit(0));
    break;
  case 'dryrun':
    dryRun().catch(console.error).finally(() => process.exit(0));
    break;
  default:
    console.log('Usage: npx ts-node src/cron/index.ts [start|production|bot|cycle|maintenance|dryrun]');
    console.log('  start       - Start autopilot (15-min cycles + midnight maintenance)');
    console.log('  production  - Start autopilot + Telegram Bot listener (for Docker/cloud)');
    console.log('  bot         - Start Telegram Bot listener');
    console.log('  cycle       - Run one full scrape+analysis cycle immediately');
    console.log('  maintenance - Run maintenance tasks immediately');
    console.log('  dryrun      - Verify setup without running');
    process.exit(0);
}
