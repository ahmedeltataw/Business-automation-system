import { env } from '../config/env';
import { agentConfig } from '../config/agentConfig';

export interface AIResponse {
  text: string;
  tokensUsed: number;
  modelUsed: string;
}

const GROQ_MODELS = agentConfig.ai.groq.models;

const GR = agentConfig.ai.groq;

class GroqClient {
  private clients: any[] = [];
  private apiKeys: string[] = [];
  private currentKeyIndex = 0;

  async init(): Promise<void> {
    if (this.clients.length > 0) return;
    const { Groq } = await import('groq-sdk') as any;

    this.apiKeys = [env.GROQ_API_KEY, env.GROQ_API_KEY_2].filter(Boolean);
    this.clients = this.apiKeys.map((key) => new Groq({ apiKey: key }));
  }

  private rotateKey(): void {
    this.currentKeyIndex = (this.currentKeyIndex + 1) % this.clients.length;
  }

  private get currentClient(): any {
    return this.clients[this.currentKeyIndex];
  }

  async call(prompt: string, systemPrompt?: string): Promise<AIResponse> {
    return this.callWithFallback(prompt, systemPrompt);
  }

  async callWithFallback(prompt: string, systemPrompt?: string): Promise<AIResponse> {
    await this.init();
    const startTime = Date.now();

    const messages: any[] = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt || 'You are a helpful assistant for a freelance professional.' });
    }
    messages.push({ role: 'user', content: prompt });

    let lastError: Error | null = null;

    for (const model of GROQ_MODELS) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), GR.timeoutMs);

      try {
        const response = await this.currentClient.chat.completions.create({
          model,
          messages,
          temperature: GR.temperature,
          max_tokens: GR.maxTokens,
        });

        clearTimeout(timeout);

        const text = response.choices?.[0]?.message?.content?.trim() ?? '';
        const tokens = response.usage?.total_tokens ?? 0;
        const duration = Date.now() - startTime;

        console.log(`[Groq] ${model} | ${tokens} tokens | ${duration}ms`);

        return { text, tokensUsed: tokens, modelUsed: `groq/${model}` };
      } catch (err: any) {
        clearTimeout(timeout);
        lastError = err;
        const isRateLimit = err.status === 429 || (err.message && err.message.includes('rate_limit'));
        if (isRateLimit && this.clients.length > 1 && GR.keyRotationEnabled) {
          console.log(`[Groq] ${model} key #${this.currentKeyIndex + 1} rate limited, rotating...`);
          this.rotateKey();
          continue;
        }
        console.log(`[Groq] ${model} failed: ${err.message}`);
        break;
      }
    }

    throw new Error(`GroqError (all models failed): ${lastError?.message}`);
  }
}

export const groq = new GroqClient();
