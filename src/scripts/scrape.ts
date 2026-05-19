import { scrapeMostaql } from '../automation/scrapers/mostaqlScraper';
import { scrapeKhamsat } from '../automation/scrapers/khamsatScraper';
import { notifyTelegram } from '../telegram/notifier';
import { SessionExpiredError } from '../automation/sessionManager';
import { runAnalysisPipeline } from '../ai/pipeline';

interface ScrapeResult {
  platform: string;
  count: number;
  error?: string;
}

async function runScraper<T>(
  platform: string,
  fn: () => Promise<T[]>
): Promise<ScrapeResult> {
  try {
    console.log(`\n[${platform}] Starting scrape...`);
    const results = await fn();
    console.log(`[${platform}] Completed: ${results.length} items found`);
    return { platform, count: results.length };
  } catch (err: any) {
    if (err instanceof SessionExpiredError) {
      console.error(`[${platform}] Session expired — skipping`);
      return { platform, count: 0, error: 'Session expired' };
    }
    console.error(`[${platform}] Error:`, err.message ?? err);
    return { platform, count: 0, error: err.message ?? String(err) };
  }
}

async function main() {
  console.log('=== Hsoub Scraper Run ===\n');

  const results: ScrapeResult[] = [];

  results.push(await runScraper('mostaql', scrapeMostaql));
  results.push(await runScraper('khamsat', scrapeKhamsat));

  console.log('\n=== Summary ===');
  let total = 0;
  for (const r of results) {
    const status = r.error ? `❌ ${r.error}` : `✅ ${r.count} items`;
    console.log(`  ${r.platform}: ${status}`);
    total += r.count;
  }
  console.log(`\nTotal items scraped: ${total}`);

  const failures = results.filter((r) => r.error);
  if (failures.length > 0) {
    const failSummary = failures.map((f) => `• ${f.platform}: ${f.error}`).join('\n');
    try {
      await notifyTelegram(
        `📊 *Scrape Run Complete*\nTotal: ${total} items\nFailures:\n${failSummary}`
      );
    } catch (err) {
      console.error('[Scrape] Telegram notification failed:', err);
    }
  }
 
  // Step 2: Run AI analysis pipeline on all new jobs
  const { analyzed, highScore } = await runAnalysisPipeline();
  try {
    await notifyTelegram(
      `🤖 *AI Pipeline Complete*\nAnalyzed: ${analyzed} jobs\nHigh-score alerts: ${highScore}`
    );
  } catch (err) {
    console.error('[Pipeline] Telegram notification failed:', err);
  }
}


main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
