/**
 * Telegram Bot
 *
 * Interactive Telegram bot for the sales automation system.
 * Handles callback queries for archiving jobs and regenerating proposals
 * directly from Telegram alert messages. Restricted to a single admin user.
 */

import { Bot } from 'grammy';
import { env } from '../config/env';
import { supabase, TABLES } from '../config/db';
import { aiRouter } from '../ai/router';
import { notifyTelegram } from './notifier';

const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

// Authorized User ID (matching the chat owner for simplicity)
const ADMIN_ID = parseInt(env.TELEGRAM_CHAT_ID);

bot.on('callback_query', async (ctx) => {
  if (ctx.from?.id !== ADMIN_ID) {
    await ctx.answerCallbackQuery('Unauthorized 🚫', { show_alert: true } as any);
    return;
  }

  const data = ctx.callbackQuery.data;
  if (!data) return;

  const [action, jobId] = data.split(':');

  if (action === 'archive_job') {
    const { error } = await supabase
      .from(TABLES.scrapedJobs)
      .update({ status: 'archived' })
      .eq('id', jobId);

    if (error) {
      await ctx.answerCallbackQuery(`Error: ${error.message}`, { show_alert: true } as any);
    } else {
      await ctx.answerCallbackQuery('تمت الأرشفة بنجاح 📁');
      // Cleanly remove buttons by editing message text
      const currentText = ctx.callbackQuery.message?.text || '';
      await ctx.editMessageText(currentText + '\n\n✅ *تمت الأرشفة*');
    }
  } else if (action === 'regenerate_proposal') {
    await ctx.answerCallbackQuery('جاري إنشاء عرض جديد... ⏳');
    
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

        // Notify the user that the update is ready for the next cycle/alert
        await notifyTelegram(`✅ *تم تجديد العرض بنجاح!*\n\nJob ID: ${jobId}\n\nالنسخة الجديدة ستظهر في التنبيه القادم.`);
      } else {
        await ctx.answerCallbackQuery('لم يتم إنشاء عرض جديد (لم يصل للحد الأدنى)', { show_alert: true } as any);
      }
    } catch (err: any) {
      console.error('[Bot] Regeneration error:', err);
      await ctx.answerCallbackQuery(`Error: ${err.message}`, { show_alert: true } as any);
    }
  }
});

/**
 * Start the Telegram bot and begin listening for callback queries.
 */
export async function startBot(): Promise<void> {
  console.log('[Telegram Bot] Starting...');
  await bot.start();
}
