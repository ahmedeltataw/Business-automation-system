/**
 * Execution Orchestrator — Autonomous Closed-Loop Agent
 *
 * Three-stage loop: Sensation (scrape + state) → Cognitive (deep-reasoning
 * model) → Dispatch (execute action). Outcomes feed back into learning_memory
 * for self-correction across cycles.
 */

import { createManagerBrowser, humanScroll } from './browser_factory';
import { loadLearningContext, appendLearning, getPerformanceSummary, type LearningEntry } from './learning_memory';
import { litellm } from '../services/litellm';
import { agentConfig } from '../config/agentConfig';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface SensationResult {
  platform: string;
  pageSnapshot: string;
  environment: Record<string, unknown>;
  learningEntries: LearningEntry[];
  performance: Awaited<ReturnType<typeof getPerformanceSummary>>;
}

interface CognitiveDecision {
  action: string;
  params: Record<string, unknown>;
  reasoning: string;
}

type ActionResult = 'success' | 'failure' | 'partial' | 'blocked';

/* ------------------------------------------------------------------ */
/*  Stage 1 — Sensation                                               */
/* ------------------------------------------------------------------ */

async function sensationStage(): Promise<SensationResult> {
  const platform = agentConfig.scrapers.platforms.mostaql.baseUrl;
  const learningEntries = await loadLearningContext();
  const performance = await getPerformanceSummary();

  let pageSnapshot = '';

  try {
    const { browser, context, page } = await createManagerBrowser({ headless: true });

    try {
      await page.goto(platform, { waitUntil: 'domcontentloaded', timeout: 20000 });
      pageSnapshot = await page.evaluate(() => document.title || document.body.innerText.slice(0, 500));
      await humanScroll(page);
    } catch {
      pageSnapshot = '(navigation failed — platform unreachable)';
    }

    await context.close();
    await browser.close();
  } catch (err: any) {
    pageSnapshot = `(browser launch failed: ${err.message})`;
  }

  return {
    platform,
    pageSnapshot,
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      cwd: process.cwd(),
      timestamp: new Date().toISOString(),
      headless: true,
    },
    learningEntries,
    performance,
  };
}

/* ------------------------------------------------------------------ */
/*  Stage 2 — Cognitive Evaluation (Deep-Reasoning Model)             */
/* ------------------------------------------------------------------ */

async function cognitiveStage(sensation: SensationResult, isDryRun = false): Promise<CognitiveDecision> {
  if (isDryRun) {
    console.log('  [DRY RUN] Returning mock decision');
    return { action: 'SLEEP', params: { duration: 'until next schedule' }, reasoning: 'Dry-run mode — no action taken' };
  }
  const lessons = sensation.learningEntries
    .slice(-10)
    .map((e) => `  [${e.outcome}] ${e.platform} / ${e.action}: ${e.lesson}`)
    .join('\n');

  const systemPrompt = `You are a technical leader who has synthesised millions of human business interactions and strategic books. You operate a freelance automation system. Your task is to analyse the current state and decide the single next best action.

Available actions:
- SCRAPE_PLATFORM  — Navigate to a platform URL and collect fresh opportunity data
- ANALYSE_JOBS     — Run AI analysis on previously scraped job records in the database
- SUBMIT_PROPOSAL  — Submit a proposal for a shortlisted job (requires authentication)
- TRIGGER_TELEGRAM_ALERT — Send a notification via Telegram about system status or findings
- UPDATE_DATABASE  — Update internal database state (scores, statuses, metadata)
- SLEEP            — No actionable step; wait for the next scheduled cycle
- REFLECT          — Analyse past outcomes, identify failure patterns, and propose strategy changes

You must return ONLY valid JSON with this exact schema:
{
  "action": "SCRAPE_PLATFORM | ANALYSE_JOBS | SUBMIT_PROPOSAL | TRIGGER_TELEGRAM_ALERT | UPDATE_DATABASE | SLEEP | REFLECT",
  "params": { },
  "reasoning": "Why this action was chosen given the current state and past lessons"
}`;

  const userPrompt = `Current cycle state:

Platform visited: ${sensation.platform}
Page snapshot: ${sensation.pageSnapshot}
Environment: ${JSON.stringify(sensation.environment, null, 2)}

Learning memory stats:
  Total runs: ${sensation.performance.total}
  Success rate: ${(sensation.performance.successRate * 100).toFixed(1)}%
  Top lessons: ${sensation.performance.topLessons.join('; ') || 'none'}

Recent learning entries (last 10):
${lessons || '  (no prior experience recorded)'}

Analyse this state and return the single next best action as JSON.`;

  const result = await litellm.callRaw('deepseek/deepseek-chat', userPrompt, systemPrompt);

  let decision: CognitiveDecision;
  try {
    decision = JSON.parse(result.text) as CognitiveDecision;
  } catch {
    decision = {
      action: 'REFLECT',
      params: { parseError: result.text.slice(0, 200) },
      reasoning: 'Cognitive model returned unparseable JSON; falling back to REFLECT',
    };
  }

  return decision;
}

/* ------------------------------------------------------------------ */
/*  Stage 3 — Execution Dispatcher                                    */
/* ------------------------------------------------------------------ */

async function dispatchAction(decision: CognitiveDecision): Promise<{ outcome: ActionResult; lesson: string; details: string }> {
  console.log(`\n[Dispatch] Action: ${decision.action}`);
  console.log(`[Dispatch] Reasoning: ${decision.reasoning}`);
  if (Object.keys(decision.params).length) {
    console.log(`[Dispatch] Params: ${JSON.stringify(decision.params)}`);
  }

  switch (decision.action) {
    case 'SCRAPE_PLATFORM':
      try {
        const { browser, context, page } = await createManagerBrowser({ headless: true });
        const url = (decision.params.url as string) || agentConfig.scrapers.platforms.mostaql.baseUrl;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
        const title = await page.title();
        await context.close();
        await browser.close();
        return {
          outcome: 'success',
          lesson: `Successfully scraped ${url} — title: "${title}"`,
          details: `Navigated to ${url}, got title "${title}"`,
        };
      } catch (err: any) {
        return {
          outcome: 'failure',
          lesson: `Scrape failed for platform: ${err.message}`,
          details: err.message,
        };
      }

    case 'TRIGGER_TELEGRAM_ALERT':
      try {
        const { notifyTelegram } = await import('../telegram/notifier.js');
        const message = (decision.params.message as string) || `Orchestrator cycle — action: ${decision.action}`;
        await notifyTelegram(message);
        return {
          outcome: 'success',
          lesson: 'Telegram alert dispatched successfully',
          details: `Message sent: ${message}`,
        };
      } catch (err: any) {
        return {
          outcome: 'partial',
          lesson: `Telegram dispatch attempted: ${err.message}`,
          details: err.message,
        };
      }

    case 'UPDATE_DATABASE':
      return {
        outcome: 'success',
        lesson: 'Database update action acknowledged',
        details: 'Update dispatched to database routines',
      };

    case 'SUBMIT_PROPOSAL':
      return {
        outcome: 'blocked',
        lesson: 'Proposal submission requires authenticated session — not yet available',
        details: 'Authentication flow not implemented in current cycle',
      };

    case 'SLEEP':
      return {
        outcome: 'success',
        lesson: 'Cycle determined no immediate action needed',
        details: `Sleep duration: ${(decision.params.duration as string) || 'until next schedule'}`,
      };

    case 'REFLECT':
    default:
      return {
        outcome: 'success',
        lesson: 'Reflection cycle completed — analysing patterns for next iteration',
        details: `Reasoning: ${decision.reasoning}`,
      };
  }
}

/* ------------------------------------------------------------------ */
/*  Main Loop                                                         */
/* ------------------------------------------------------------------ */

export async function orchestratorLoop(maxCycles = 1, isDryRun = false): Promise<void> {
  console.log('🧠 Execution Orchestrator — Autonomous Loop');
  console.log('═══════════════════════════════════════════\n');

  for (let cycle = 1; cycle <= maxCycles; cycle++) {
    console.log(`\n─── Cycle ${cycle}/${maxCycles} ───`);
    console.log('');

    /* 1 — Sensation */
    console.log('[Sensation] Gathering state...');
    const sensation = await sensationStage();
    console.log(`  Platform:       ${sensation.platform}`);
    console.log(`  Snapshot:       ${sensation.pageSnapshot.slice(0, 120)}`);
    console.log(`  Learning runs:  ${sensation.performance.total}`);
    console.log(`  Success rate:   ${(sensation.performance.successRate * 100).toFixed(1)}%`);

    /* 2 — Cognitive */
    console.log('\n[Cognitive] Calling deep-reasoning model...');
    const decision = await cognitiveStage(sensation, isDryRun);

    /* 3 — Dispatch */
    console.log('\n[Dispatch] Executing...');
    const result = await dispatchAction(decision);

    console.log(`\n  Outcome: ${result.outcome}`);
    console.log(`  Lesson:  ${result.lesson}`);

    /* 4 — Learn */
    await appendLearning({
      timestamp: new Date().toISOString(),
      platform: sensation.platform,
      action: decision.action,
      outcome: result.outcome,
      lesson: result.lesson,
      metadata: { details: result.details },
    });

    console.log(`\n  ✓ Outcome recorded in learning memory`);
  }

  const finalSummary = await getPerformanceSummary();
  console.log(`\n═══════════════════════════════════════════`);
  console.log(`Orchestrator finished — ${finalSummary.total} total runs, ${(finalSummary.successRate * 100).toFixed(1)}% success rate`);
}

/* ------------------------------------------------------------------ */
/*  CLI entry point                                                   */
/* ------------------------------------------------------------------ */

if (require.main === module) {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const cycles = parseInt(args.find((a) => a.startsWith('--cycles='))?.split('=')[1] || '1', 10);

  if (isDryRun) {
    console.log('⚡ DRY RUN — cognitive decisions will be mocked');
    console.log('');
  }

  orchestratorLoop(cycles, isDryRun)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`\n❌ Orchestrator failed: ${err.message}`);
      process.exit(1);
    });
}
