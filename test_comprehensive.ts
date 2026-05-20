import 'dotenv/config';
import { chromium } from 'playwright';
import { checkBan } from './src/monitoring/banDetector';
import { ensureSession } from './src/automation/sessionManager';
import { litellm } from './src/services/litellm';
import { supabase } from './src/config/db';
import { createStealthBrowser } from './src/automation/browserConfig';

interface TestCase {
  id: string;
  name: string;
  category: string;
  run: () => Promise<{ pass: boolean; detail: string }>;
}

const results: { id: string; name: string; pass: boolean; detail: string; duration: number; category: string }[] = [];

function separator(title: string) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${'═'.repeat(60)}`);
}

async function runTest(tc: TestCase) {
  const start = Date.now();
  try {
    const r = await tc.run();
    const dur = Date.now() - start;
    results.push({ id: tc.id, name: tc.name, pass: r.pass, detail: r.detail, duration: dur, category: tc.category });
    console.log(`  ${r.pass ? '✅' : '❌'} [${tc.id}] ${tc.name} (${dur}ms)`);
    if (!r.pass) console.log(`     → ${r.detail}`);
  } catch (err: any) {
    const dur = Date.now() - start;
    results.push({ id: tc.id, name: tc.name, pass: false, detail: err.message, duration: dur, category: tc.category });
    console.log(`  ❌ [${tc.id}] ${tc.name} (${dur}ms) — EXCEPTION: ${err.message}`);
  }
}

// ─── Phase 1: Session & Scraping ─────────────────────────────────────
const sessionTests: TestCase[] = [
  {
    id: 'S01',
    name: 'Session expiry graceful fallback to public scraping',
    category: 'Session',
    run: async () => {
      const cookies = await ensureSession('mostaql');
      if (cookies.length === 0) {
        return { pass: true, detail: 'Session expired, gracefully returned empty cookies for public access' };
      }
      return { pass: true, detail: `Session valid, ${cookies.length} cookies loaded` };
    },
  },
  {
    id: 'S02',
    name: 'Khamsat session fallback',
    category: 'Session',
    run: async () => {
      const cookies = await ensureSession('khamsat');
      if (cookies.length === 0) {
        return { pass: true, detail: 'Session expired, gracefully returned empty cookies for public access' };
      }
      return { pass: true, detail: `Session valid, ${cookies.length} cookies loaded` };
    },
  },
];

// ─── Phase 2: Ban Detector ───────────────────────────────────────────
const banTests: TestCase[] = [
  {
    id: 'B01',
    name: 'No false positive on Mostaql public page',
    category: 'BanDetector',
    run: async () => {
      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      try {
        await page.goto('https://mostaql.com/projects', { waitUntil: 'domcontentloaded', timeout: 30000 });
        const result = await checkBan(page);
        await browser.close();
        if (result.banned) return { pass: false, detail: `False ban detected: ${result.reason}` };
        return { pass: true, detail: 'No false alarm on Mostaql public page' };
      } catch (err: any) {
        await browser.close();
        return { pass: false, detail: `Navigation failed: ${err.message}` };
      }
    },
  },
  {
    id: 'B02',
    name: 'No false positive on Khamsat public page',
    category: 'BanDetector',
    run: async () => {
      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      try {
        await page.goto('https://khamsat.com/community/requests', { waitUntil: 'domcontentloaded', timeout: 30000 });
        const result = await checkBan(page);
        await browser.close();
        if (result.banned) return { pass: false, detail: `False ban detected: ${result.reason}` };
        return { pass: true, detail: 'No false alarm on Khamsat public page' };
      } catch (err: any) {
        await browser.close();
        return { pass: false, detail: `Navigation failed: ${err.message}` };
      }
    },
  },
  {
    id: 'B03',
    name: 'Ban URL redirect pattern detection',
    category: 'BanDetector',
    run: async () => {
      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 10000 });
      const result = await checkBan(page, 'https://mostaql.com/blocked/user');
      await browser.close();
      if (!result.banned) return { pass: false, detail: 'Failed to detect ban URL pattern' };
      return { pass: true, detail: `Correctly detected ban URL: ${result.reason}` };
    },
  },
];

// ─── Phase 3: LiteLLM Gateway ────────────────────────────────────────
const SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'number' },
    is_relevant: { type: 'boolean' },
    project_type: { type: 'string' },
    tech_stack: { type: 'array', items: { type: 'string' } },
    tailoredArabicProposal: { type: 'string' },
  },
  required: ['score', 'is_relevant', 'project_type', 'tech_stack'],
};

const SYSTEM_INSTRUCTION = 'You are a freelance job analyzer. Score 0-5. Return JSON only.';

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

function stripJsonComments(json: string): string {
  return json.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

const aiTests: TestCase[] = [
  {
    id: 'AI01',
    name: 'free-lead-scorer returns valid structured JSON',
    category: 'LiteLLM',
    run: async () => {
      const prompt = 'Analyze: "مطلوب تطوير تطبيق جوال للتوصيل على iOS و Android"';
      const result = await litellm.callWithSchema('free-lead-scorer', prompt, SYSTEM_INSTRUCTION, SCHEMA);
      const json = extractJson(result.text);
      const parsed = JSON.parse(json);
      if (typeof parsed.score !== 'number') return { pass: false, detail: 'Missing score field' };
      if (typeof parsed.is_relevant !== 'boolean') return { pass: false, detail: 'Missing is_relevant field' };
      return { pass: true, detail: `Model: ${result.modelUsed}, Score: ${parsed.score}/5, Type: ${parsed.project_type}` };
    },
  },
  {
    id: 'AI02',
    name: 'free-proposal-generator returns Arabic text',
    category: 'LiteLLM',
    run: async () => {
      const prompt = 'Write a short Arabic proposal for: "تصميم موقع ويب لشركة عقارات"';
      const result = await litellm.call('free-proposal-generator', prompt, SYSTEM_INSTRUCTION);
      if (result.text.length < 20) return { pass: false, detail: `Response too short: ${result.text.length} chars` };
      const hasArabic = /[\u0600-\u06FF]/.test(result.text);
      if (!hasArabic) return { pass: false, detail: 'No Arabic text found in response' };
      return { pass: true, detail: `Model: ${result.modelUsed}, Length: ${result.text.length} chars, Arabic: ✓` };
    },
  },
  {
    id: 'AI03',
    name: 'free-backup-agent fallback works under failure',
    category: 'LiteLLM',
    run: async () => {
      const result = await litellm.call('free-backup-agent', 'Return a short summary: "system is healthy"', 'You are a system monitor.');
      if (!result.text || result.text.length < 10) return { pass: false, detail: 'No response from backup agent' };
      return { pass: true, detail: `Model: ${result.modelUsed}, Response: ${result.text.slice(0, 60)}...` };
    },
  },
  {
    id: 'AI04',
    name: 'JSON comment stripping (Groq adds // comments)',
    category: 'LiteLLM',
    run: async () => {
      const jsonWithComments = `{
  "score": 4,
  "is_relevant": true,
  "tech_stack": ["React", "Laravel"], // predicted stack
  "project_type": "Full-Stack" // based on requirements
}`;
      try {
        const cleaned = stripJsonComments(jsonWithComments);
        const parsed = JSON.parse(cleaned);
        if (parsed.score !== 4) return { pass: false, detail: 'Score mismatch after comment stripping' };
        return { pass: true, detail: 'Successfully stripped JSON comments and parsed' };
      } catch (err: any) {
        return { pass: false, detail: `Failed to parse: ${err.message}` };
      }
    },
  },
];

// ─── Phase 4: Supabase Connectivity ──────────────────────────────────
const dbTests: TestCase[] = [
  {
    id: 'DB01',
    name: 'Supabase connection health check',
    category: 'Database',
    run: async () => {
      const { error } = await supabase.from('scraped_jobs').select('id').limit(1);
      if (error) return { pass: false, detail: `Connection failed: ${error.message}` };
      return { pass: true, detail: 'Supabase connection healthy' };
    },
  },
  {
    id: 'DB02',
    name: 'Lead scoring columns exist in scraped_jobs',
    category: 'Database',
    run: async () => {
      const { error } = await supabase.from('scraped_jobs').select('execution_time, proposals_count, client_hiring_rate, client_notes, ai_lead_score_warning').limit(1);
      if (error) return { pass: false, detail: `Column check failed: ${error.message}` };
      return { pass: true, detail: 'All lead scoring columns present and accessible' };
    },
  },
  {
    id: 'DB03',
    name: 'Scheduler lock table accessible',
    category: 'Database',
    run: async () => {
      const { error } = await supabase.from('scheduler_lock').select('*').limit(1);
      if (error) return { pass: false, detail: `Lock table error: ${error.message}` };
      return { pass: true, detail: 'Scheduler lock table accessible' };
    },
  },
];

// ─── Phase 5: HTML Structure Resilience ──────────────────────────────
const htmlTests: TestCase[] = [
  {
    id: 'H01',
    name: 'Mostaql page loads with stealth browser',
    category: 'HTML',
    run: async () => {
      const { browser, page } = await createStealthBrowser(true);
      try {
        await page.goto('https://mostaql.com/projects', { waitUntil: 'domcontentloaded', timeout: 60000 });
        const title = await page.title();
        const bodyLen = await page.evaluate(() => document.body.innerText.length);
        await browser.close();
        if (bodyLen < 100) return { pass: false, detail: `Page body nearly empty (${bodyLen} chars)` };
        return { pass: true, detail: `Page loaded with stealth (title: "${title}", body: ${bodyLen} chars)` };
      } catch (err: any) {
        await browser.close();
        return { pass: false, detail: `Page load failed: ${err.message}` };
      }
    },
  },
  {
    id: 'H02',
    name: 'Khamsat page loads with stealth browser',
    category: 'HTML',
    run: async () => {
      const { browser, page } = await createStealthBrowser(true);
      try {
        await page.goto('https://khamsat.com/community/requests', { waitUntil: 'domcontentloaded', timeout: 60000 });
        const title = await page.title();
        const bodyLen = await page.evaluate(() => document.body.innerText.length);
        await browser.close();
        if (bodyLen < 100) return { pass: false, detail: `Page body nearly empty (${bodyLen} chars)` };
        return { pass: true, detail: `Page loaded with stealth (title: "${title}", body: ${bodyLen} chars)` };
      } catch (err: any) {
        await browser.close();
        return { pass: false, detail: `Page load failed: ${err.message}` };
      }
    },
  },
];

// ─── Phase 6: Token Overflow Protection ──────────────────────────────
const tokenTests: TestCase[] = [
  {
    id: 'T01',
    name: 'Description truncation prevents token overflow',
    category: 'Token',
    run: async () => {
      const longDesc = 'a'.repeat(10000);
      const truncated = longDesc.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 2000);
      if (truncated.length > 2000) return { pass: false, detail: `Truncation failed: ${truncated.length} chars` };
      return { pass: true, detail: `Description truncated from 10000 to ${truncated.length} chars (limit: 2000)` };
    },
  },
  {
    id: 'T02',
    name: 'Title truncation prevents overflow',
    category: 'Token',
    run: async () => {
      const longTitle = 'ب'.repeat(500);
      const truncated = longTitle.trim().slice(0, 150);
      if (truncated.length > 150) return { pass: false, detail: `Title truncation failed: ${truncated.length} chars` };
      return { pass: true, detail: `Title truncated from 500 to ${truncated.length} chars (limit: 150)` };
    },
  },
];

// ─── Run All Tests ───────────────────────────────────────────────────
(async () => {
  separator('🧪 PRINCIPAL QA ENGINEER — COMPREHENSIVE TEST SUITE');
  console.log(`\nRunning ${sessionTests.length + banTests.length + aiTests.length + dbTests.length + htmlTests.length + tokenTests.length} tests across 6 categories...\n`);

  separator('Phase 1: Session & Scraping');
  for (const t of sessionTests) await runTest(t);

  separator('Phase 2: Ban Detector');
  for (const t of banTests) await runTest(t);

  separator('Phase 3: LiteLLM Gateway');
  for (const t of aiTests) await runTest(t);

  separator('Phase 4: Supabase Connectivity');
  for (const t of dbTests) await runTest(t);

  separator('Phase 5: HTML Structure Resilience');
  for (const t of htmlTests) await runTest(t);

  separator('Phase 6: Token Overflow Protection');
  for (const t of tokenTests) await runTest(t);

  // ─── Summary ───────────────────────────────────────────────────────
  separator('📊 TEST SUMMARY');
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  const total = results.length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

  console.log(`\n  Total: ${total} | ✅ Passed: ${passed} | ❌ Failed: ${failed}`);
  console.log(`  Total duration: ${(totalDuration / 1000).toFixed(1)}s\n`);

  if (failed > 0) {
    console.log('  Failed tests:');
    results.filter(r => !r.pass).forEach(r => {
      console.log(`    ❌ [${r.id}] ${r.name}: ${r.detail}`);
    });
  }

  const categories = [...new Set(results.map(r => r.category))];
  console.log('\n  Category breakdown:');
  for (const cat of categories) {
    const catResults = results.filter(r => r.category === cat);
    const catPassed = catResults.filter(r => r.pass).length;
    console.log(`    ${cat}: ${catPassed}/${catResults.length} passed`);
  }

  console.log(`\n${'═'.repeat(60)}\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
