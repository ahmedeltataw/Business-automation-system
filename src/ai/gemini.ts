import { env } from '../config/env';
import { agentConfig } from '../config/agentConfig';

export interface AIResponse {
  text: string;
  tokensUsed: number;
  modelUsed: string;
}

const G = agentConfig.ai.gemini;

class GeminiClient {
  private client: any = null;

  async init(): Promise<void> {
    if (this.client) return;
    const { GoogleGenAI } = await import('@google/genai') as any;
    this.client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  }

  async call(
    modelName: string,
    prompt: string,
    systemPrompt?: string
  ): Promise<AIResponse> {
    await this.init();
    const startTime = Date.now();

    const config: any = {};
    if (systemPrompt) {
      config.systemInstruction = systemPrompt;
    }

    let lastError: Error | null = null;

    for (const attempt of G.retryAttempts) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), G.timeoutMs);

        const response = await this.client.models.generateContent({
          model: modelName,
          contents: prompt,
          config,
        });

        clearTimeout(timeout);

        const text = response.text?.trim() ?? '';
        const tokens = response.usageMetadata?.totalTokenCount ?? 0;

        const duration = Date.now() - startTime;
        console.log(`[Gemini] ${modelName} | ${tokens} tokens | ${duration}ms`);

        return { text, tokensUsed: tokens, modelUsed: modelName };
      } catch (err: any) {
        lastError = err;

        if (err.message?.includes('429') || err.message?.includes('RESOURCE_EXHAUSTED')) {
          const idx = G.retryAttempts.indexOf(attempt);
          if (idx < G.retryWaits429.length) {
            console.log(`[Gemini] Rate limited, waiting ${G.retryWaits429[idx]}ms (attempt ${attempt})`);
            await new Promise(r => setTimeout(r, G.retryWaits429[idx]));
            continue;
          }
          throw new Error(`RateLimitError: ${err.message}`);
        }

        if (err.message?.includes('503') || err.message?.includes('UNAVAILABLE')) {
          throw new Error(`ModelUnavailableError: ${err.message}`);
        }

        throw new Error(`GeminiError: ${err.message}`);
      }
    }

    throw lastError || new Error('Unknown Gemini error');
  }

  async callWithSchema(
    modelName: string,
    prompt: string,
    systemInstruction: string,
    schema: object
  ): Promise<AIResponse> {
    await this.init();
    const startTime = Date.now();

    const config: any = {
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: schema,
    };

    let lastError: Error | null = null;

    for (const attempt of G.retryAttempts) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), G.timeoutMs);

        const response = await this.client.models.generateContent({
          model: modelName,
          contents: prompt,
          config,
        });

        clearTimeout(timeout);

        const text = response.text?.trim() ?? '';
        const tokens = response.usageMetadata?.totalTokenCount ?? 0;
        const duration = Date.now() - startTime;
        console.log(`[Gemini] ${modelName} (schema) | ${tokens} tokens | ${duration}ms`);

        return { text, tokensUsed: tokens, modelUsed: modelName };
      } catch (err: any) {
        lastError = err;
        if (err.message?.includes('429') || err.message?.includes('RESOURCE_EXHAUSTED')) {
          const idx = G.retryAttempts.indexOf(attempt);
          if (idx < G.retryWaits429.length) {
            console.log(`[Gemini] Rate limited, waiting ${G.retryWaits429[idx]}ms (attempt ${attempt})`);
            await new Promise(r => setTimeout(r, G.retryWaits429[idx]));
            continue;
          }
          throw new Error(`RateLimitError: ${err.message}`);
        }
        if (err.message?.includes('503') || err.message?.includes('UNAVAILABLE')) {
          throw new Error(`ModelUnavailableError: ${err.message}`);
        }
        throw new Error(`GeminiError: ${err.message}`);
      }
    }

    throw lastError || new Error('Unknown Gemini error');
  }
}

export const gemini = new GeminiClient();
