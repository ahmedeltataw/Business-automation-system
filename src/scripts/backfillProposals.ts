/**
 * Backfill Proposals
 *
 * One-time script to generate AI proposals for existing high-score jobs
 * that were analyzed before the proposal-generation feature was added.
 * Processes up to 50 jobs per run.
 */

import { supabase, TABLES } from '../config/db';
import { generateProposal } from '../ai/proposalGenerator';
import { notifyTelegram } from '../telegram/notifier';
import { agentConfig } from '../config/agentConfig';

async function main() {
  console.log('=== Backfilling Proposals ===\n');
  const { data: jobs, error } = await supabase
    .from(TABLES.scrapedJobs)
    .select('id, title, description, platform, budget, client_name, ai_score, ai_project_type, ai_tech_stack, ai_client_pain_points, ai_budget_suitability, ai_estimated_effort, ai_summary_ar, ai_recommended_sales_angle')
    .gte('ai_score', agentConfig.scoring.proposalMinScore)
    .is('ai_proposal_text', null)
    .limit(50);

  if (error || !jobs?.length) {
    console.log(error ? `Error: ${error.message}` : 'No jobs needing backfill.');
    return;
  }
  console.log(`Found ${jobs.length} jobs needing proposals\n`);

  let generated = 0;
  for (const job of jobs) {
    const analysis = {
      score: job.ai_score, project_type: job.ai_project_type || 'Full-Stack',
      tech_stack: (() => { try { return JSON.parse(job.ai_tech_stack || '[]'); } catch { return []; } })(),
      client_pain_points: (() => { try { return JSON.parse(job.ai_client_pain_points || '[]'); } catch { return []; } })(),
      budget_suitability: job.ai_budget_suitability || 'Medium',
      estimated_effort: job.ai_estimated_effort || 'Medium',
      recommended_sales_angle: job.ai_recommended_sales_angle || '',
      summary_ar: job.ai_summary_ar || '',
    };
    try {
      const proposal = await generateProposal(job, analysis);
      if (!proposal) { console.log(`  Skipped (models exhausted): ${job.title.slice(0,60)}`); break; }
      await supabase.from(TABLES.scrapedJobs).update({
        ai_proposal_text: proposal,
        ai_proposal_generated_at: new Date().toISOString(),
      }).eq('id', job.id);
      generated++;
      console.log(`  [${generated}] Proposal generated for: ${job.title.slice(0,60)}`);
    } catch (err: any) {
      console.error(`  Failed: ${job.title.slice(0,60)} — ${err.message}`);
    }
  }
  console.log(`\n✅ Generated ${generated} proposals`);
  await notifyTelegram(`📝 *Proposal Backfill*\nGenerated ${generated} proposals for existing high-score jobs.`);
}
main().catch(e => console.error('Fatal:', e));
