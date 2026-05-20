/**
 * Cloudflare Workers AI Client
 *
 * Provides inference via Cloudflare's serverless AI Workers.
 * Supports automatic fallback across multiple Cloudflare-hosted models
 * with per-request timeout and rate-limit recovery.
 */

import { env } from '../config/env';
import { agentConfig } from '../config/agentConfig';

/** Standardized AI response shape shared across all providers */
export interface AIResponse {
  text: string;
  tokensUsed: number;
  modelUsed: string;
}

const CF_MODELS = agentConfig.ai.cloudflare.models;
const CF = agentConfig.ai.cloudflare;

/**
 * Cloudflare Workers AI client with model fallback chain.
 */
class CloudflareAI {
  /** Dispatch a prompt with optional system instruction */
  async call(prompt: string, systemPrompt?: string): Promise<AIResponse> {
    return this.callWithFallback(prompt, systemPrompt);
  }

  /** Dispatch a prompt expecting schema-constrained JSON output */
  async callWithSchema(prompt: string, systemPrompt: string, schema: unknown): Promise<AIResponse> {
    const schemaPrompt = `\nRespond with valid JSON matching this schema:\n${JSON.stringify(schema, null, 2)}`;
    return this.call(prompt + schemaPrompt, systemPrompt);
  }

  /** Execute with automatic model fallback on rate-limit or failure */
  async callWithFallback(prompt: string, systemPrompt?: string): Promise<AIResponse> {
    const startTime = Date.now();
    const accountId = env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = env.CLOUDFLARE_API_TOKEN;

    if (!accountId || !apiToken) {
      throw new Error('CloudflareAI: missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN');
    }

    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    let lastError: Error | null = null;

    for (const model of CF_MODELS) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), CF.timeoutMs);

      try {
        const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ messages }),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
          const errBody = await response.text().catch(() => '');
          throw new Error(`HTTP ${response.status}: ${errBody.slice(0, 200)}`);
        }

        const data: { result?: { response?: string } } = await response.json();
        const text = data.result?.response?.trim() ?? '';

        if (!text) {
          throw new Error('CloudflareAI: empty response');
        }

        const duration = Date.now() - startTime;
        const estimatedTokens = Math.round(text.length / 4);
        console.log(`[Cloudflare] ${model} | ~${estimatedTokens} tokens | ${duration}ms`);

        return { text, tokensUsed: estimatedTokens, modelUsed: `cloudflare/${model}` };
      } catch (err: unknown) {
        clearTimeout(timeout);
        const message = err instanceof Error ? err.message : String(err);
        lastError = err instanceof Error ? err : new Error(message);
        const isRateLimit = message.includes('429') || message.includes('rate limit');
        if (isRateLimit) {
          console.log(`[Cloudflare] ${model} rate limited, trying next...`);
          continue;
        }
        console.log(`[Cloudflare] ${model} failed: ${message}`);
        break;
      }
    }

    throw new Error(`CloudflareAIError (all models failed): ${lastError?.message}`);
  }
}

export const cloudflareAI = new CloudflareAI();
