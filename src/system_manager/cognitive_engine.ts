/**
 * Cognitive Engine — The Encyclopaedia Brain
 *
 * Central reasoning layer interfacing with the FreeLLMAPI cascade to
 * analyse job posts, ecosystem state, and past interactions. Injects
 * learning-memory context before every inference so the agent
 * dynamically self-corrects across sessions.
 */

import { litellm, type AIResponse } from '../services/litellm.js';
import { loadLearningContext, type LearningEntry } from './learning_memory.js';

export interface JobAnalysis {
  platform: string;
  title: string;
  budget: string;
  skills: string[];
  language: string;
  confidence: number;
  summary: string;
}

export interface ActionStrategy {
  shouldBid: boolean;
  bidAmount: number;
  proposalAngle: string;
  reasoning: string;
}

function buildSystemPrompt(context: LearningEntry[]): string {
  const lessons = context
    .slice(-10)
    .map((e) => `- [${e.outcome}] ${e.platform}: ${e.lesson}`)
    .join('\n');
  return `You are an elite freelance automation strategist — the Encyclopaedia Brain.
You have synthesised millions of successful project proposals and human interactions.
Your task is to analyse project listings and ecosystem signals precisely.

Past lessons learned (most recent first):
${lessons || '  (no prior experience recorded yet)'}

Rules:
- Analyse objectively. Never hallucinate skills or budgets.
- Output only valid JSON with the specified schema.
- Confidence score: 0.0–1.0 based on how well the listing matches our expertise.`;
}

export async function analyseJobPost(
  platform: string,
  rawText: string,
): Promise<JobAnalysis> {
  const context = await loadLearningContext();
  const systemPrompt = buildSystemPrompt(context);

  const prompt = `Analyse this freelance project listing from ${platform}:

---
${rawText.slice(0, 3000)}
---

Return a JSON object with these fields:
{
  "platform": "${platform}",
  "title": "Project title or first meaningful line",
  "budget": "Budget range if mentioned, or 'unspecified'",
  "skills": ["skill1", "skill2"],
  "language": "ar or en",
  "confidence": 0.0-1.0,
  "summary": "One-sentence description of what the client needs"
}`;

  const result: AIResponse = await litellm.call('lead-scorer', prompt, systemPrompt);
  return JSON.parse(result.text) as JobAnalysis;
}

export async function decideStrategy(
  analysis: JobAnalysis,
  context: Record<string, unknown>,
): Promise<ActionStrategy> {
  const lessons = await loadLearningContext();
  const systemPrompt = buildSystemPrompt(lessons);

  const prompt = `Given this job analysis and current context, decide the optimal action.

Job Analysis:
${JSON.stringify(analysis, null, 2)}

Context:
${JSON.stringify(context, null, 2)}

Return a JSON object:
{
  "shouldBid": true/false,
  "bidAmount": 0,
  "proposalAngle": "Short paragraph describing the proposal hook",
  "reasoning": "Why this action was chosen"
}`;

  const result: AIResponse = await litellm.call('proposal-generator', prompt, systemPrompt);
  return JSON.parse(result.text) as ActionStrategy;
}

export async function reflectOnOutcome(
  platform: string,
  action: string,
  outcome: 'success' | 'failure' | 'partial' | 'blocked',
  lesson: string,
): Promise<void> {
  const { appendLearning } = await import('./learning_memory.js');
  await appendLearning({
    timestamp: new Date().toISOString(),
    platform,
    action,
    outcome,
    lesson,
  });
}
