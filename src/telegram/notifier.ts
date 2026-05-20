/**
 * Telegram Notifier
 *
 * Sends formatted messages to a Telegram chat with optional inline keyboard
 * buttons for interactive actions (archive, regenerate proposal). Includes
 * automatic Markdown-to-plaintext fallback on parse errors.
 */

import { Bot, InlineKeyboard } from 'grammy';
import { env } from '../config/env';

const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

/**
 * Send a formatted message to the configured Telegram chat.
 * @param message - Message text (Markdown supported)
 * @param jobId - Optional job ID for inline action buttons
 * @param url - Optional URL for a direct link button
 */
export async function notifyTelegram(
  message: string,
  jobId?: string,
  url?: string
): Promise<void> {
  const keyboard = new InlineKeyboard();
  
  if (jobId) {
    keyboard.row()
      .text('📁 أرشفة', `archive_job:${jobId}`)
      .text('🔄 إعادة صياغة', `regenerate_proposal:${jobId}`);
    
    if (url) {
      keyboard.row().url('🟢 فتح الرابط مباشرة', url);
    }
  }

  try {
    await bot.api.sendMessage(env.TELEGRAM_CHAT_ID, message, { 
      parse_mode: 'Markdown',
      reply_markup: jobId ? keyboard : undefined
    });
  } catch (err: any) {
    if (err?.error_code === 400 && err?.description?.includes('can\'t parse entities')) {
      console.warn('Telegram Markdown parse error, retrying without formatting...');
      const plainMessage = message.replace(/[*_`]/g, '').replace(/\[(.+?)\]\(.+?\)/g, '$1');
      await bot.api.sendMessage(env.TELEGRAM_CHAT_ID, plainMessage, {
        reply_markup: jobId ? keyboard : undefined
      });
    } else {
      console.error('Telegram notify failed:', err);
    }
  }
}
