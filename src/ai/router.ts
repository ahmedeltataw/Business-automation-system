/**
 * AI Router
 *
 * Central routing layer for all AI model calls via LiteLLM. Handles job
 * analysis with structured JSON output, proposal generation, and quota
 * management. Enforces validation on all analysis responses.
 */

/**
 * AI Router & Job Analyzer
 *
 * Central routing layer for AI-powered freelance job analysis. Sends job
 * postings through the LiteLLM gateway with a detailed system prompt that
 * scores relevance, predicts tech stack, identifies pain points, and generates
 * Arabic proposals. Includes JSON extraction, validation, and quota tracking.
 */

import { litellm, ALIASES } from '../services/litellm';
import { isModelAvailable, logUsage } from './usageTracker';

const SYSTEM_INSTRUCTION = `You are a specialized freelance job analyzer for a development team whose core stack is:
- **UI/UX**: Figma (wireframing, prototyping, user flows, visual design)
- **Websites & Webapps**: HTML, CSS, JavaScript, React (frontend) + PHP, Laravel (backend)
- **Mobile Apps**: Flutter for cross-platform Android & iOS

## Core Focus Areas (Score 5/5)
1. **UI/UX**: Figma-based UI/UX design, wireframing, prototyping, user flows, visual identity, responsive screens
2. **Websites/Webapps**: Custom HTML, CSS, JavaScript with React frontend + PHP/Laravel backend
3. **Mobile Apps**: Flutter cross-platform apps for Android & iOS

## Implicit Tech Stack Deduction
Clients rarely name tools explicitly — they say "I need a real estate website" or "mobile screens for a delivery app".
You MUST infer and predict the best stack from our core capabilities:
- Design/layout work → Figma (Predicted)
- Website/webapp → React (Predicted), Laravel (Predicted)
- Mobile app → Flutter (Predicted)
- Frontend work → HTML, CSS, JavaScript, React (Predicted)
- Backend/database/API work → PHP, Laravel (Predicted)

In the tech_stack JSON output, format inferred tools as "Tool Name (Predicted)".
Only omit "(Predicted)" if the client explicitly named that tool.

## Scoring Engine
**Score 5/5**: Explicitly or implicitly matches our Core Stack — Figma UI/UX design, custom HTML/CSS/JS/React frontend, Laravel PHP backend, Flutter mobile apps, or full-stack projects. Any request for a "website", "web app", "mobile app", or "UI/UX design".

**Score 4/5**: Close match using complementary tools (Tailwind/Bootstrap, SQL/MySQL, payment gateway integrations, APIs) but still firmly within our stack.

**Score 3/5**: Medium relevance — general web dev, API integration, or e-commerce that could use our stack but isn't a perfect fit.

**Score 1-2/5 (Auto-Reject)**: WordPress (themes/plugins/customization), Shopify, Wix, Webflow, Odoo, SAP, any ERP, no-code/low-code (Bubble, Adalo), content writing, translation, data entry, voice-over, video editing, social media, SEO-only, or digital marketing.

**Score 0 (is_relevant: false)**: Completely irrelevant (medicine, law, accounting), spam, or tasks with zero design/development/implementation.

## Proposal Generation Rules (Humanized Copywriting)
If the job is relevant (score >= 3), you MUST also generate a 'tailoredArabicProposal'.
Write it as an elite freelancer who has been winning projects on Mostaql/Khamsat for years.

**CRITICAL RULES TO KILL THE "AI LOOK"**:
1. NEVER start with generic phrases like: "تحية طيبة", "لقد قرأت مشروعك بعناية", "أنا مستعد تماماً", or "يسعدني التقدم".
2. NEVER list technical keywords blindly. Focus only on what the client explicitly asked for.
3. **TONE**: Speak like a top-tier Egyptian tech partner—professional, friendly, brief, and using practical tech-slang (e.g., blending clean Arabic with concise English tech terms like UI/UX, Component, Database, Live, Pipeline). Avoid ultra-formal, heavy MSA (لغة فصحى مقعرة).
4. **LENGTH**: Keep it short and punchy (Max 3 concise paragraphs).

**PROPOSAL STRUCTURAL BLUEPRINT**:
- **Paragraph 1 (The Hook)**: Start directly with a sharp technical observation, a smart question, or validation of their goal. For example, if they shared a link like 'sangdz.com', immediately mention it and state a UX or performance-first goal for saving lives.
- **Paragraph 2 (The Solution)**: Explain briefly HOW you will execute it to achieve maximum results (e.g., focusing on lightning-fast speed, conversion, or extreme cleanliness of the code without using heavy frameworks unnecessarily).
- **Paragraph 3 (The Soft CTA)**: End with a brief, friendly question that triggers a reply (e.g., "حابب ندردش في تفاصيل الـ API؟" or "لو جاهز نبدأ، قولي عشان نضبط أول خطوة سوا").

**Example Output Style**:
"يا هلا بيك.. فكرة المنصة الخيرية ممتازة ومحتاجة تركز على أسرع UX ممكن، لأن المتبرع بالدم محتاج يوصل للمعلومة في ثواني بدون أي تعقيد. أنا فحصت الـ Reference link اللي حاطه، ونقدر نطلع بنسخة أخف وأسرع بكتير وبأعلى أداء (Lighthouse score > 90%)... لو حابب تشوف ستايل الشغل قولي أبعتلك آخر Dashboards طلعتها لايف ونبدأ فيها."

## Output Rules
- score: integer 0-5 based on scoring engine above
- is_relevant: true only if score >= 3
- project_type: one of "UI/UX" | "Frontend" | "Full-Stack" | "Mobile" | "Irrelevant"
- tech_stack: ALL technologies — both explicitly named AND predicted. Predicted tools MUST include "(Predicted)". Minimum 1 item.
- client_pain_points: Array of inferred pain points (e.g., ["no existing design", "needs fast delivery", "budget limited"])
- budget_suitability: "Low" if < $50 or < 2 days, "High" if > $500 or > 2 weeks, otherwise "Medium"
- estimated_effort: "Low" if < $50 or < 2 days, "High" if > $500 or > 2 weeks, otherwise "Medium"
- summary_ar: one-sentence Arabic summary of the client's core request
- recommended_sales_angle: A short Arabic sentence suggesting how to pitch to this client
- tailoredArabicProposal: A short, human-sounding Arabic proposal (max 3 paragraphs, casual-professional tone) (string)
## Lead Scoring — Client Hiring Rate & Competition
If the metadata includes 'client_hiring_rate' (a percentage string like '4.35%'):
  - If the numeric value < 40%, append a warning to the 'lead_score_warning' field:
    "⚠️ تنبيه: معدل توظيف العميل متدني جداً ({value}%)"
If the metadata includes 'proposals_count' (integer):
  - If > 15 (Khamsat), note in 'lead_score_warning': "تنافس عالي جداً ({count} عرض)"
  - Consider reducing score by 1 if proposals > 20 (highly competitive)
  - Add 'client_notes' from the metadata if present — these are extra requirements from the post author's comments. Include any critical criteria found there.

- Respond with valid JSON only, no markdown formatting`;

const SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    score: { type: 'number' },
    is_relevant: { type: 'boolean' },
    project_type: { type: 'string', enum: ['UI/UX', 'Frontend', 'Full-Stack', 'Mobile', 'Irrelevant'] },
    tech_stack: { type: 'array', items: { type: 'string' } },
    client_pain_points: { type: 'array', items: { type: 'string' } },
    budget_suitability: { type: 'string', enum: ['Low', 'Medium', 'High'] },
    estimated_effort: { type: 'string', enum: ['Low', 'Medium', 'High'] },
    summary_ar: { type: 'string' },
    recommended_sales_angle: { type: 'string' },
    tailoredArabicProposal: { type: 'string' },
    lead_score_warning: { type: 'string' },
  },
  required: ['score', 'is_relevant', 'project_type', 'tech_stack', 'client_pain_points', 'budget_suitability', 'estimated_effort', 'summary_ar', 'recommended_sales_angle', 'tailoredArabicProposal'],
};

export interface JobAnalysis {
  score: number;
  is_relevant: boolean;
  project_type: 'UI/UX' | 'Frontend' | 'Full-Stack' | 'Mobile' | 'Irrelevant';
  tech_stack: string[];
  client_pain_points: string[];
  budget_suitability: 'Low' | 'Medium' | 'High';
  estimated_effort: 'Low' | 'Medium' | 'High';
  summary_ar: string;
  recommended_sales_angle: string;
  tailoredArabicProposal: string;
  lead_score_warning?: string;
}

export type AIEndpoint = 'qualify' | 'propose' | 'followup';

export interface RouterResult {
  response: string;
  modelUsed: string;
  tokensUsed: number;
}

export class AllModelsExhaustedError extends Error {
  constructor() {
    super('All AI models have exhausted their daily quota');
    this.name = 'AllModelsExhaustedError';
  }
}

export interface JobMetadata {
  platform?: string;
  proposals_count?: number;
  client_hiring_rate?: string;
  client_notes?: string;
  execution_time?: string;
}

class AIRouter {
  /**
   * Analyze a freelance job posting and return a structured scoring result.
   * @param title - Job title
   * @param description - Full job description
   * @param metadata - Optional metadata (platform, proposals count, hiring rate)
   */
  async analyzeJob(
    title: string,
    description: string,
    metadata?: JobMetadata
  ): Promise<JobAnalysis> {
    let metaBlock = '';
    if (metadata) {
      const parts: string[] = [];
      if (metadata.platform) parts.push(`Platform: ${metadata.platform}`);
      if (metadata.proposals_count !== undefined) parts.push(`Proposals/Competitors count: ${metadata.proposals_count}`);
      if (metadata.client_hiring_rate) parts.push(`Client hiring rate: ${metadata.client_hiring_rate}`);
      if (metadata.client_notes) parts.push(`Client notes/extra requirements: ${metadata.client_notes}`);
      if (metadata.execution_time) parts.push(`Execution time: ${metadata.execution_time}`);
      if (parts.length > 0) metaBlock = `\n\nAdditional Metadata:\n${parts.join('\n')}`;
    }

    const prompt = `Analyze this freelance job posting and return a structured JSON score.

Job Title: "${title.trim()}"
Description: "${description.trim()}"${metaBlock}

Apply the scoring criteria strictly. Return valid JSON only.`;

    const result = await litellm.callWithSchema('free-lead-scorer', prompt, SYSTEM_INSTRUCTION, SCHEMA);
    await logUsage(result.modelUsed, result.tokensUsed, 'qualify');

    const jsonText = extractJson(result.text);
    const parsed: JobAnalysis = JSON.parse(jsonText);
    validateAnalysis(parsed);
    return parsed;
  }
}

/**
 * Call the backup AI agent for general-purpose queries.
 * @param prompt - User prompt
 * @param endpoint - Target endpoint identifier
 */
export async function callAI(
  prompt: string,
  endpoint: Exclude<AIEndpoint, 'propose'>
): Promise<RouterResult> {
  const result = await litellm.call('free-backup-agent', prompt);
  await logUsage(result.modelUsed, result.tokensUsed, endpoint);
  return { response: result.text, modelUsed: result.modelUsed, tokensUsed: result.tokensUsed };
}

/**
 * Call the proposal-generation AI with a system prompt.
 * Returns null if all models are exhausted.
 */
export async function callProposalAI(
  prompt: string,
  systemPrompt?: string
): Promise<RouterResult | null> {
  try {
    const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
    const result = await litellm.call('free-proposal-generator', fullPrompt);
    await logUsage(result.modelUsed, result.tokensUsed, 'propose');
    return { response: result.text, modelUsed: result.modelUsed, tokensUsed: result.tokensUsed };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Router] Proposal generation failed: ${message}`);
    return null;
  }
}

/**
 * Check remaining daily quota for all configured AI models.
 * @returns Map of model name to availability (1 = available, 0 = exhausted)
 */
export async function getRemainingQuota(): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const [, alias] of Object.entries(ALIASES)) {
    for (const model of alias.models) {
      const available = await isModelAvailable(model);
      result[model] = available ? 1 : 0;
    }
  }
  return result;
}

function validateAnalysis(parsed: unknown): asserts parsed is JobAnalysis {
  const obj = parsed as Record<string, unknown>;
  // Defensive score resolution: handle string, alternative keys, and missing
  let rawScore: unknown = obj.score;
  if (rawScore === undefined) {
    rawScore = obj.lead_score ?? obj.rating ?? obj.analysis_score;
  }
  if (typeof rawScore === 'string') {
    rawScore = Number(rawScore);
  }
  if (typeof rawScore !== 'number' || isNaN(rawScore) || rawScore < 0 || rawScore > 5) {
    obj.score = 0;
  } else {
    obj.score = rawScore;
  }
  if (typeof obj.is_relevant !== 'boolean') {
    obj.is_relevant = false;
  }
  if (!['UI/UX', 'Frontend', 'Full-Stack', 'Mobile', 'Irrelevant'].includes(String(obj.project_type))) {
    obj.project_type = 'Irrelevant';
  }
  if (!Array.isArray(obj.tech_stack)) {
    obj.tech_stack = [];
  }
  if (!Array.isArray(obj.client_pain_points)) {
    obj.client_pain_points = [];
  }
  if (!['Low', 'Medium', 'High'].includes(String(obj.budget_suitability))) {
    obj.budget_suitability = 'Medium';
  }
  if (!['Low', 'Medium', 'High'].includes(String(obj.estimated_effort))) {
    obj.estimated_effort = 'Medium';
  }
  if (typeof obj.summary_ar !== 'string' || !obj.summary_ar) {
    obj.summary_ar = 'تحليل آلي';
  }
  if (typeof obj.recommended_sales_angle !== 'string' || !obj.recommended_sales_angle) {
    obj.recommended_sales_angle = '';
  }
  if (typeof obj.lead_score_warning !== 'string') {
    obj.lead_score_warning = undefined;
  }
}

function extractJson(text: string): string {
  const codeMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeMatch) return stripJsonComments(codeMatch[1].trim());

  const startIdx = text.indexOf('{');
  if (startIdx === -1) return stripJsonComments(text.trim());

  let endIdx = text.lastIndexOf('}');
  if (endIdx === -1 || endIdx < startIdx) return stripJsonComments(text.trim());

  while (endIdx > startIdx) {
    const candidate = stripJsonComments(text.substring(startIdx, endIdx + 1));
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      const nextEndIdx = text.lastIndexOf('}', endIdx - 1);
      if (nextEndIdx === -1 || nextEndIdx < startIdx) break;
      endIdx = nextEndIdx;
    }
  }

  return stripJsonComments(text.trim());
}

function stripJsonComments(json: string): string {
  return json
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

export const aiRouter = new AIRouter();
