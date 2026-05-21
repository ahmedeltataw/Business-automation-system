/**
 * Telegram Bridge — Two-Way Chat & System Control Interface
 *
 * Production-grade Telegram integration using node-telegram-bot-api:
 * - Strict authentication via TELEGRAM_ALLOWED_CHAT_ID
 * - Normal chat → Cloud AI proxy with full Tech Academy + Sales Closer knowledge injection
 * - Control commands: /start, /help, /status, /pc_status, /screenshot, /exec
 * - Callback query handling (archive, regenerate proposals)
 * - Single unified bot instance (replaces separate notifier + bot pattern)
 */

import TelegramBot, { CallbackQuery, Message } from 'node-telegram-bot-api';
import { env } from '../config/env';
import { loadLearningContext, getPerformanceSummary } from './learning_memory';
import { supabase, TABLES } from '../config/db';
import { aiRouter } from '../ai/router';
import { elkingEngine, type ChatMessage } from './core/elking_engine';
import { webExplorer } from './core/web_explorer';
import screenshotDesktop from 'screenshot-desktop';
import { execSync } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';

/* ------------------------------------------------------------------ */
/*  Auth                                                              */
/* ------------------------------------------------------------------ */

const ALLOWED_CHAT_ID = (env.TELEGRAM_ALLOWED_CHAT_ID || env.TELEGRAM_CHAT_ID).trim();
const FALLBACK_MSG = 'الملك هنج وهو بيكلم السحاب يا ليدر، ثواني وبظبط الـ Connection!';

console.log(`[TelegramBridge] ALLOWED_CHAT_ID="${ALLOWED_CHAT_ID}" (type=${typeof ALLOWED_CHAT_ID})`);

function isAuthorized(chatId: number): boolean {
  const result = chatId.toString() === ALLOWED_CHAT_ID;
  if (!result) {
    console.warn(`[TelegramBridge] Auth FAIL: incoming chatId=${chatId} ("${chatId.toString()}") !== "${ALLOWED_CHAT_ID}"`);
  }
  return result;
}

/* ------------------------------------------------------------------ */
/*  Bot Instance                                                       */
/* ------------------------------------------------------------------ */

const bot = new TelegramBot(env.TELEGRAM_BOT_TOKEN, { polling: true });

/* ------------------------------------------------------------------ */
/*  Chat History — Per-Chat Context Window                             */
/* ------------------------------------------------------------------ */

const chatHistories = new Map<number, ChatMessage[]>();

function getChatHistory(chatId: number): ChatMessage[] {
  const hist = chatHistories.get(chatId);
  if (!hist) return [];
  return hist;
}

function appendToHistory(chatId: number, entry: ChatMessage): void {
  const hist = chatHistories.get(chatId) || [];
  hist.push(entry);
  chatHistories.set(chatId, hist);
}

/* ------------------------------------------------------------------ */
/*  Auth Gatekeeper                                                    */
/* ------------------------------------------------------------------ */

const SECURITY_LOG = new Set<number>();

bot.on('message', async (msg: Message) => {
  const chatId = msg.chat.id;

  if (!isAuthorized(chatId)) {
    if (!SECURITY_LOG.has(chatId)) {
      SECURITY_LOG.add(chatId);
      const uid = msg.from?.id ?? 'unknown';
      const uname = msg.from?.username ?? 'unknown';
      console.warn(`[TelegramBridge] SECURITY: Unauthorized access from chat=${chatId} user=${uid} (@${uname})`);
    }
    return;
  }

  const text = msg.text?.trim();
  if (!text) return;

  /* ── Commands ────────────────────────────────────────────── */

  if (text.startsWith('/')) {
    const cmd = text.split(/\s+/)[0].toLowerCase();

    switch (cmd) {

      /* ── /start, /help ── */
      case '/start':
      case '/help': {
        const helpMsg = `👑 *ELKing System Manager OS — Operational Mode Active* 👑

*Available Commands*
┌───────────────────────────────────┐
│ \`/status\`       System & AI health    │
│ \`/pc_status\`    Machine metrics        │
│ \`/screenshot\`   Desktop capture        │
│ \`/exec\`         Shell execution        │
│ \`/research\`     Web research & synths  │
│ \`/learn\`        Ingest URL into memory │
│ \`/help\`         This menu              │
└───────────────────────────────────┘

*Chat Mode*
Send any message — I'll route it through our cloud AI with full Tech Academy + Sales Closer knowledge injection. Think of me as your co-founder on speed dial, يا ليدر.

*Security*
Bound to authorized Chat ID only. All unauthorized access is logged and discarded.`;
        await bot.sendMessage(chatId, helpMsg, { parse_mode: 'Markdown' });
        return;
      }

      /* ── /status ── */
      case '/status': {
        await bot.sendMessage(chatId, '*Querying system state...*', { parse_mode: 'Markdown' });

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

          await bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
        } catch (err: any) {
          await bot.sendMessage(chatId, `*Status Error:* ${err.message.slice(0, 200)}`, { parse_mode: 'Markdown' });
        }
        return;
      }

      /* ── /pc_status ── */
      case '/pc_status': {
        await bot.sendMessage(chatId, '*Reading system metrics...*', { parse_mode: 'Markdown' });

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

          await bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
        } catch (err: any) {
          await bot.sendMessage(chatId, `*PC Status Error:* ${err.message.slice(0, 200)}`, { parse_mode: 'Markdown' });
        }
        return;
      }

      /* ── /screenshot ── */
      case '/screenshot': {
        await bot.sendMessage(chatId, '*Capturing desktop...*', { parse_mode: 'Markdown' });

        const tmpDir = path.resolve(process.cwd(), 'tmp');
        if (!fs.existsSync(tmpDir)) {
          fs.mkdirSync(tmpDir, { recursive: true });
        }

        const screenshotPath = path.join(tmpDir, `screenshot_${Date.now()}.png`);

        try {
          await screenshotDesktop({ filename: screenshotPath, format: 'png' });
          await bot.sendPhoto(chatId, screenshotPath);
        } catch (err: any) {
          await bot.sendMessage(chatId, `*Screenshot Error:* ${err.message.slice(0, 200)}`, { parse_mode: 'Markdown' });
        } finally {
          if (fs.existsSync(screenshotPath)) {
            fs.unlinkSync(screenshotPath);
          }
        }
        return;
      }

      /* ── /research <query> ── */
      case '/research': {
        const query = text.slice(9).trim();
        if (!query) {
          await bot.sendMessage(chatId, '*Usage:* /research <query>\n_Example:_ /research latest AI agents 2026', { parse_mode: 'Markdown' });
          return;
        }

        await bot.sendMessage(chatId, `*🔍 Researching:* ${query}`, { parse_mode: 'Markdown' });

        try {
          const summary = await webExplorer.searchAndSynthesize(query);
          await bot.sendMessage(chatId, summary, { parse_mode: 'Markdown' });
        } catch (err: any) {
          await bot.sendMessage(chatId, `*Research Error:* ${err.message.slice(0, 200)}`, { parse_mode: 'Markdown' });
        }
        return;
      }

      /* ── /learn <url> ── */
      case '/learn': {
        const url = text.slice(6).trim();
        if (!url) {
          await bot.sendMessage(chatId, '*Usage:* /learn <url>\n_Example:_ /learn https://example.com/docs', { parse_mode: 'Markdown' });
          return;
        }

        await bot.sendMessage(chatId, `*📖 Learning from:* ${url}`, { parse_mode: 'Markdown' });

        try {
          const success = await webExplorer.ingestUrlToMemory(url);
          if (success) {
            await bot.sendMessage(chatId, `*✅ Knowledge ingested successfully.*\nELKing's brain just got bigger, يا ليدر.`, { parse_mode: 'Markdown' });
          } else {
            await bot.sendMessage(chatId, '*⚠️ Could not extract meaningful content from that URL.*', { parse_mode: 'Markdown' });
          }
        } catch (err: any) {
          await bot.sendMessage(chatId, `*Learn Error:* ${err.message.slice(0, 200)}`, { parse_mode: 'Markdown' });
        }
        return;
      }

      /* ── /exec <command> ── */
      case '/exec': {
        const command = text.slice(5).trim();
        if (!command) {
          await bot.sendMessage(chatId, '*Usage:* /exec <command>\n_Example:_ /exec whoami', { parse_mode: 'Markdown' });
          return;
        }

        await bot.sendMessage(chatId, `*Executing:* \`${command}\``, { parse_mode: 'Markdown' });

        try {
          const output = execSync(command, {
            encoding: 'utf8',
            timeout: 30000,
            maxBuffer: 1024 * 1024,
            windowsHide: true,
          });
          const truncated = output.slice(0, 4000);
          const reply = truncated ? `\`\`\`\n${truncated}\n\`\`\`` : '*Command completed (no output)*';
          await bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
        } catch (err: any) {
          const stderr = err.stderr?.toString().slice(0, 2000) || err.message.slice(0, 2000);
          await bot.sendMessage(chatId, `*Error:*\n\`\`\`\n${stderr}\n\`\`\``, { parse_mode: 'Markdown' });
        }
        return;
      }

      /* ── Unknown command ── */
      default:
        await bot.sendMessage(chatId, `*Unknown command:* \`${cmd}\`\nTry /help`, { parse_mode: 'Markdown' });
        return;
    }
  }

  /* ── Normal Chat — ELKing Engine ───────────────────────── */

  try {
    const history = getChatHistory(chatId);
    appendToHistory(chatId, { role: 'user', content: text });

    const reply = await elkingEngine.generateKingResponse(text, history);

    appendToHistory(chatId, { role: 'assistant', content: reply });

    await bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
  } catch (err: any) {
    console.error(`[TelegramBridge] Chat error: ${err.message}`);
    try {
      await bot.sendMessage(chatId, FALLBACK_MSG, { parse_mode: 'Markdown' });
    } catch {
      console.error('[TelegramBridge] Fatal: cannot send ANY message — bot may be dead');
    }
  }
});

/* ------------------------------------------------------------------ */
/*  Callback Query Handler (archive / regenerate proposals)           */
/* ------------------------------------------------------------------ */

bot.on('callback_query', async (query: CallbackQuery) => {
  const chatId = query.message?.chat.id;
  if (!chatId || !isAuthorized(chatId)) {
    await bot.answerCallbackQuery(query.id, { text: 'Unauthorized' });
    return;
  }

  const data = query.data;
  if (!data) return;

  const [action, jobId] = data.split(':');

  if (action === 'archive_job') {
    const { error } = await supabase
      .from(TABLES.scrapedJobs)
      .update({ status: 'archived' })
      .eq('id', jobId);

    if (error) {
      await bot.answerCallbackQuery(query.id, { text: `Error: ${error.message}`, show_alert: true });
    } else {
      await bot.answerCallbackQuery(query.id, { text: 'Archived successfully' });
      const msgId = query.message?.message_id;
      if (msgId) {
        const currentText = (query.message as any)?.text || '';
        await bot.editMessageText(currentText + '\n\n✅ *Archived*', {
          chat_id: chatId,
          message_id: msgId,
          parse_mode: 'Markdown',
        });
      }
    }
  } else if (action === 'regenerate_proposal') {
    await bot.answerCallbackQuery(query.id, { text: 'Generating new proposal...' });

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

        await bot.sendMessage(chatId, `✅ Proposal regenerated for job \`${jobId}\``, { parse_mode: 'Markdown' });
      } else {
        await bot.answerCallbackQuery(query.id, { text: 'No proposal generated (below threshold)', show_alert: true });
      }
    } catch (err: any) {
      await bot.answerCallbackQuery(query.id, { text: `Error: ${err.message}`, show_alert: true });
    }
  }
});

/* ------------------------------------------------------------------ */
/*  Start Function                                                     */
/* ------------------------------------------------------------------ */

export async function startTelegramBridge(): Promise<void> {
  console.log('[TelegramBridge] Starting unified bot (node-telegram-bot-api)...');
  console.log(`[TelegramBridge] Authorized Chat ID: ${ALLOWED_CHAT_ID}`);
  console.log(`[TelegramBridge] ELKing Engine — ${elkingEngine.loadedSkills} skills loaded (${elkingEngine.skillNames.join(', ')})`);
  console.log('[TelegramBridge] Listening for commands and messages...');
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
