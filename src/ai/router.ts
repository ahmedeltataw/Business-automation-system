import { gemini } from './gemini';
import { groq } from './groq';
import { huggingface } from './huggingface';
import { isModelAvailable, logUsage } from './usageTracker';
import { notifyTelegram } from '../telegram/notifier';
import { agentConfig } from '../config/agentConfig';

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

## Proposal Generation Rules (Arabic)
If the job is relevant (score >= 3), you MUST also generate a 'tailoredArabicProposal'. 
This proposal must be an elite, human-sounding Arabic sales pitch.

**CRITICAL RULES for the Proposal**:
1. **Zero AI Cliché Boilerplates**: Absolutely ban phrases like "تحويل رؤيتك إلى حقيقة", "نحن نهتم", "مما يؤثر على", or any introductory essay style.
2. **Language Purity**: No mixed foreign scripts (e.g. Russian/English mixed inappropriately) or broken verbs. Use professional Arabic terminology (e.g. نموذج تفاعلي, هيكلية برمجية).
3. **The Human Pitch Structure**:
   - **The Hook**: Start directly with the technical fix for the client's specific pain point. (e.g., "المشاكل الي بتواجه براندات الفاشون في البيع غالباً بتبدأ من تجربة مستخدم معقدة وبطء تحميل الموقع...")
   - **The Solution**: Pitch our high-performance stack naturally. (e.g., "هنشتغل على Figma لبناء تجربة تصفح سلسة، مع كود React و Laravel متقفل بمعايير سرعة Lighthouse فوق الـ 90% لضمان أسرع استجابة وتجربة شراء.")
   - **The CTA**: Close with a direct invite to discuss wireframes/prototypes in chat. (e.g., "ممكن نناقش الـ Wireframe المقترح في الشات؟")

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
- tailoredArabicProposal: A professional, high-conversion Arabic sales proposal (string)
- Respond with valid JSON only, no markdown formatting`;

const SCHEMA = {
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
  },
  required: ['score', 'is_relevant', 'project_type', 'tech_stack', 'client_pain_points', 'budget_suitability', 'estimated_effort', 'summary_ar', 'recommended_sales_angle', 'tailoredArabicProposal'],
};

interface JobAnalysis {
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

class AIRouter {
  async analyzeJob(title: string, description: string): Promise<JobAnalysis> {
    const prompt = `Analyze this freelance job posting and return a structured JSON score.

Job Title: "${title.trim()}"
Description: "${description.trim()}"

Apply the scoring criteria strictly. Return valid JSON only.`;

    // Use the configured qualify chain for all providers
    for (const modelName of QUALIFY_CHAIN) {
      const available = await isModelAvailable(modelName);
      if (!available) {
        console.log(`[Router] ${modelName} quota exhausted, trying next...`);
        continue;
      }

      try {
        let result: any;
        if (modelName.startsWith('gemini') || modelName.startsWith('gemma')) {
          const r = await gemini.callWithSchema(modelName, prompt, SYSTEM_INSTRUCTION, SCHEMA);
          result = { text: r.text, tokensUsed: r.tokensUsed, modelUsed: r.modelUsed };
        } else if (modelName.startsWith('hf/')) {
          const cleanModelName = modelName.replace('hf/', '');
          const r = await huggingface.call(cleanModelName, prompt, SYSTEM_INSTRUCTION);
          result = { text: r.text, tokensUsed: r.tokensUsed, modelUsed: r.modelUsed };
        } else {
          const r = await groq.call(prompt, SYSTEM_INSTRUCTION);
          result = { text: r.text, tokensUsed: r.tokensUsed, modelUsed: r.modelUsed };
        }

        await logUsage(modelName, result.tokensUsed, 'qualify');
        const jsonText = extractJson(result.text);
        const parsed: JobAnalysis = JSON.parse(jsonText);
        validateAnalysis(parsed);
        return parsed;
      } catch (err: any) {
        if (modelName.startsWith('hf/') && err.message.includes('[HF Provider Error]')) {
          console.error(err.message);
        } else {
          console.error(`[Router] ${modelName} failed: ${err.message}`);
        }
        continue;
      }
    }

    await notifyTelegram('🚨 *All AI models exhausted for job analysis!*');
    throw new AllModelsExhaustedError();
  }
}

const QUALIFY_CHAIN = agentConfig.ai.qualifyChain;
const PROPOSAL_CHAIN = agentConfig.ai.proposalChain;

export async function callAI(
  prompt: string,
  endpoint: Exclude<AIEndpoint, 'propose'>
): Promise<RouterResult> {
  for (const modelName of QUALIFY_CHAIN) {
    const available = await isModelAvailable(modelName);
    if (!available) {
      console.log(`[Router] ${modelName} quota exhausted, trying next...`);
      continue;
    }

    try {
      let result: RouterResult;

      if (modelName.startsWith('gemini') || modelName.startsWith('gemma')) {
        const r = await gemini.call(modelName, prompt);
        result = { response: r.text, modelUsed: r.modelUsed, tokensUsed: r.tokensUsed };
      } else if (modelName.startsWith('hf/')) {
        const cleanModelName = modelName.replace('hf/', '');
        const r = await huggingface.call(cleanModelName, prompt);
        result = { response: r.text, modelUsed: r.modelUsed, tokensUsed: r.tokensUsed };
      } else {
        const r = await groq.call(prompt);
        result = { response: r.text, modelUsed: r.modelUsed, tokensUsed: r.tokensUsed };
      }

      await logUsage(modelName, result.tokensUsed, endpoint);
      return result;
    } catch (err: any) {
      if (modelName.startsWith('hf/') && err.message.includes('[HF Provider Error]')) {
        console.error(err.message);
      } else {
        console.error(`[Router] ${modelName} failed:`, err.message);
      }
      continue;
    }
  }

  await notifyTelegram('🚨 *All AI models exhausted!* Unable to qualify jobs today.');
  throw new AllModelsExhaustedError();
}

export async function callProposalAI(prompt: string, systemPrompt?: string): Promise<RouterResult | null> {
  for (const modelName of PROPOSAL_CHAIN) {
    const available = await isModelAvailable(modelName);
    if (!available) {
      console.log(`[Router] ${modelName} quota exhausted, trying next...`);
      continue;
    }

    try {
      let result: RouterResult;

      if (modelName.startsWith('gemini') || modelName.startsWith('gemma')) {
        const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
        const r = await gemini.call(modelName, fullPrompt);
        result = { response: r.text, modelUsed: r.modelUsed, tokensUsed: r.tokensUsed };
      } else if (modelName.startsWith('hf/')) {
        const cleanModelName = modelName.replace('hf/', '');
        const r = await huggingface.call(cleanModelName, prompt, systemPrompt);
        result = { response: r.text, modelUsed: r.modelUsed, tokensUsed: r.tokensUsed };
      } else {
        const r = await groq.call(prompt, systemPrompt);
        result = { response: r.text, modelUsed: r.modelUsed, tokensUsed: r.tokensUsed };
      }

      await logUsage(modelName, result.tokensUsed, 'propose');
      return result;
    } catch (err: any) {
      if (modelName.startsWith('hf/') && err.message.includes('[HF Provider Error]')) {
        console.error(err.message);
      } else {
        console.error(`[Router] ${modelName} failed:`, err.message);
      }
      continue;
    }
  }

  await notifyTelegram('⚠️ *Proposal AI quota exhausted today* — proposals will be deferred.');
  return null;
}

export async function getRemainingQuota(): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const model of [...QUALIFY_CHAIN, ...PROPOSAL_CHAIN]) {
    const available = await isModelAvailable(model);
    result[model] = available ? 1 : 0;
  }
  return result;
}

function validateAnalysis(parsed: any): asserts parsed is JobAnalysis {
  if (typeof parsed.score !== 'number' || parsed.score < 0 || parsed.score > 5) {
    parsed.score = 0;
  }
  if (typeof parsed.is_relevant !== 'boolean') {
    parsed.is_relevant = false;
  }
  if (!['UI/UX', 'Frontend', 'Full-Stack', 'Mobile', 'Irrelevant'].includes(parsed.project_type)) {
    parsed.project_type = 'Irrelevant';
  }
  if (!Array.isArray(parsed.tech_stack)) {
    parsed.tech_stack = [];
  }
  if (!Array.isArray(parsed.client_pain_points)) {
    parsed.client_pain_points = [];
  }
  if (!['Low', 'Medium', 'High'].includes(parsed.budget_suitability)) {
    parsed.budget_suitability = 'Medium';
  }
  if (!['Low', 'Medium', 'High'].includes(parsed.estimated_effort)) {
    parsed.estimated_effort = 'Medium';
  }
  if (typeof parsed.summary_ar !== 'string' || !parsed.summary_ar) {
    parsed.summary_ar = 'تحليل آلي';
  }
  if (typeof parsed.recommended_sales_angle !== 'string' || !parsed.recommended_sales_angle) {
    parsed.recommended_sales_angle = '';
  }
}

function extractJson(text: string): string {
  const codeMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeMatch) return codeMatch[1].trim();

  const startIdx = text.indexOf('{');
  if (startIdx === -1) return text.trim();

  let endIdx = text.lastIndexOf('}');
  if (endIdx === -1 || endIdx < startIdx) return text.trim();

  while (endIdx > startIdx) {
    const candidate = text.substring(startIdx, endIdx + 1);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch (e) {
      const nextEndIdx = text.lastIndexOf('}', endIdx - 1);
      if (nextEndIdx === -1 || nextEndIdx < startIdx) break;
      endIdx = nextEndIdx;
    }
  }

  return text.trim();
}

export const aiRouter = new AIRouter();
export type { JobAnalysis };
