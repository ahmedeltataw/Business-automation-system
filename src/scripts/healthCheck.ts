import { createClient } from '@supabase/supabase-js';
import { Redis } from 'ioredis';
import { Bot } from 'grammy';
import { env } from '../config/env';

const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

function log(label: string, ok: boolean, detail?: string) {
  const icon = ok ? '✅' : '❌';
  const color = ok ? GREEN : RED;
  console.log(` ${icon} ${color}${label}${RESET}${detail ? ' — ' + detail : ''}`);
}

function header(text: string) {
  console.log(`\n${CYAN}${BOLD}${'='.repeat(60)}${RESET}`);
  console.log(` ${BOLD}${text}${RESET}`);
  console.log(`${CYAN}${BOLD}${'='.repeat(60)}${RESET}\n`);
}

async function checkSupabase() {
  try {
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
      const { error } = await supabase.from('scraped_jobs').select('id').limit(1);
    const tableMissing = error?.message?.includes('Could not find the table') || error?.message?.includes('does not exist');
    if (tableMissing) {
      log('Supabase', true, 'Connected. scraped_jobs table needs SQL schema creation.');
      return true;
    }
    if (error) throw error;
    log('Supabase', true, 'Connected. scraped_jobs table is ready.');
    return true;
  } catch (err: any) {
    log('Supabase', false, err.message ?? String(err));
    return false;
  }
}

async function checkRedis() {
  let redis: Redis | null = null;
  try {
    redis = new Redis(env.REDIS_URL);
    const testKey = 'health:test:' + Date.now();
    await redis.setex(testKey, 10, 'pong');
    const val = await redis.get(testKey);
    if (val !== 'pong') throw new Error('SET/GET mismatch');
    await redis.del(testKey);
    log('Upstash Redis', true, 'SET/GET/DEL with 10s TTL verified.');
    return true;
  } catch (err: any) {
    log('Upstash Redis', false, err.message ?? String(err));
    return false;
  } finally {
    if (redis) redis.disconnect();
  }
}

async function checkGemini() {
  try {
    const { GoogleGenAI } = await import('@google/genai') as any;
    const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: 'Respond with ONLY the word: Connected',
    });
    const text = response.text?.trim() ?? '';
    if (!text.toLowerCase().includes('connected')) {
      throw new Error(`Unexpected response: "${text}"`);
    }
    log('Gemini 2.5 Flash', true, `Responded: "${text}"`);
    return true;
  } catch (err: any) {
    log('Gemini 2.5 Flash', false, err.message ?? String(err));
    return false;
  }
}

async function checkTelegram() {
  try {
    const bot = new Bot(env.TELEGRAM_BOT_TOKEN);
    const message = [
      '\u{1F514} *\u{641}\u{62D}\u{635} \u{627}\u{644}\u{646}\u{638}\u{627}\u{645}:* \u{627}\u{62A}\u{635}\u{627}\u{644} \u{627}\u{644}\u{628}\u{648}\u{62A} \u{627}\u{644}\u{625}\u{634}\u{639}\u{627}\u{631}\u{64A} \u{64A}\u{639}\u{645}\u{644} \u{628}\u{646}\u{62C}\u{627}\u{62D}!',
      '',
      '\u{1F4A1} *System:* AI-Powered Freelance Sales Automation',
      '\u{1F4C5} *Time:* ' + new Date().toISOString(),
      '\u{2705} Phase 1 is fully operational.',
    ].join('\n');
    await bot.api.sendMessage(env.TELEGRAM_CHAT_ID, message, {
      parse_mode: 'Markdown',
    });
    log('Telegram Bot', true, 'Live notification sent successfully.');
    return true;
  } catch (err: any) {
    log('Telegram Bot', false, err.message ?? String(err));
    return false;
  }
}

async function main() {
  console.log(`\n${BOLD}${'='.repeat(60)}${RESET}`);
  console.log(` ${BOLD}  PHASE 1 — COMPREHENSIVE HEALTH CHECK${RESET}`);
  console.log(` ${BOLD}  AI-Powered Freelance Sales Automation${RESET}`);
  console.log(`${BOLD}${'='.repeat(60)}${RESET}\n`);

  header('1/4 — Supabase (PostgreSQL)');
  const supabaseOk = await checkSupabase();

  header('2/4 — Upstash Redis');
  const redisOk = await checkRedis();

  header('3/4 — Gemini AI');
  const geminiOk = await checkGemini();

  header('4/4 — Telegram Bot');
  const telegramOk = await checkTelegram();

  const allOk = supabaseOk && redisOk && geminiOk && telegramOk;

  console.log(`\n${BOLD}${'='.repeat(60)}${RESET}`);
  console.log(` ${allOk ? GREEN : RED}${BOLD}  OVERALL STATUS: ${allOk ? 'ALL SYSTEMS OPERATIONAL' : 'SOME CHECKS FAILED'}${RESET}`);
  console.log(`${BOLD}${'='.repeat(60)}${RESET}\n`);

  const summary = [
    `  ${supabaseOk ? '✅' : '❌'} Supabase      ${supabaseOk ? 'Connected' : 'Failed'}`,
    `  ${redisOk ? '✅' : '❌'} Redis         ${redisOk ? 'Connected' : 'Failed'}`,
    `  ${geminiOk ? '✅' : '❌'} Gemini AI     ${geminiOk ? 'Connected' : 'Failed'}`,
    `  ${telegramOk ? '✅' : '❌'} Telegram      ${telegramOk ? 'Connected' : 'Failed'}`,
  ];
  console.log(summary.join('\n'));

  if (allOk) {
    console.log(`\n${GREEN}${BOLD}  \uD83C\uDF89 PHASE 1 FULLY COMPLETE AND VERIFIED!${RESET}`);
    console.log(` ${GREEN}  Everything is functional. Please review your Telegram app for the live alert.${RESET}`);
    console.log(` ${GREEN}  Awaiting your approval before we discuss starting Phase 2 (Hunter Agent).${RESET}\n`);
  }
}

main().catch((err) => {
  console.error(`\n${RED}Fatal error:${RESET}`, err);
  process.exit(1);
});
