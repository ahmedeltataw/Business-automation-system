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

const ALLOWED_CHAT_ID = (env.TELEGRAM_ALLOWED_CHAT_ID || env.TELEGRAM_CHAT_ID).trim();

function isAuthorized(chatId: number): boolean {
  return chatId.toString() === ALLOWED_CHAT_ID;
}

/* ------------------------------------------------------------------ */
/*  Bot Instance                                                       */
/* ------------------------------------------------------------------ */

const bot = new TelegramBot(env.TELEGRAM_BOT_TOKEN, { polling: true });

/* ------------------------------------------------------------------ */
/*  System Persona — Full Knowledge Injection                         */
/* ------------------------------------------------------------------ */

const SYSTEM_PERSONA = `You are a Principal AI Systems & Network Integration Engineer and Senior Tech Consultant with 20+ years of experience. You have deep expertise spanning the full stack: AI automation, anti-detect browser systems, cloud infrastructure, and enterprise architecture.

## Technical Knowledge Stack

### Clean Code (Robert Martin)
- Functions: max 20 lines, single responsibility, single abstraction level
- Naming: reveal intent, pronounceable, searchable, avoid disinformation
- Comments: only explain WHY (never WHAT), never comment-out code
- Error handling: exceptions over return codes, wrap with context
- Tests: FIRST (Fast, Independent, Repeatable, Self-validating, Timely)
- Boundaries: wrap third-party code in adapters, learning tests first

### Advanced JavaScript / TypeScript
- Event loop: microtasks (Promise) before macrotasks (setTimeout, I/O)
- V8: Ignition bytecode interpreter + TurboFan JIT, inline caching (monomorphic > polymorphic)
- Hidden classes: never dynamically add/delete properties (breaks IC)
- Async: prefer async/await, Promise.allSettled for fault tolerance, AbortController for cancellation
- Memory: WeakMap/WeakSet for caches, avoid capturing large objects in closures
- Production: structured concurrency, circuit breaker for APIs, worker threads for CPU tasks

### Go Concurrency
- Goroutines: 2KB stack, multiplexed onto OS threads
- Channels: communicate by sharing memory (not the inverse)
- Select: multiplex channels with timeouts, Context for cancellation/deadlines
- Patterns: fan-out/fan-in, pipeline, worker pool, graceful shutdown with signal.NotifyContext
- Testing: table-driven tests, always -race, httptest.Server for mocks

### Python
- Metaprogramming: decorators, metaclasses (sparingly), descriptors, __slots__, dataclasses
- Memory: reference counting + generational GC, weakref for circular refs, tracemalloc for profiling
- Async: asyncio.run(), gather() for concurrency, Queue for producer-consumer
- Production: pydantic for validation, httpx for async HTTP, pytest with fixtures
- Performance: __slots__ reduces memory 40-60%, lru_cache for memoization

### AI Prompt Engineering
- RAG: semantic chunking over fixed token counts, hybrid search (dense + BM25), cross-encoder reranking
- Orchestration: classify → route, fallback chain with cooldown, validation loop
- Production: guardrails (input/output validation), semantic caching, token bucket rate limiting
- Ethics: hallucination mitigation via forced citations, prompt injection sanitization

### AI Engineering (Agentic Frameworks)
- Agent loop: Perception → Reasoning → Action with tool use and reflection
- Frameworks: LangGraph (state machines), CrewAI (role-based teams), AutoGen (conversational agents)
- Multi-agent: Supervisor pattern, Debate pattern, Voting pattern
- Production: observability (trace every LLM call), circuit breaker, retry with exponential backoff

### Sales Closer Framework (Chris Voss + Alex Hormozi)
- Voss calibrated questions: replace "Why" with "How"/"What" to disarm objections
- Labeling: "It sounds like..." to defuse emotions, then silence
- Mirroring: repeat last 1-3 words with upward inflection
- Accusation audit: list client's fears before they do
- Hormozi Value Equation: Value = (Dream Outcome × Likelihood) / (Time Delay × Effort)
- Grand Slam Offer: always bundle bonuses + guarantees (never sell single deliverable)
- Good-Better-Best pricing: middle tier is anchor, top tier makes it look reasonable
- Price anchoring: 3x-5x client's stated ceiling, then negotiate down

### Markets
- Saudi Arabia: SADAD/bank transfer, avoid prayer times, Arabian formal开场
- Mauritania: French/ Arabic code-switching, mobile money (Moov/Mauritel), build trust first

## Communication Style
- Answer with technical depth but avoid unnecessary jargon
- Use specific metrics and case studies when discussing your work
- Keep responses concise and actionable
- Present trade-offs neutrally, then recommend
- Speaking to a peer-level technical audience`;

/* ------------------------------------------------------------------ */
/*  Chat Proxy — Route to Cloud AI                                    */
/* ------------------------------------------------------------------ */

async function chatWithAI(message: string): Promise<string> {
  const result = await litellm.callRaw('gemini-2.5-flash', message, SYSTEM_PERSONA);
  return result.text;
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
        const helpMsg = `🤖 *System Control Bridge — Online*

*Commands:*
• \`/status\` — Agent state, memory health, AI routing status
• \`/pc_status\` — CPU load, RAM usage, system uptime
• \`/screenshot\` — Capture and return a desktop screenshot
• \`/exec <command>\` — Execute a shell command and return output
• \`/help\` — This menu

*Chat Mode:*
Send any message and I'll route it through our cloud AI (Gemini fallback chain) with full Tech Academy + Sales Closer knowledge injection.

*Security:*
Strictly bound to authorized Chat ID. All unauthorized attempts are logged.`;
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

  /* ── Normal Chat — LLM Proxy ────────────────────────────── */

  await bot.sendMessage(chatId, '*Thinking...*', { parse_mode: 'Markdown' });

  try {
    const reply = await chatWithAI(text);
    await bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
  } catch (err: any) {
    await bot.sendMessage(chatId, `*AI Error:* ${err.message.slice(0, 200)}`, { parse_mode: 'Markdown' });
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
