/**
 * Hugging Face AI Client
 *
 * Provides inference via Hugging Face Inference Providers using the
 * OpenAI-compatible endpoint at router.huggingface.co. Throws custom
 * errors for auth/path failures to signal upstream fallback.
 */

import { env } from '../config/env';

export interface AIResponse {
  text: string;
  modelUsed: string;
  tokensUsed: number;
}

interface HFMessage {
  role: string;
  content: string;
}

interface HFErrorBody {
  error?: { message?: string } | string;
}

export class AllModelsExhaustedError extends Error {
  constructor() {
    super('All Hugging Face models exhausted');
    this.name = 'AllModelsExhaustedError';
  }
}

class HuggingFace {
  private readonly hfToken = env.HF_TOKEN;
  private readonly apiUrl = 'https://router.huggingface.co/v1/chat/completions';

  async call(
    modelName: string,
    prompt: string,
    systemPrompt?: string
  ): Promise<AIResponse> {
    if (!this.hfToken) {
      throw new Error('HF_TOKEN is not defined in environment variables');
    }

    const messages: HFMessage[] = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.hfToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelName,
        messages,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const errorData: HFErrorBody = await response.json().catch(() => ({}));
      const errorMsg =
        typeof errorData.error === 'object'
          ? errorData.error?.message ?? ''
          : typeof errorData.error === 'string'
            ? errorData.error
            : response.statusText;

      if (response.status === 401 || response.status === 404) {
        throw new Error(
          '[HF Provider Error]: Path or Auth invalid, cascading to Gemini Flash.'
        );
      }

      if (response.status === 429) {
        throw new Error(`Hugging Face Rate Limit (429): ${errorMsg}`);
      }

      throw new Error(`Hugging Face API Error (${response.status}): ${errorMsg}`);
    }

    const data: Record<string, unknown> = await response.json();
    const choices = data.choices as Array<{ message?: { content?: string } }> | undefined;
    const text = choices?.[0]?.message?.content ?? JSON.stringify(data);

    const usage = data.usage as { total_tokens?: number } | undefined;
    const tokensUsed =
      usage?.total_tokens ?? Math.round(String(text).split(/\s+/).length * 1.3);

    return { text, modelUsed: modelName, tokensUsed };
  }
}

export const huggingface = new HuggingFace();
