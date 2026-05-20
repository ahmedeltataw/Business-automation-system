/**
 * Google Gemini AI Client
 *
 * Provides inference via Google's Gemini models using the @google/genai SDK.
 * Supports dual API key rotation, structured JSON responses, and
 * exponential backoff on rate-limit (429) errors.
 */

import { env } from '../config/env';
import { agentConfig } from '../config/agentConfig';

/** Standardized AI response shape shared across all providers */
export interface AIResponse {
  text: string;
  tokensUsed: number;
  modelUsed: string;
}

const G = agentConfig.ai.gemini;

/** Gemini SDK generateContent config shape */
interface GeminiConfig {
  systemInstruction?: string;
  responseMimeType?: string;
  responseSchema?: Record<string, unknown>;
}

/**
 * Gemini API client with lazy initialization and retry logic.
 */
class GeminiClient {
  private client: any = null;

  /** Initialize the Gemini SDK client (lazy, on first call) */
  async init(): Promise<void> {
    if (this.client) return;
    const { GoogleGenAI } = await import('@google/genai');
    this.client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  }

  /**
   * Send a prompt to a specific Gemini model.
   * @param modelName - Model identifier (e.g. gemini-2.5-flash)
   * @param prompt - User prompt text
   * @param systemPrompt - Optional system instruction
   */
  async call(
    modelName: string,
    prompt: string,
    systemPrompt?: string
  ): Promise<AIResponse> {
    await this.init();
    const startTime = Date.now();

    const config: GeminiConfig = {};
    if (systemPrompt) {
      config.systemInstruction = systemPrompt;
    }

    let lastError: Error | null = null;

    for (let i = 0; i < G.retryAttempts.length; i++) {
      try {
        const response = await this.client!.models.generateContent({
          model: modelName,
          contents: prompt,
          config,
        });

        const text = response.text?.trim() ?? '';
        const tokens = response.usageMetadata?.totalTokenCount ?? 0;

        const duration = Date.now() - startTime;
        console.log(`[Gemini] ${modelName} | ${tokens} tokens | ${duration}ms`);

        return { text, tokensUsed: tokens, modelUsed: modelName };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        lastError = err instanceof Error ? err : new Error(message);

        if (message.includes('429') || message.includes('RESOURCE_EXHAUSTED')) {
          if (i < G.retryWaits429.length) {
            console.log(`[Gemini] Rate limited, waiting ${G.retryWaits429[i]}ms (attempt ${i + 1})`);
            await new Promise((resolve) => setTimeout(resolve, G.retryWaits429[i]));
            continue;
          }
          throw new Error(`RateLimitError: ${message}`);
        }

        if (message.includes('503') || message.includes('UNAVAILABLE')) {
          throw new Error(`ModelUnavailableError: ${message}`);
        }

        throw new Error(`GeminiError: ${message}`);
      }
    }

    throw lastError ?? new Error('Unknown Gemini error');
  }

  /**
   * Send a prompt expecting schema-constrained JSON output.
   * @param modelName - Model identifier
   * @param prompt - User prompt text
   * @param systemInstruction - System instruction
   * @param schema - JSON schema for response validation
   */
  async callWithSchema(
    modelName: string,
    prompt: string,
    systemInstruction: string,
    schema: Record<string, unknown>
  ): Promise<AIResponse> {
    await this.init();
    const startTime = Date.now();

    const config: GeminiConfig = {
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: schema,
    };

    let lastError: Error | null = null;

    for (let i = 0; i < G.retryAttempts.length; i++) {
      try {
        const response = await this.client!.models.generateContent({
          model: modelName,
          contents: prompt,
          config,
        });

        const text = response.text?.trim() ?? '';
        const tokens = response.usageMetadata?.totalTokenCount ?? 0;
        const duration = Date.now() - startTime;
        console.log(`[Gemini] ${modelName} (schema) | ${tokens} tokens | ${duration}ms`);

        return { text, tokensUsed: tokens, modelUsed: modelName };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        lastError = err instanceof Error ? err : new Error(message);

        if (message.includes('429') || message.includes('RESOURCE_EXHAUSTED')) {
          if (i < G.retryWaits429.length) {
            console.log(`[Gemini] Rate limited, waiting ${G.retryWaits429[i]}ms (attempt ${i + 1})`);
            await new Promise((resolve) => setTimeout(resolve, G.retryWaits429[i]));
            continue;
          }
          throw new Error(`RateLimitError: ${message}`);
        }

        if (message.includes('503') || message.includes('UNAVAILABLE')) {
          throw new Error(`ModelUnavailableError: ${message}`);
        }

        throw new Error(`GeminiError: ${message}`);
      }
    }

    throw lastError ?? new Error('Unknown Gemini error');
  }
}

export const gemini = new GeminiClient();
