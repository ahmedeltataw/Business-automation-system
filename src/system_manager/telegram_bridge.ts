/**
 * Telegram Bridge — Two-Way Chat & System Control Interface
 *
 * Full-duplex Telegram integration for the autonomous sales system:
 * - Strict authentication via TELEGRAM_ALLOWED_CHAT_ID
 * - Normal chat → Cloud AI proxy (Gemini via litellm with Senior Consultant persona)
 * - Control commands: /start, /help, /status, /pc_status, /screenshot
 * - Callback query handling (archive, regenerate proposals)
 * - Single unified bot instance (replaces separate notifier + bot pattern)
 */

import { Bot, Context } from 'grammy';
import { InputFile } from 'grammy/types';
import { env } from '../config/env';
import { litellm } from '../services/litellm';
import { loadLearningContext, getPerformanceSummary } from './learning_memory';
import { supabase, TABLES } from '../config/db';
import { aiRouter } from '../ai/router';
import screenshotDesktop from 'screenshot-desktop';
import { execSync } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';

/* ------------------------------------------------------------------ */
/*  Auth                                                              */
/* ------------------------------------------------------------------ */

const ALLOWED_IDS = (env.TELEGRAM_ALLOWED_CHAT_ID || env.TELEGRAM_CHAT_ID)
  .split(',')
  .map(id => id.trim())
  .filter(Boolean)
  .map(Number);

function isAuthorized(ctx: Context): boolean {
  const uid = ctx.from?.id;
  return uid !== undefined && ALLOWED_IDS.includes(uid);
}

/* ------------------------------------------------------------------ */
/*  Bot Instance                                                       */
/* ------------------------------------------------------------------ */

const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

/* ------------------------------------------------------------------ */
/*  System Persona for Chat Proxy                                     */
/* ------------------------------------------------------------------ */

const SYSTEM_PERSONA = `You are a Principal AI Systems & Network Integration Engineer and Senior Tech Consultant with deep expertise in full-stack architecture, AI automation, and enterprise system design. You communicate with clarity, precision, and authority.

Communication principles:
- Answer with technical depth but avoid unnecessary jargon
- If asked about your stack or approach, use specific metrics and case studies
- Keep responses concise and actionable
- When discussing trade-offs, present both sides and then recommend
- You are speaking to a peer-level technical audience

Your background:
- 20+ years in systems architecture and network integration
- Architected systems handling 2M+ monthly requests with 99.97% uptime
- Specialise in AI-driven automation, anti-detect browser systems, and multi-provider AI routing
- Markets served: Saudi Arabia (fintech, logistics, government) and Mauritania (mobile money, digital transformation)
- Technology focus: TypeScript, Python, Playwright, React, Node.js, AI/ML pipelines`;

/* ------------------------------------------------------------------ */
/*  Chat Proxy — Route to Cloud AI                                    */
/* ------------------------------------------------------------------ */

async function chatWithAI(message: string): Promise<string> {
  const result = await litellm.callRaw('gemini-2.5-flash', message, SYSTEM_PERSONA);
  return result.text;
}

/* ------------------------------------------------------------------ */
/*  Auth Middleware                                                    */
/* ------------------------------------------------------------------ */

bot.use(async (ctx, next) => {
  if (isAuthorized(ctx)) {
    await next();
    return;
  }

  if (ctx.message?.text || ctx.callbackQuery) {
    const uid = ctx.from?.id ?? 'unknown';
    const uname = ctx.from?.username ?? 'unknown';
    console.warn(`[TelegramBridge] SECURITY: Unauthorized from user=${uid} (@${uname})`);
  }
});

/* ------------------------------------------------------------------ */
/*  Command: /start, /help                                            */
/* ------------------------------------------------------------------ */

bot.command(['start', 'help'], async (ctx) => {
  const msg = `*🤖 System Control Bridge — Online*

*Commands:*
• \`/status\` — Agent state, memory health, AI routing status
• \`/pc_status\` — CPU load, RAM usage, system uptime
• \`/screenshot\` — Capture and return a desktop screenshot
• \`/help\` — This menu

*Chat Mode:*
Send any message and I'll route it through our cloud AI (Gemini → Cloudflare → Groq fallback) with the Senior Consultant persona.

*Security:*
Strictly bound to authorized Chat ID. Unauthorized attempts are logged.`;
  await ctx.reply(msg, { parse_mode: 'Markdown' });
});

/* ------------------------------------------------------------------ */
/*  Command: /status                                                  */
/* ------------------------------------------------------------------ */

bot.command('status', async (ctx) => {
  await ctx.reply('*Querying system state...*', { parse_mode: 'Markdown' });

  try {
    const [learningEntries, perf] = await Promise.all([
      loadLearningContext(),
      getPerformanceSummary(),
    ]);

    const recentLessons = learningEntries
      .slice(-5)
      .map(e => `• ${e.platform} / ${e.action}: ${e.lesson.slice(0, 80)}`)
      .join('\n');

    const aliasInfo = [
      '`lead-scorer`   → Cloudflare → Gemini → Groq',
      '`proposal-generator` → DeepSeek → Gemini → Cloudflare',
      '`backup-agent`  → Gemini → Groq → HuggingFace',
    ].join('\n');

    const msg = `*📊 System Status*

*Orchestrator*
Total runs: ${perf.total}
Success rate: ${(perf.successRate * 100).toFixed(1)}%

*Learning Memory*
Entries in context: ${learningEntries.length}

*AI Router Aliases*
${aliasInfo}

*Recent Lessons*
${recentLessons || '(none recorded)'}

*Environment*
Node: ${process.version}
Platform: ${process.platform}
Branch: feature/ai-system-manager`;

    await ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (err: any) {
    await ctx.reply(`*Status Error:* ${err.message.slice(0, 200)}`, { parse_mode: 'Markdown' });
  }
});

/* ------------------------------------------------------------------ */
/*  Command: /pc_status                                               */
/* ------------------------------------------------------------------ */

bot.command('pc_status', async (ctx) => {
  await ctx.reply('*Reading system metrics...*', { parse_mode: 'Markdown' });

  try {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memPercent = ((usedMem / totalMem) * 100).toFixed(1);

    const uptimeSeconds = os.uptime();
    const days = Math.floor(uptimeSeconds / 86400);
    const hours = Math.floor((uptimeSeconds % 86400) / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);

    let cpuLoad = 'N/A';
    try {
      cpuLoad = execSync(
        'powershell -Command "Get-CimInstance Win32_Processor | Select-Object -ExpandProperty LoadPercentage"',
        { encoding: 'utf8', timeout: 5000, shell: 'powershell.exe' }
      ).trim();
    } catch {
      cpuLoad = os.cpus().length.toString() + ' cores (load query unavailable)';
    }

    const hostname = os.hostname();
    const platform = `${os.type()} ${os.release()}`;

    const msg = `*💻 PC Status — ${hostname}*

*CPU*
Load: ${cpuLoad}%
Cores: ${os.cpus().length}
Model: ${os.cpus()[0]?.model?.trim() || 'unknown'}

*Memory*
Used: ${(usedMem / 1024 / 1024 / 1024).toFixed(2)} GB
Free: ${(freeMem / 1024 / 1024 / 1024).toFixed(2)} GB
Total: ${(totalMem / 1024 / 1024 / 1024).toFixed(2)} GB
Usage: ${memPercent}%

*System*
Uptime: ${days}d ${hours}h ${minutes}m
Platform: ${platform}`;

    await ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (err: any) {
    await ctx.reply(`*PC Status Error:* ${err.message.slice(0, 200)}`, { parse_mode: 'Markdown' });
  }
});

/* ------------------------------------------------------------------ */
/*  Command: /screenshot                                              */
/* ------------------------------------------------------------------ */

bot.command('screenshot', async (ctx) => {
  await ctx.reply('*Capturing desktop...*', { parse_mode: 'Markdown' });

  const tmpDir = path.resolve(process.cwd(), 'tmp');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  const screenshotPath = path.join(tmpDir, `screenshot_${Date.now()}.png`);

  try {
    await screenshotDesktop({ filename: screenshotPath, format: 'png' });
    await ctx.replyWithPhoto(new InputFile(screenshotPath));
  } catch (err: any) {
    await ctx.reply(`*Screenshot Error:* ${err.message.slice(0, 200)}`, { parse_mode: 'Markdown' });
  } finally {
    if (fs.existsSync(screenshotPath)) {
      fs.unlinkSync(screenshotPath);
    }
  }
});

/* ------------------------------------------------------------------ */
/*  Normal Chat — LLM Proxy                                           */
/* ------------------------------------------------------------------ */

bot.on('message:text', async (ctx) => {
  const text = ctx.message.text.trim();

  // Ignore commands (already handled above)
  if (text.startsWith('/')) return;

  await ctx.reply('*Thinking...*', { parse_mode: 'Markdown' });

  try {
    const reply = await chatWithAI(text);
    await ctx.reply(reply, { parse_mode: 'Markdown' });
  } catch (err: any) {
    await ctx.reply(`*AI Error:* ${err.message.slice(0, 200)}`, { parse_mode: 'Markdown' });
  }
});

/* ------------------------------------------------------------------ */
/*  Callback Query Handler (archive / regenerate proposals)           */
/* ------------------------------------------------------------------ */

bot.on('callback_query:data', async (ctx) => {
  const data = ctx.callbackQuery.data;
  if (!data) return;

  const [action, jobId] = data.split(':');

  if (action === 'archive_job') {
    const { error } = await supabase
      .from(TABLES.scrapedJobs)
      .update({ status: 'archived' })
      .eq('id', jobId);

    if (error) {
      await ctx.answerCallbackQuery({ text: `Error: ${error.message}`, show_alert: true });
    } else {
      await ctx.answerCallbackQuery({ text: 'Archived successfully' });
      const currentText = ctx.callbackQuery.message?.text || '';
      await ctx.editMessageText(currentText + '\n\n✅ *Archived*');
    }
  } else if (action === 'regenerate_proposal') {
    await ctx.answerCallbackQuery({ text: 'Generating new proposal...' });

    try {
      const { data: job } = await supabase
        .from(TABLES.scrapedJobs)
        .select('*')
        .eq('id', jobId)
        .single();

      if (!job) throw new Error('Job not found');

      const result = await aiRouter.analyzeJob(job.title, job.description);

      if (result.tailoredArabicProposal) {
        await supabase
          .from(TABLES.scrapedJobs)
          .update({
            ai_proposal_text: result.tailoredArabicProposal,
            ai_proposal_generated_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', jobId);

        await ctx.reply(`✅ Proposal regenerated for job \`${jobId}\``, { parse_mode: 'Markdown' });
      } else {
        await ctx.answerCallbackQuery({ text: 'No proposal generated (below threshold)', show_alert: true });
      }
    } catch (err: any) {
      await ctx.answerCallbackQuery({ text: `Error: ${err.message}`, show_alert: true });
    }
  }
});

/* ------------------------------------------------------------------ */
/*  Start Function                                                     */
/* ------------------------------------------------------------------ */

export async function startTelegramBridge(): Promise<void> {
  console.log('[TelegramBridge] Starting unified bot...');
  console.log(`[TelegramBridge] Authorized IDs: ${ALLOWED_IDS.join(', ')}`);

  await bot.start({
    allowed_updates: ['message', 'callback_query'],
    onStart: () => console.log('[TelegramBridge] Listening for commands and messages...'),
  });
}

/* ------------------------------------------------------------------ */
/*  CLI entry point (standalone mode)                                  */
/* ------------------------------------------------------------------ */

if (require.main === module) {
  startTelegramBridge().catch((err) => {
    console.error(`[TelegramBridge] Fatal: ${err.message}`);
    process.exit(1);
  });
}
