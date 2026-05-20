import { supabase, TABLES } from '../config/db';
import { aiRouter, AllModelsExhaustedError, JobMetadata } from './router';
import { notifyTelegram } from '../telegram/notifier';
import { agentConfig } from '../config/agentConfig';

const PLATFORM_ICONS: Record<string, string> = {
  mostaql: '🟢 مستقل',
  khamsat: '🟠 خمسات',
  kafil: '🔵 كافل',
  bahar: '🌊 بحر',
  ureed: '💜 أوريد',
};

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

export async function runAnalysisPipeline(): Promise<{ analyzed: number; highScore: number }> {
  console.log('\n=== AI Analysis Pipeline ===\n');

  const { data: jobs, error } = await supabase
    .from(TABLES.scrapedJobs)
    .select('id, title, description, platform, budget, url, external_id, proposals_count, client_hiring_rate, client_notes, execution_time')
    .eq('status', 'new')
    .limit(agentConfig.pipeline.batchSize);

  if (error) {
    console.error('Pipeline fetch error:', error.message);
    return { analyzed: 0, highScore: 0 };
  }

  if (!jobs || jobs.length === 0) {
    console.log('No new jobs to analyze.');
    return { analyzed: 0, highScore: 0 };
  }

  console.log(`Processing ${jobs.length} new jobs...\n`);

  let analyzed = 0;
  let highScore = 0;

  for (const job of jobs) {
    // Deduplication check: verify this job hasn't been processed via external_id
    const { data: existingJob } = await supabase
      .from(TABLES.scrapedJobs)
      .select('id')
      .eq('external_id', job.external_id)
      .neq('id', job.id)
      .maybeSingle();

    if (existingJob) {
      console.log(`  [${job.platform}] Skipping already processed job: ${job.external_id}`);
      continue;
    }

    const description = (job.description || '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 2000);
    const title = (job.title || '').trim().slice(0, 150);
    const displayTitle = title.slice(0, 80);

    try {
      const metadata: JobMetadata = {
        platform: job.platform,
        proposals_count: (job as any).proposals_count ?? undefined,
        client_hiring_rate: (job as any).client_hiring_rate ?? undefined,
        client_notes: (job as any).client_notes ?? undefined,
        execution_time: (job as any).execution_time ?? undefined,
      };
      const result = await aiRouter.analyzeJob(title, description, metadata);

      const { error: updateError } = await supabase
        .from(TABLES.scrapedJobs)
        .update({
          ai_score: result.score,
          ai_is_relevant: result.is_relevant,
          ai_project_type: result.project_type,
          ai_tech_stack: JSON.stringify(result.tech_stack),
          ai_client_pain_points: JSON.stringify(result.client_pain_points),
          ai_budget_suitability: result.budget_suitability,
          ai_estimated_effort: result.estimated_effort,
          ai_summary_ar: result.summary_ar,
          ai_recommended_sales_angle: result.recommended_sales_angle,
          ai_lead_score_warning: result.lead_score_warning || null,
          ai_analyzed_at: new Date().toISOString(),
          status: 'analyzed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id);

      if (updateError) {
        console.error(`[${job.platform}] DB update failed:`, updateError.message);
        continue;
      }

      analyzed++;
      console.log(`  [${job.platform}] Score ${result.score}/5 | ${displayTitle}`);

      if (result.score >= agentConfig.scoring.highScoreThreshold) {
        highScore++;
        
        const proposal = result.tailoredArabicProposal || null;

        await sendHighScoreAlert(job, result, proposal);

        if (proposal) {
          const { error: propErr } = await supabase
            .from(TABLES.scrapedJobs)
            .update({
              ai_proposal_text: proposal,
              ai_proposal_generated_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', job.id);

          if (propErr) {
            console.error(`[${job.platform}] Proposal persist failed: ${propErr.message}`);
          } else {
            console.log(`  📝 Proposal generated for job #${job.id}`);
          }
        }
      }
      
      // Sequential throttle: wait 3s before next job to avoid burst rate limiting
      await sleep(3000);

    } catch (err: any) {
      if (err instanceof AllModelsExhaustedError) {
        console.error(`  [AI] All models rate-limited, skipping this project.`);
        continue;
      }
      console.error(`  [${job.platform}] Analysis failed: ${displayTitle} — ${err.message}`);
    }
  }

  console.log(`\n✅ Analyzed: ${analyzed} | High-score alerts: ${highScore}`);
  return { analyzed, highScore };
}

async function sendHighScoreAlert(
  job: { id: string; title: string; description: string; platform: string; budget?: string; url?: string; external_id?: string; proposals_count?: number; client_hiring_rate?: string; execution_time?: string; client_notes?: string },
  analysis: { score: number; project_type: string; tech_stack: string[]; client_pain_points: string[]; budget_suitability: string; estimated_effort: string; summary_ar: string; recommended_sales_angle: string; tailoredArabicProposal?: string; lead_score_warning?: string },
  proposal?: string | null
) {
  const platformIcon = PLATFORM_ICONS[job.platform] || job.platform;
  const techStack = analysis.tech_stack.length > 0
    ? analysis.tech_stack.join(' • ')
    : 'غير محدد';
  const painPoints = analysis.client_pain_points.length > 0
    ? analysis.client_pain_points.join(' • ')
    : '';
  const budget = job.budget?.trim() || 'غير محدد';
  const url = job.url?.trim() || `https://${job.platform}.com`;

  const lines = [
    `🔥 *فرصة عمل ممتازة!*`,
    ``,
    `${platformIcon}`,
    `*العنوان:* ${job.title.trim().slice(0, 100)}`,
    `*النوع:* ${analysis.project_type}`,
    `*الميزانية:* ${budget}`,
    `*التقنيات:* ${techStack}`,
    `*الجهد:* ${analysis.estimated_effort}`,
    ``,
    `*الملخص:* ${analysis.summary_ar}`,
  ];

  // Metadata block
  const metaParts: string[] = [];
  if (job.execution_time) metaParts.push(`*المدة:* ${job.execution_time}`);
  if (job.proposals_count !== undefined && job.proposals_count > 0) metaParts.push(`*عدد العروض:* ${job.proposals_count}`);
  if (job.client_hiring_rate) metaParts.push(`*معدل التوظيف:* ${job.client_hiring_rate}`);
  if (metaParts.length > 0) lines.splice(5, 0, ...metaParts);

  if (analysis.lead_score_warning) {
    lines.push(``, `⚠️ *تنبيه:* ${analysis.lead_score_warning}`);
  }

  if (painPoints) {
    lines.push(`*نقاط الألم:* ${painPoints}`);
  }

  if (analysis.recommended_sales_angle) {
    lines.push(`*النهج المقترح:* ${analysis.recommended_sales_angle}`);
  }

  if (proposal) {
    lines.push(``, `📝 *مسودة العرض المقترح:*`, `\`\`\`${proposal}\`\`\``);
  } else {
    lines.push(``, `*✍️ عرض السعر:* لم يتم إنشاؤه (لم يصل للحد الأدنى)`);
  }

  if (job.client_notes) {
    lines.push(``, `📌 *ملاحظات العميل:* ${job.client_notes.slice(0, 200)}`);
  }

  lines.push(``, `[🔗 رابط المشروع](${url})`);

  await notifyTelegram(lines.join('\n'), job.id, url);
}
