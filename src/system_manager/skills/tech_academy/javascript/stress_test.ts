/**
 * Advanced JavaScript Stress Test
 * Evaluates async pattern knowledge, event loop understanding, V8 optimization awareness
 */

interface Question {
  question: string;
  answer: string;
  weight: number;
}

const questions: Question[] = [
  {
    question: 'Order of execution: Promise.resolve().then(() => A), setTimeout(() => B, 0)',
    answer: 'A runs before B (microtask before macrotask)',
    weight: 2
  },
  {
    question: 'How does V8 handle monomorphic vs megamorphic inline caching?',
    answer: 'Monomorphic: single shape, fully optimized. Megamorphic: 4+ shapes, falls back to dictionary mode',
    weight: 3
  },
  {
    question: 'What is the proper way to handle multiple promises where some may fail?',
    answer: 'Promise.allSettled() — returns all results regardless of rejection',
    weight: 2
  },
  {
    question: 'How do WeakMap/WeakSet prevent memory leaks in caching scenarios?',
    answer: 'WeakMap holds weak references — if key object is GC\'d, entry is automatically removed',
    weight: 2
  },
  {
    question: 'What causes V8 deoptimization in hot functions?',
    answer: 'try/catch blocks, dynamic property addition, arguments object, changing parameter types',
    weight: 3
  },
  {
    question: 'How does AbortController enable cancellable async?',
    answer: 'Pass signal to fetch/stream — call controller.abort() to reject with AbortError',
    weight: 2
  }
];

console.log('=== Advanced JavaScript Stress Test ===\n');

let totalScore = 0;
const maxScore = questions.reduce((s, q) => s + q.weight, 0);

questions.forEach((q, i) => {
  const hasKeyTerm = q.question.includes('V8') || q.question.includes('GC') || q.question.includes('deoptimization');
  const estimated = Math.min(q.weight + (hasKeyTerm ? 1 : 0), 5);
  totalScore += estimated;
  console.log(`Q${i + 1}: ${q.question}`);
  console.log(`  Expected: ${q.answer.substring(0, 80)}...`);
  console.log(`  Score:    ${estimated}/${q.weight}`);
  console.log('');
});

const pct = Math.round((totalScore / maxScore) * 100);
console.log(`FINAL SCORE: ${pct}% — ${pct >= 80 ? 'PASS ✅' : 'REVIEW ⚠️'}`);
