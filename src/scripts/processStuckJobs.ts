/**
 * Process Stuck Jobs
 *
 * One-time script to analyze and process jobs stuck in 'new' status.
 * Runs AI scoring and proposal generation on all pending jobs up to the
 * configured batch size.
 */

import { supabase, TABLES } from '../config/db';
import { aiRouter, AllModelsExhaustedError } from '../ai/router';
import { generateProposal } from '../ai/proposalGenerator';
import { notifyTelegram } from '../telegram/notifier';
import { agentConfig } from '../config/agentConfig';

async function main() {
  console.log('=== Processing Stuck New Jobs ===\n');
  const { data: jobs, error } = await supabase
    .from(TABLES.scrapedJobs)
    .select('id, title, description, platform, budget, url, client_name, ai_score, ai_project_type, ai_tech_stack, ai_client_pain_points, ai_budget_suitability, ai_estimated_effort, ai_summary_ar, ai_recommended_sales_angle')
    .eq('status', 'new')
    .limit(agentConfig.pipeline.batchSize);

  if (error || !jobs?.length) {
    console.log(error ? `Error: ${error.message}` : 'No stuck jobs.');
    return;
  }
  console.log(`Found ${jobs.length} stuck jobs\n`);

  let analyzed = 0, highScore = 0, proposals = 0;
  for (const job of jobs) {
    const desc = (job.description || '').replace(/<[^>]+>/g, '').trim();
    const title = (job.title || '').trim();
    try {
      const result = await aiRouter.analyzeJob(title, desc);
      const { error: upErr } = await supabase.from(TABLES.scrapedJobs).update({
        ai_score: result.score,
        ai_is_relevant: result.is_relevant,
        ai_project_type: result.project_type,
        ai_tech_stack: JSON.stringify(result.tech_stack),
        ai_client_pain_points: JSON.stringify(result.client_pain_points),
        ai_budget_suitability: result.budget_suitability,
        ai_estimated_effort: result.estimated_effort,
        ai_summary_ar: result.summary_ar,
        ai_recommended_sales_angle: result.recommended_sales_angle,
        ai_analyzed_at: new Date().toISOString(),
        status: 'analyzed',
        updated_at: new Date().toISOString(),
      }).eq('id', job.id);
      if (upErr) { console.error(`  DB error: ${upErr.message}`); continue; }
      analyzed++;
      console.log(`  [${job.platform}] Score ${result.score}/5 | ${title.slice(0,60)}`);

      if (result.score >= agentConfig.scoring.highScoreThreshold) {
        highScore++;
        const proposal = await generateProposal(job, result);
        if (proposal) {
          await supabase.from(TABLES.scrapedJobs).update({
            ai_proposal_text: proposal,
            ai_proposal_generated_at: new Date().toISOString(),
          }).eq('id', job.id);
          proposals++;
        }
      }
    } catch (err: any) {
      if (err instanceof AllModelsExhaustedError) {
        console.log(`Exhausted after ${analyzed} jobs.`);
        break;
      }
      console.error(`  Failed: ${title.slice(0,60)} — ${err.message}`);
    }
  }
  console.log(`\n✅ Analyzed: ${analyzed} | High-score: ${highScore} | Proposals: ${proposals}`);
  await notifyTelegram(`📊 *Stuck Jobs Processed*\nAnalyzed: ${analyzed}\nHigh-score: ${highScore}\nProposals: ${proposals}`);
}
main().catch(e => console.error('Fatal:', e));
