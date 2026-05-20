/**
 * LiteLLM Unified AI Gateway
 *
 * Central routing layer for all AI providers (FreeLLMAPI, Cloudflare, Gemini,
 * Groq, DeepSeek, Hugging Face, OpenRouter). Resolves functional aliases
 * (e.g. 'free-lead-scorer') to provider-specific model chains with automatic
 * fallback, per-model cooldown, and schema-constrained JSON generation.
 */

import { env } from '../config/env';

/** Standardized AI response shape shared across all providers */
export interface AIResponse {
  text: string;
  tokensUsed: number;
  modelUsed: string;
}

/** Named group of models that serve a specific functional role */
export interface ModelAlias {
  name: string;
  models: string[];
}

// FreeLLMAPI unified proxy — single key, 9 providers
const FREELLM_API_URL = env.FREELLM_API_URL || 'http://localhost:3001/v1';
const FREELLM_API_KEY = env.FREELLM_API_KEY;

const ALIASES: Record<string, ModelAlias> = {
  'free-lead-scorer': {
    name: 'free-lead-scorer',
    models: [
      // Tier 1 — Core (highest quality)
      'free-llm/gemini-2.5-flash',
      'free-llm/groq/llama-3.3-70b-versatile',
      'free-llm/deepseek-chat',
      // Tier 2 — Ultra-Fast & Edge
      'free-llm/cerebras/qwen3-235b-a22b',
      'free-llm/sambanova/llama-4-scout',
      'free-llm/cloudflare/kimi-k2.6',
      // Tier 3 — Premium Heavy Fallbacks
      'free-llm/github/gpt-4o',
      'free-llm/zhipu/glm-4.7-flash',
      'free-llm/cohere/command-r-plus',
    ],
  },
  'free-proposal-generator': {
    name: 'free-proposal-generator',
    models: [
      // Tier 1 — Core (best for creative Arabic text)
      'free-llm/gemini-2.5-flash',
      'free-llm/deepseek-chat',
      'free-llm/groq/llama-3.3-70b-versatile',
      // Tier 2 — Ultra-Fast & Edge
      'free-llm/cerebras/qwen3-235b-a22b',
      'free-llm/sambanova/llama-4-scout',
      'free-llm/cloudflare/kimi-k2.6',
      // Tier 3 — Premium Heavy Fallbacks
      'free-llm/github/gpt-4o',
      'free-llm/zhipu/glm-4.7-flash',
      'free-llm/cohere/command-r-plus',
    ],
  },
  'free-backup-agent': {
    name: 'free-backup-agent',
    models: [
      'free-llm/gemini-2.5-flash',
      'free-llm/groq/llama-3.3-70b-versatile',
      'free-llm/deepseek-chat',
      'free-llm/cerebras/qwen3-235b-a22b',
      'free-llm/sambanova/llama-4-scout',
      'free-llm/cloudflare/kimi-k2.6',
      'free-llm/github/gpt-4o',
      'free-llm/zhipu/glm-4.7-flash',
      'free-llm/cohere/command-r-plus',
    ],
  },
  'lead-scorer': {
    name: 'lead-scorer',
    models: [
      'cloudflare/@cf/meta/llama-3.1-8b-instruct',
      'gemini-2.5-flash',
      'groq/llama3-8b-8192',
    ],
  },
  'proposal-generator': {
    name: 'proposal-generator',
    models: [
      'deepseek/deepseek-chat',
      'gemini-2.5-flash',
      'cloudflare/@cf/meta/llama-3.3-70b-instruct',
    ],
  },
  'backup-agent': {
    name: 'backup-agent',
    models: [
      'gemini-2.5-flash',
      'groq/llama-3.3-70b-versatile',
      'hf/meta-llama/Llama-3.3-70B-Instruct',
    ],
  },
};

const COOLDOWN_MS: Record<string, number> = {};
const COOLDOWN_DURATION = 60_000;

class LiteLLMGateway {
  async call(
    alias: string,
    prompt: string,
    systemPrompt?: string,
    schema?: object
  ): Promise<AIResponse> {
    const models = this.resolveModels(alias);
    if (models.length === 0) {
      throw new Error(`LiteLLM: unknown alias "${alias}"`);
    }

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    let lastError: Error | null = null;

    for (const model of models) {
      if (this.isInCooldown(model)) {
        console.log(`[LiteLLM] ${model} in cooldown, skipping`);
        continue;
      }

      try {
        const result = await this.dispatch(model, messages, schema);
        return result;
      } catch (err: any) {
        lastError = err;
        const isRateLimit = err.message?.includes('429') ||
          err.message?.includes('rate limit') ||
          err.message?.includes('RESOURCE_EXHAUSTED') ||
          err.message?.includes('quota');
        const isMissingKey = err.message?.includes('not set') || err.message?.includes('missing');

        if (isRateLimit) {
          console.log(`[LiteLLM] ${model} rate limited, entering cooldown`);
          COOLDOWN_MS[model] = Date.now() + COOLDOWN_DURATION;
          continue;
        }
        if (isMissingKey) {
          console.log(`[LiteLLM] ${model} skipped (key not configured), trying next`);
          continue;
        }

        console.log(`[LiteLLM] ${model} failed: ${err.message}`);
        break;
      }
    }

    throw new Error(`LiteLLM: all models failed for alias "${alias}": ${lastError?.message}`);
  }

  async callWithSchema(
    alias: string,
    prompt: string,
    systemPrompt: string,
    schema: object
  ): Promise<AIResponse> {
    const schemaPrompt = `\nRespond with valid JSON matching this schema:\n${JSON.stringify(schema, null, 2)}`;
    return this.call(alias, prompt + schemaPrompt, systemPrompt, schema);
  }

  async callRaw(
    model: string,
    prompt: string,
    systemPrompt?: string,
    schema?: object
  ): Promise<AIResponse> {
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    return this.dispatch(model, messages, schema);
  }

  getAliasModels(alias: string): string[] {
    return this.resolveModels(alias);
  }

  private resolveModels(alias: string): string[] {
    if (ALIASES[alias]) {
      return ALIASES[alias].models;
    }
    return [alias];
  }

  private isInCooldown(model: string): boolean {
    const until = COOLDOWN_MS[model];
    if (until && Date.now() < until) return true;
    if (until && Date.now() >= until) {
      delete COOLDOWN_MS[model];
    }
    return false;
  }

  private async dispatch(
    model: string,
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    schema?: object
  ): Promise<AIResponse> {
    const startTime = Date.now();

    if (model.startsWith('free-llm/')) {
      return this.callFreeLLM(model, messages, startTime);
    }
    if (model.startsWith('cloudflare/')) {
      return this.callCloudflare(model, messages, startTime);
    }
    if (model.startsWith('gemini') || model.startsWith('gemma')) {
      return this.callGemini(model, messages, schema, startTime);
    }
    if (model.startsWith('groq/')) {
      return this.callGroq(model, messages, startTime);
    }
    if (model.startsWith('deepseek/')) {
      return this.callDeepSeek(model, messages, startTime);
    }
    if (model.startsWith('hf/')) {
      return this.callHuggingFace(model, messages, startTime);
    }
    if (model.startsWith('openrouter/')) {
      return this.callOpenRouter(model, messages, startTime);
    }

    throw new Error(`LiteLLM: unsupported provider prefix for model "${model}"`);
  }

  private async callFreeLLM(
    model: string,
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    startTime: number
  ): Promise<AIResponse> {
    if (!FREELLM_API_KEY) {
      throw new Error('FreeLLMAPI: missing FREELLM_API_KEY');
    }

    const modelName = model.replace('free-llm/', '');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);

    try {
      const response = await fetch(`${FREELLM_API_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${FREELLM_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: modelName,
          messages,
          max_tokens: 2000,
          temperature: 0.7,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        throw new Error(`FreeLLMAPI HTTP ${response.status}: ${errBody.slice(0, 300)}`);
      }

      const data: any = await response.json();
      const text = data.choices?.[0]?.message?.content?.trim() ?? '';
      const tokens = data.usage?.total_tokens ?? Math.round(text.split(/\s+/).length * 1.3);
      const duration = Date.now() - startTime;
      console.log(`[LiteLLM] free-llm/${modelName} | ${tokens} tokens | ${duration}ms`);

      return { text, tokensUsed: tokens, modelUsed: `free-llm/${modelName}` };
    } catch (err: any) {
      clearTimeout(timeout);
      throw err;
    }
  }

  private async callCloudflare(
    model: string,
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    startTime: number
  ): Promise<AIResponse> {
    const accountId = env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = env.CLOUDFLARE_API_TOKEN;
    if (!accountId || !apiToken) {
      throw new Error('Cloudflare: missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN');
    }

    const modelName = model.replace('cloudflare/', '');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${modelName}`;
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

      const data: any = await response.json();
      const text = data.result?.response?.trim() ?? '';
      if (!text) throw new Error('Cloudflare: empty response');

      const duration = Date.now() - startTime;
      const estimatedTokens = text.length / 4;
      console.log(`[LiteLLM] cloudflare/${modelName} | ~${estimatedTokens} tokens | ${duration}ms`);

      return { text, tokensUsed: estimatedTokens, modelUsed: `cloudflare/${modelName}` };
    } catch (err: any) {
      clearTimeout(timeout);
      throw err;
    }
  }

  private async callGemini(
    model: string,
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    schema: object | undefined,
    startTime: number
  ): Promise<AIResponse> {
    const { GoogleGenAI } = await import('@google/genai');
    const useKey2 = model.endsWith(':key2');
    const apiKey = useKey2 ? env.GEMINI_API_KEY_2 : env.GEMINI_API_KEY;
    if (!apiKey) {
      console.log(`[LiteLLM] ${model} skipped — ${useKey2 ? 'GEMINI_API_KEY_2' : 'GEMINI_API_KEY'} not set`);
      throw new Error(`Gemini: missing ${useKey2 ? 'GEMINI_API_KEY_2' : 'GEMINI_API_KEY'}`);
    }

    const modelName = model.replace(':key2', '');
    const client = new GoogleGenAI({ apiKey });

    const userContent = messages.find(m => m.role === 'user')?.content ?? '';
    const systemContent = messages.find(m => m.role === 'system')?.content;

    const config: any = {};
    if (systemContent) config.systemInstruction = systemContent;
    if (schema) {
      config.responseMimeType = 'application/json';
      config.responseSchema = schema;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await client.models.generateContent({
        model: modelName,
        contents: userContent,
        config,
      });

      clearTimeout(timeout);

      const text = response.text?.trim() ?? '';
      const tokens = response.usageMetadata?.totalTokenCount ?? 0;
      const duration = Date.now() - startTime;
      console.log(`[LiteLLM] ${modelName} | ${tokens} tokens | ${duration}ms`);

      return { text, tokensUsed: tokens, modelUsed: modelName };
    } catch (err: any) {
      clearTimeout(timeout);
      throw err;
    }
  }

  private async callGroq(
    model: string,
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    startTime: number
  ): Promise<AIResponse> {
    const { Groq } = await import('groq-sdk');
    const useKey2 = model.endsWith(':key2');
    const apiKey = useKey2 ? env.GROQ_API_KEY_2 : env.GROQ_API_KEY;
    if (!apiKey) {
      console.log(`[LiteLLM] ${model} skipped — ${useKey2 ? 'GROQ_API_KEY_2' : 'GROQ_API_KEY'} not set`);
      throw new Error(`Groq: missing ${useKey2 ? 'GROQ_API_KEY_2' : 'GROQ_API_KEY'}`);
    }

    const modelName = model.replace(':key2', '').replace('groq/', '');
    const client = new Groq({ apiKey });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    try {
      const response = await client.chat.completions.create({
        model: modelName,
        messages,
        temperature: 0.7,
        max_tokens: 1500,
      });

      clearTimeout(timeout);

      const text = response.choices?.[0]?.message?.content?.trim() ?? '';
      const tokens = response.usage?.total_tokens ?? 0;
      const duration = Date.now() - startTime;
      console.log(`[LiteLLM] groq/${modelName} | ${tokens} tokens | ${duration}ms`);

      return { text, tokensUsed: tokens, modelUsed: `groq/${modelName}` };
    } catch (err: any) {
      clearTimeout(timeout);
      throw err;
    }
  }

  private async callDeepSeek(
    model: string,
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    startTime: number
  ): Promise<AIResponse> {
    const apiKey = env.DEEPSEEK_API_KEY || env.GROQ_API_KEY;
    if (!apiKey) throw new Error('DeepSeek: missing DEEPSEEK_API_KEY');

    const modelName = model.replace('deepseek/', '');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: modelName,
          messages,
          max_tokens: 2000,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}: ${errBody.slice(0, 200)}`);
      }

      const data: any = await response.json();
      const text = data.choices?.[0]?.message?.content?.trim() ?? '';
      const tokens = data.usage?.total_tokens ?? 0;
      const duration = Date.now() - startTime;
      console.log(`[LiteLLM] deepseek/${modelName} | ${tokens} tokens | ${duration}ms`);

      return { text, tokensUsed: tokens, modelUsed: `deepseek/${modelName}` };
    } catch (err: any) {
      clearTimeout(timeout);
      throw err;
    }
  }

  private async callHuggingFace(
    model: string,
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    startTime: number
  ): Promise<AIResponse> {
    const hfToken = env.HF_TOKEN;
    if (!hfToken) throw new Error('HuggingFace: missing HF_TOKEN');

    const modelName = model.replace('hf/', '');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch('https://router.huggingface.co/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${hfToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: modelName,
          messages,
          max_tokens: 2000,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData.error?.message || errorData.error || response.statusText;
        throw new Error(`HF ${response.status}: ${errorMsg}`);
      }

      const data: any = await response.json();
      const text = data.choices?.[0]?.message?.content ?? JSON.stringify(data);
      const tokens = data.usage?.total_tokens ?? Math.round(text.split(/\s+/).length * 1.3);
      const duration = Date.now() - startTime;
      console.log(`[LiteLLM] hf/${modelName} | ${tokens} tokens | ${duration}ms`);

      return { text, tokensUsed: tokens, modelUsed: `hf/${modelName}` };
    } catch (err: any) {
      clearTimeout(timeout);
      throw err;
    }
  }

  private async callOpenRouter(
    model: string,
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    startTime: number
  ): Promise<AIResponse> {
    const apiKey = env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OpenRouter: missing OPENROUTER_API_KEY');

    const modelName = model.replace('openrouter/', '');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/ahmedeltataw/Business-automation-system',
          'X-Title': 'Freelance Sales Automation',
        },
        body: JSON.stringify({
          model: modelName,
          messages,
          max_tokens: 2000,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}: ${errBody.slice(0, 200)}`);
      }

      const data: any = await response.json();
      const text = data.choices?.[0]?.message?.content?.trim() ?? '';
      const tokens = data.usage?.total_tokens ?? 0;
      const duration = Date.now() - startTime;
      console.log(`[LiteLLM] openrouter/${modelName} | ${tokens} tokens | ${duration}ms`);

      return { text, tokensUsed: tokens, modelUsed: `openrouter/${modelName}` };
    } catch (err: any) {
      clearTimeout(timeout);
      throw err;
    }
  }
}

export const litellm = new LiteLLMGateway();
export { ALIASES };
