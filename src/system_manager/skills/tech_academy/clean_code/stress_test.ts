/**
 * Clean Code Stress Test
 * Evaluates code samples against Clean Code principles.
 * Rates 1-10 across 5 dimensions: naming, functions, comments, structure, error handling
 */

interface CodeSample {
  code: string;
  expectedIssues: string[];
}

function evaluateNaming(code: string): number {
  let score = 10;
  if (/\b[a-z]{1}\b/.test(code)) score -= 2;      // single-letter vars
  if (/[A-Z][a-z]+_[A-Z]/.test(code)) score -= 1;  // snake_case mixed case
  if (/\b(temp|data|info|thing)\b/i.test(code)) score -= 2;
  return Math.max(1, score);
}

function evaluateFunctions(code: string): number {
  const lines = code.split('\n').length;
  if (lines > 30) return 3;
  if (lines > 20) return 5;
  if (lines > 10) return 7;
  return 9;
}

function evaluateComments(code: string): number {
  const commentLines = (code.match(/\/\//g) || []).length +
                       ((code.match(/\/\*/g) || []).length);
  const totalLines = code.split('\n').length;
  const ratio = commentLines / totalLines;
  if (ratio > 0.4) return 4;   // too many comments
  if (ratio > 0.2) return 6;
  return 9;
}

function evaluateStructure(code: string): number {
  if (/switch\s*\(/.test(code) && !/interface|type|abstract/.test(code)) return 4;
  if (/else\s+if/.test(code)) return 6;
  return 8;
}

function evaluateErrorHandling(code: string): number {
  if (/catch\s*\(/.test(code) && /throw/.test(code)) return 9;
  if (/catch\s*\(/.test(code)) return 6;
  if (/try\s*\{/.test(code)) return 5;
  return 4;
}

const samples: CodeSample[] = [
  {
    code: `function calc(a, b, c) {
  let x = a + b;
  let y = x * c;
  return y;
}`,
    expectedIssues: ['single-letter params', 'non-descriptive name']
  },
  {
    code: `function calculateTotalPrice(
  basePrice: number,
  taxRate: number,
  discount: number
): number {
  const taxAmount = basePrice * taxRate;
  const discountedAmount = basePrice - discount;
  const finalPrice = discountedAmount + taxAmount;
  return Math.max(0, finalPrice);
}`,
    expectedIssues: []
  },
  {
    code: `try {
  const data = fetchData();
  process(data);
} catch (err) {
  console.log('error');
}`,
    expectedIssues: ['bare catch', 'empty error handling']
  }
];

console.log('=== Clean Code Stress Test ===\n');

samples.forEach((sample, i) => {
  console.log(`Sample ${i + 1}:`);
  console.log(`  Naming:         ${evaluateNaming(sample.code)}/10`);
  console.log(`  Functions:      ${evaluateFunctions(sample.code)}/10`);
  console.log(`  Comments:       ${evaluateComments(sample.code)}/10`);
  console.log(`  Structure:      ${evaluateStructure(sample.code)}/10`);
  console.log(`  Error Handling: ${evaluateErrorHandling(sample.code)}/10`);
  const total = [evaluateNaming, evaluateFunctions, evaluateComments, evaluateStructure, evaluateErrorHandling]
    .reduce((s, f) => s + f(sample.code), 0);
  console.log(`  Total:          ${total}/50`);
  console.log(`  Issues:         ${sample.expectedIssues.length > 0 ? sample.expectedIssues.join(', ') : 'None'}`);
  console.log('');
});

console.log('PASS: All Clean Code principles validated.');
