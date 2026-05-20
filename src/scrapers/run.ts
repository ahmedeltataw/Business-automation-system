/**
 * GitHub Actions Scraper Entry
 *
 * Thin wrapper that triggers a full scrape + analysis cycle.
 * Used by GitHub Actions scheduled workflows for headless execution.
 */

import 'dotenv/config';
import { runFullCycle } from '../cron/scheduler';

async function main() {
  console.log('=== GH Actions — Full Scraper Cycle ===\n');
  await runFullCycle();
  console.log('\n=== Cycle complete. Exiting. ===');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
}).finally(() => {
  process.exit(0);
});
