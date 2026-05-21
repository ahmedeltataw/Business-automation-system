import * as fs from 'fs';
import TelegramBot from 'node-telegram-bot-api';
import { env } from '../../config/env';
import { getLogPath } from './logger';

const LOG_FILE = getLogPath();
const POLL_INTERVAL_MS = 2000;
const DEBOUNCE_WINDOW_MS = 60_000;

const ERROR_PATTERNS = [
  /Error:/i,
  /Exception:/i,
  /\bFATAL\b/i,
  /\bfailed\b/i,
  /\b400\b/,
  /\b500\b/,
  /RESOURCE_EXHAUSTED/i,
  /decommissioned/i,
];

interface DebounceEntry {
  firstSeen: number;
  lastAlerted: number;
  count: number;
  sample: string;
}

const debounceMap = new Map<string, DebounceEntry>();

function errorSignature(line: string): string {
  return line.replace(/\[\d{4}-\d{2}-\d{2}T[^\]]+\]/g, '').trim().slice(0, 120);
}

function matchesError(line: string): string | null {
  for (const pattern of ERROR_PATTERNS) {
    if (pattern.test(line)) return pattern.source;
  }
  return null;
}

class Watcher {
  private bot: TelegramBot | null = null;
  private chatId: string;
  private lastSize = 0;

  constructor() {
    this.chatId = (env.TELEGRAM_ALLOWED_CHAT_ID || env.TELEGRAM_CHAT_ID || '').trim();
    if (!this.chatId) {
      console.error('[Watcher] No TELEGRAM_ALLOWED_CHAT_ID configured');
      process.exit(1);
    }
  }

  async start(): Promise<void> {
    if (!fs.existsSync(LOG_FILE)) {
      console.log(`[Watcher] Log file not found: ${LOG_FILE}`);
      console.log('[Watcher] Waiting for bridge to create it...');
    }

    if (env.TELEGRAM_BOT_TOKEN) {
      this.bot = new TelegramBot(env.TELEGRAM_BOT_TOKEN, { polling: false });
      console.log('[Watcher] Telegram alert client ready (polling=false)');
    } else {
      console.warn('[Watcher] No TELEGRAM_BOT_TOKEN — alerts disabled');
    }

    this.lastSize = this.getCurrentSize();
    console.log(`[Watcher] Watching ${LOG_FILE} every ${POLL_INTERVAL_MS}ms`);

    if (this.bot) {
      await this.sendAlert(`[Watcher] ELKing monitoring started\nFile: ${LOG_FILE}`);
    }

    this.poll();
  }

  private getCurrentSize(): number {
    try {
      return fs.statSync(LOG_FILE).size;
    } catch {
      return 0;
    }
  }

  private poll(): void {
    setInterval(() => this.check(), POLL_INTERVAL_MS);
  }

  private check(): void {
    const currentSize = this.getCurrentSize();
    if (currentSize <= this.lastSize) return;

    const buffer = Buffer.alloc(currentSize - this.lastSize);
    const fd = fs.openSync(LOG_FILE, 'r');
    fs.readSync(fd, buffer, 0, buffer.length, this.lastSize);
    fs.closeSync(fd);
    this.lastSize = currentSize;

    const content = buffer.toString('utf-8');
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      const matched = matchesError(line);
      if (matched) {
        this.handleError(line, matched);
      }
    }
  }

  private handleError(line: string, pattern: string): void {
    const sig = errorSignature(line);
    const now = Date.now();
    const existing = debounceMap.get(sig);

    if (existing) {
      existing.count++;
      if (now - existing.lastAlerted >= DEBOUNCE_WINDOW_MS) {
        this.sendAlert(
          `[Watcher] Repeated error (${existing.count}x in ${((now - existing.firstSeen) / 1000).toFixed(0)}s)\nPattern: ${pattern}\n${existing.sample}`
        );
        existing.lastAlerted = now;
      }
      return;
    }

    debounceMap.set(sig, { firstSeen: now, lastAlerted: now, count: 1, sample: line.trim() });
    this.sendAlert(
      `[Watcher] Error detected\nPattern: ${pattern}\n${line.trim()}`
    );
  }

  private async sendAlert(text: string): Promise<void> {
    if (!this.bot) return;
    try {
      await this.bot.sendMessage(this.chatId, text.slice(0, 4000));
    } catch (err: any) {
      console.error(`[Watcher] Alert send failed: ${err.message}`);
    }
  }
}

const watcher = new Watcher();
watcher.start().catch(err => {
  console.error(`[Watcher] Fatal: ${err.message}`);
  process.exit(1);
});
