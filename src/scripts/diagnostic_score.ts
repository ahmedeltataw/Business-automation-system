/**
 * Score Diagnostic — tests extractJson + validateAnalysis logic
 * with various LLM response formats to catch field mapping issues.
 */

// --- Replicate extractJson from router.ts ---
function stripJsonComments(json: string): string {
  return json.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
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
    try { JSON.parse(candidate); return candidate; } catch {
      const nextEndIdx = text.lastIndexOf('}', endIdx - 1);
      if (nextEndIdx === -1 || nextEndIdx < startIdx) break;
      endIdx = nextEndIdx;
    }
  }
  return stripJsonComments(text.trim());
}

// --- Replicate validateAnalysis from router.ts ---
interface JobAnalysis {
  score: number;
  is_relevant: boolean;
  project_type: string;
  tech_stack: string[];
  client_pain_points: string[];
  budget_suitability: string;
  estimated_effort: string;
  summary_ar: string;
  recommended_sales_angle: string;
  tailoredArabicProposal: string;
  lead_score_warning?: string;
}

function validateAnalysis(parsed: unknown): asserts parsed is JobAnalysis {
  const obj = parsed as Record<string, unknown>;
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
  if (typeof obj.is_relevant !== 'boolean') { obj.is_relevant = false; }
  if (!['UI/UX', 'Frontend', 'Full-Stack', 'Mobile', 'Irrelevant'].includes(String(obj.project_type))) { obj.project_type = 'Irrelevant'; }
  if (!Array.isArray(obj.tech_stack)) { obj.tech_stack = []; }
  if (!Array.isArray(obj.client_pain_points)) { obj.client_pain_points = []; }
  if (!['Low', 'Medium', 'High'].includes(String(obj.budget_suitability))) { obj.budget_suitability = 'Medium'; }
  if (!['Low', 'Medium', 'High'].includes(String(obj.estimated_effort))) { obj.estimated_effort = 'Medium'; }
  if (typeof obj.summary_ar !== 'string' || !obj.summary_ar) { obj.summary_ar = 'تحليل آلي'; }
  if (typeof obj.recommended_sales_angle !== 'string' || !obj.recommended_sales_angle) { obj.recommended_sales_angle = ''; }
  if (typeof obj.lead_score_warning !== 'string') { obj.lead_score_warning = undefined; }
}

function parseAndScore(text: string, label: string): void {
  console.log(`\n=== ${label} ===`);
  console.log(`Raw input: ${JSON.stringify(text).slice(0, 150)}...`);
  const jsonText = extractJson(text);
  console.log(`Extracted JSON: ${jsonText}`);
  try {
    const parsed = JSON.parse(jsonText);
    validateAnalysis(parsed);
    console.log(`✅ score = ${parsed.score}, is_relevant = ${parsed.is_relevant}`);
  } catch (e: any) {
    console.log(`❌ Parse error: ${e.message}`);
  }
}

// --- Test cases ---
console.log('\n========================================');
console.log('  SCORE DIAGNOSTIC — Field Mapping Test');
console.log('========================================\n');

// Format 1: Standard — score as number (ideal)
parseAndScore(
  JSON.stringify({ score: 4, is_relevant: true, project_type: 'Full-Stack', tech_stack: ['React'], client_pain_points: [], budget_suitability: 'Medium', estimated_effort: 'Medium', summary_ar: 'مشروع ممتاز', recommended_sales_angle: '', tailoredArabicProposal: 'مرحبا' }),
  '1. score as number (correct format)'
);

// Format 2: score as string (potential type mismatch)
parseAndScore(
  JSON.stringify({ score: '4', is_relevant: true, project_type: 'Full-Stack', tech_stack: ['React'], client_pain_points: [], budget_suitability: 'Medium', estimated_effort: 'Medium', summary_ar: 'مشروع ممتاز', recommended_sales_angle: '', tailoredArabicProposal: 'مرحبا' }),
  '2. score as STRING "4" → coerced to 0!'
);

// Format 3: Wrong key — "lead_score" instead of "score"
parseAndScore(
  JSON.stringify({ lead_score: 4, is_relevant: true, project_type: 'Full-Stack', tech_stack: ['React'], client_pain_points: [], budget_suitability: 'Medium', estimated_effort: 'Medium', summary_ar: 'مشروع ممتاز', recommended_sales_angle: '', tailoredArabicProposal: 'مرحبا' }),
  '3. lead_score instead of score → score=undefined → 0!'
);

// Format 4: Wrong key — "rating" instead of "score"
parseAndScore(
  JSON.stringify({ rating: 4.5, is_relevant: true, project_type: 'Full-Stack', tech_stack: ['React'], client_pain_points: [], budget_suitability: 'Medium', estimated_effort: 'Medium', summary_ar: 'مشروع ممتاز', recommended_sales_angle: '', tailoredArabicProposal: 'مرحبا' }),
  '4. rating instead of score → 0!'
);

// Format 5: Markdown-wrapped JSON (common LLM output)
parseAndScore(
  'Here is your analysis:\n\n```json\n{\n  "score": 4,\n  "is_relevant": true,\n  "project_type": "Full-Stack",\n  "tech_stack": ["React"],\n  "client_pain_points": [],\n  "budget_suitability": "Medium",\n  "estimated_effort": "Medium",\n  "summary_ar": "مشروع ممتاز",\n  "recommended_sales_angle": "",\n  "tailoredArabicProposal": "مرحبا"\n}\n```',
  '5. score in markdown code block (extractJson handles it)'
);

// Format 6: LLM returns score=0 for irrelevant job (correct behavior)
parseAndScore(
  JSON.stringify({ score: 0, is_relevant: false, project_type: 'Irrelevant', tech_stack: [], client_pain_points: [], budget_suitability: 'Medium', estimated_effort: 'Medium', summary_ar: 'غير ذي صلة', recommended_sales_angle: '', tailoredArabicProposal: '' }),
  '6. score=0 for irrelevant (correct)'
);

// Format 7: LLM returns score as float (valid)
parseAndScore(
  JSON.stringify({ score: 3.5, is_relevant: true, project_type: 'UI/UX', tech_stack: ['Figma'], client_pain_points: [], budget_suitability: 'Medium', estimated_effort: 'Medium', summary_ar: 'مشروع', recommended_sales_angle: '', tailoredArabicProposal: 'مرحبا' }),
  '7. score as float 3.5 (valid)'
);

// Format 8: Missing field — score not present at all
parseAndScore(
  JSON.stringify({ analysis_score: 4, is_relevant: true, project_type: 'Full-Stack', tech_stack: ['React'], client_pain_points: [], budget_suitability: 'Medium', estimated_effort: 'Medium', summary_ar: 'مشروع', recommended_sales_angle: '', tailoredArabicProposal: 'مرحبا' }),
  '8. analysis_score instead of score → 0!'
);

console.log('\n========================================');
console.log('  DIAGNOSIS COMPLETE');
console.log('========================================\n');
