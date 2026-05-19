import { supabase } from '../config/db';
import { notifyTelegram } from '../telegram/notifier';
import { getTotalUsageToday } from '../ai/usageTracker';

export async function runMaintenance(): Promise<void> {
  console.log('\n=== Midnight Maintenance ===\n');
  const startTime = Date.now();

  try {
    // Step 1: Archive jobs older than 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: archived, error: archiveError } = await supabase
      .from('scraped_jobs')
      .update({ status: 'archived', updated_at: new Date().toISOString() })
      .eq('status', 'analyzed')
      .lt('created_at', sevenDaysAgo)
      .select('id');

    if (archiveError) {
      console.error(`[Maintenance] Archive error: ${archiveError.message}`);
    } else {
      console.log(`  ✓ Archived ${archived?.length ?? 0} analyzed jobs older than 7 days`);
    }

    // Step 2: Clean very old archived jobs (older than 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { error: purgeError } = await supabase
      .from('scraped_jobs')
      .delete()
      .eq('status', 'archived')
      .lt('created_at', thirtyDaysAgo);

    if (purgeError) {
      console.error(`[Maintenance] Purge error: ${purgeError.message}`);
    }

    // Step 3: Reset daily usage log (table stays, but it's just log data)
    // We keep the log but it's self-resetting by date

    // Step 4: Collect telemetry for today
    const aiUsage = await getTotalUsageToday();

    const { count: totalJobs } = await supabase
      .from('scraped_jobs')
      .select('id', { count: 'exact', head: true });

    const { count: newJobs } = await supabase
      .from('scraped_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'new');

    const { count: analyzedJobs } = await supabase
      .from('scraped_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'analyzed');

    const { count: archivedCount } = await supabase
      .from('scraped_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'archived');

    const details = {
      total_jobs: totalJobs ?? 0,
      new_jobs: newJobs ?? 0,
      analyzed_jobs: analyzedJobs ?? 0,
      archived_jobs: archivedCount ?? 0,
      archived_this_run: archived?.length ?? 0,
      ai_usage: Object.fromEntries(
        Object.entries(aiUsage).map(([m, i]) => [m, `${i.used}/${i.limit}`])
      ),
    };

    // Log to system_log
    const { error: logError } = await supabase.from('system_log').insert({
      event_type: 'daily_maintenance',
      summary: `Archived ${archived?.length ?? 0} jobs, ${newJobs ?? 0} new pending`,
      details,
    });

    if (logError) {
      console.error(`[Maintenance] system_log error: ${logError.message}`);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    // Send Telegram summary
    const lines = [
      `🌙 *Daily Maintenance Complete*`,
      ``,
      `📦 Jobs: ${totalJobs ?? 0} total | ${newJobs ?? 0} new | ${analyzedJobs ?? 0} analyzed | ${archivedCount ?? 0} archived`,
      `🗂️ Archived today: ${archived?.length ?? 0}`,
      `⏱️ Duration: ${duration}s`,
      ``,
      `🤖 *AI Usage Today:*`,
    ];

    for (const [model, info] of Object.entries(aiUsage)) {
      const label = model.includes('gemma') ? `Gemma ${model.split('-')[2]}` :
        model.includes('gemini') ? `Gemini ${model.split('-')[1]}` :
        model.includes('groq') ? 'Groq' : model;
      lines.push(`  • ${label}: ${info.used}/${info.limit === 999999 ? '∞' : info.limit}`);
    }

    await notifyTelegram(lines.join('\n'));

    console.log(`\n✅ Maintenance complete in ${duration}s`);
  } catch (err: any) {
    console.error(`[Maintenance] Fatal error: ${err.message}`);
    await notifyTelegram(`⚠️ *Maintenance Failed*\n${err.message}`);
  }
}
