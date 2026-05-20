import { supabase } from '../config/db';

const MODEL_LIMITS: Record<string, number> = {
  'gemma-4-31b-it': 1500,
  'gemma-4-26b-a4b-it': 1500,
  'gemini-2.5-flash': 20,
  'gemini-2.0-flash': 0,
  'gemini-2.5-pro': 25,
  'groq/llama-3-70b': 999999,
  'groq/llama3-8b-8192': 999999,
  'groq/llama-3.3-70b-versatile': 999999,
  'hf/meta-llama/Llama-3.3-70B-Instruct': 500,
  'hf/deepseek-ai/DeepSeek-V3': 500,
  'hf/facebook/opt-125m': 500,
  'cloudflare/@cf/meta/llama-3.1-8b-instruct': 10000,
  'cloudflare/@cf/meta/llama-3.3-70b-instruct': 10000,
  'deepseek/deepseek-chat': 500,
};



function todayDate(): string {
  const cairo = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  return cairo;
}

export async function getUsageToday(modelName: string): Promise<number> {
  const date = todayDate();
  const { count, error } = await supabase
    .from('ai_usage_log')
    .select('id', { count: 'exact', head: true })
    .eq('model_name', modelName)
    .eq('date', date);

  if (error) {
    console.error(`[UsageTracker] getUsageToday error:`, error.message);
    return 0;
  }

  return count ?? 0;
}

export async function isModelAvailable(modelName: string): Promise<boolean> {
  const limit = MODEL_LIMITS[modelName];
  if (limit === undefined) return false;
  const used = await getUsageToday(modelName);
  return used < limit;
}

export async function logUsage(
  modelName: string,
  tokensUsed: number,
  endpoint: string
): Promise<void> {
  const { error } = await supabase.from('ai_usage_log').insert({
    model_name: modelName,
    tokens_used: tokensUsed,
    endpoint,
    date: todayDate(),
  });

  if (error) {
    console.error(`[UsageTracker] logUsage error:`, error.message);
  }
}

export async function getTotalUsageToday(): Promise<Record<string, { used: number; limit: number; percentage: number }>> {
  const date = todayDate();
  const { data, error } = await supabase
    .from('ai_usage_log')
    .select('model_name')
    .eq('date', date);

  if (error) {
    console.error('[UsageTracker] getTotalUsageToday error:', error.message);
    return {};
  }

  const counts: Record<string, number> = {};
  for (const row of data || []) {
    counts[row.model_name] = (counts[row.model_name] || 0) + 1;
  }

  const result: Record<string, { used: number; limit: number; percentage: number }> = {};
  for (const [model, limit] of Object.entries(MODEL_LIMITS)) {
    const used = counts[model] || 0;
    result[model] = {
      used,
      limit,
      percentage: limit === 999999 ? 0 : Math.round((used / limit) * 100 * 10) / 10,
    };
  }

  return result;
}

export async function getUsageSummaryMessage(): Promise<string> {
  const usage = await getTotalUsageToday();

  const labels: Record<string, string> = {
    'gemma-4-31b-it': 'Gemma 4 31B',
    'gemma-4-26b-a4b-it': 'Gemma 4 26B',
    'gemini-2.5-flash': 'Gemini 2.5 Flash',
    'gemini-2.0-flash': 'Gemini 2.0 Flash',
    'gemini-2.5-pro': 'Gemini 2.5 Pro',
    'groq/llama-3-70b': 'Groq Llama-3',
    'groq/llama3-8b-8192': 'Groq Llama-3 8B',
    'groq/llama-3.3-70b-versatile': 'Groq Llama-3.3 70B',
    'hf/meta-llama/Llama-3.3-70B-Instruct': 'HF Llama-3.3',
    'hf/deepseek-ai/DeepSeek-V3': 'HF DeepSeek V3',
    'cloudflare/@cf/meta/llama-3.1-8b-instruct': 'CF Llama-3.1 8B',
    'cloudflare/@cf/meta/llama-3.3-70b-instruct': 'CF Llama-3.3 70B',
    'deepseek/deepseek-chat': 'DeepSeek Chat',
  };

  const lines = ['📊 *تقرير استهلاك AI اليوم:*', ''];
  for (const [model, info] of Object.entries(usage)) {
    const label = labels[model] || model;
    const limitStr = info.limit === 999999 ? '∞' : String(info.limit);
    const percentStr = info.limit === 999999 ? '' : ` (${info.percentage}%)`;
    lines.push(`• ${label}: ${info.used}/${limitStr}${percentStr}`);
  }

  return lines.join('\n');
}
