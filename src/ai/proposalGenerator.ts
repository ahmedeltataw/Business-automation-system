/**
 * Proposal Generator
 *
 * Generates tailored Arabic-language freelance proposals using the AI router.
 * Applies project-type-specific profiles and a structured system prompt
 * to produce human-sounding, value-focused proposals.
 */

/**
 * Arabic Proposal Generator
 *
 * Generates tailored, human-sounding Arabic proposals for high-score freelance
 * jobs. Uses the AI router with a specialized system prompt that enforces
 * professional business Arabic, avoids AI-typical patterns, and focuses on
 * the client's pain points and the team's core technical stack.
 */

import { callProposalAI } from './router';
import { agentConfig } from '../config/agentConfig';

interface JobInput {
  title: string;
  description?: string;
  platform: string;
  client_name?: string;
  budget?: string;
}

interface AnalysisInput {
  score: number;
  project_type: string;
  tech_stack: string[];
  client_pain_points: string[];
  budget_suitability: string;
  estimated_effort: string;
  recommended_sales_angle: string;
  summary_ar?: string;
}

interface ProjectTypeProfile {
  name: string;
  tools: string;
}

const PROJECT_TYPE_PROFILES: Record<string, ProjectTypeProfile> = agentConfig.proposal.typeProfiles;

const SYSTEM_INSTRUCTION = `أنت كاتب عروض احترافي (Sales Copywriter) خبير في السوق العربي. مهمتك هي كتابة عرض سعر (Proposal) مخصص، مقنع، وذكي جداً لمشاريع العمل الحر.

### القواعد الذهبية:
1. **الابتعاد عن النمطية**: لا تبدأ بـ "أهلاً بك" أو "يسعدني التقدم لهذا المشروع" بشكل آلي. ابدأ مباشرة بمعالجة المشكلة.
2. **الهيكل الذكي**:
   - **الخُطّاف (The Hook)**: ابدأ بجملة قوية تُظهر فهمك العميق لنقطة الألم (Pain Point) التي ذكرها العميل.
   - **الحل التقني المخصص**: اشرح كيف ستحل مشكلته باستخدام تقنياتنا المتطورة (Stack).
   - **دعوة لاتخاذ إجراء (CTA)**: اختم بدعوة ذكية لمناقشة التفاصيل أو رؤية نموذج أولي (Prototype/Wireframe).
3. **الأسلوب**: احترافي (Business Professional)، واثق، مباشر، ومقنع جداً. استخدم لهجة بيزنس عربية فصحى ولكن عصرية وغير متكلفة.
4. **التركيز على القيمة**: لا تتحدث عن "ماذا سنفعل" فقط، بل تحدث عن "كيف سيستفيد العميل" (سرعة، أداء، تجربة مستخدم).

### القوة التقنية للفريق (Strict Stack):
- **UI/UX & Prototyping**: استخدام Figma لعمل (Wireframing, User Flows, Interactive Prototyping).
- **Websites & Webapps**: استخدام React/Vite للواجهات، و Laravel/PHP للخلفية، مع اعتماد معايير CUBE CSS/BEM لضمان كود نظيف وسرعة Lighthouse تتخطى 90%.

### مخرجاتك:
- أخرج نص العرض فقط.
- لا تضف أي مقدمات أو خاتمة من قبلك (مثل "إليك العرض:").
- الطول: ${agentConfig.proposal.wordCount.min}-${agentConfig.proposal.wordCount.max} كلمة.`;

/**
 * Generate a tailored Arabic proposal for a high-score job.
 * @param job - Job metadata (title, description, platform, budget)
 * @param analysis - AI analysis result (score, project type, pain points)
 * @returns Generated proposal text or null if all models exhausted
 */
export async function generateProposal(
  job: JobInput,
  analysis: AnalysisInput
): Promise<string | null> {
  const profile = PROJECT_TYPE_PROFILES[analysis.project_type] ?? PROJECT_TYPE_PROFILES['Full-Stack'];

  const painPoints = analysis.client_pain_points?.length
    ? analysis.client_pain_points.map((p) => `• ${p}`).join('\n')
    : '• لم يحدد العميل نقاط ألم محددة';

  const techStack = analysis.tech_stack?.length
    ? analysis.tech_stack.join('، ')
    : profile.tools;

  const prompt = `
### بيانات المشروع:
- **العنوان**: ${job.title}
- **الوصف**: ${job.description ?? 'غير متوفر'}
- **المنصة**: ${job.platform}
- **الميزانية**: ${job.budget ?? 'غير محددة'}
- **العميل**: ${job.client_name ?? 'عزيزي العميل'}

### تحليل الذكاء الاصطناعي:
- **النوع**: ${analysis.project_type}
- **التقنيات المقترحة**: ${techStack}
- **نقاط الألم (Pain Points)**:
${painPoints}
- **الزاوية التسويقية المقترحة**: ${analysis.recommended_sales_angle ?? 'عرض حل تقني متكامل'}
- **الجهد والمدة المتوقعة**: ${analysis.estimated_effort}
- **ملخص التحليل**: ${analysis.summary_ar ?? ''}

### التعليمات الإضافية:
- استخدم "الزاوية التسويقية" كإطار عام لكتابة العرض.
- تأكد من إبراز استخدام تقنيات الـ Stack المذكورة في ملف التعريف (${profile.name}) إذا كانت مناسبة.
- اجعل الـ CTA يركز على "مناقشة المخططات الأولية (Wireframes) أو النموذج الأولي (Prototype) في الشات".

اكتب العرض الآن:
`;

  const result = await callProposalAI(prompt, SYSTEM_INSTRUCTION);

  if (!result) {
    console.log('[ProposalGen] All models exhausted, proposal deferred.');
    return null;
  }

  return result.response.trim();
}
