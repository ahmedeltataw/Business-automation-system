import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

interface EnvConfig {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  REDIS_URL: string;
  GEMINI_API_KEY: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  GROQ_API_KEY: string;
  GROQ_API_KEY_2: string;
  HF_TOKEN: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_API_TOKEN: string;
  DEEPSEEK_API_KEY: string;
}

function ensure(key: string): string {
  const v = process.env[key]?.trim();
  if (!v) throw new Error(`Missing required env: ${key}`);
  return v;
}

function optional(key: string, fallback = ''): string {
  return process.env[key]?.trim() || fallback;
}

function loadEnv(): EnvConfig {
  return {
    SUPABASE_URL: ensure('SUPABASE_URL'),
    SUPABASE_SERVICE_ROLE_KEY: ensure('SUPABASE_SERVICE_ROLE_KEY'),
    REDIS_URL: ensure('REDIS_URL'),
    GEMINI_API_KEY: ensure('GEMINI_API_KEY'),
    TELEGRAM_BOT_TOKEN: ensure('TELEGRAM_BOT_TOKEN'),
    TELEGRAM_CHAT_ID: ensure('TELEGRAM_CHAT_ID'),
    GROQ_API_KEY: ensure('GROQ_API_KEY'),
    GROQ_API_KEY_2: optional('GROQ_API_KEY_2'),
    HF_TOKEN: optional('HF_TOKEN'),
    CLOUDFLARE_ACCOUNT_ID: optional('CLOUDFLARE_ACCOUNT_ID'),
    CLOUDFLARE_API_TOKEN: optional('CLOUDFLARE_API_TOKEN'),
    DEEPSEEK_API_KEY: optional('DEEPSEEK_API_KEY'),
  };
}


export const env = loadEnv();
