import { env } from '../config/env';

console.log('');
console.log('=== Environment Validation ===');
console.log('');

const checks = [
  { key: 'SUPABASE_URL', value: env.SUPABASE_URL, expected: 'https://' },
  { key: 'SUPABASE_SERVICE_ROLE_KEY', value: env.SUPABASE_SERVICE_ROLE_KEY, expected: 'sb_secret_' },
  { key: 'REDIS_URL', value: env.REDIS_URL, expected: 'rediss://' },
  { key: 'GEMINI_API_KEY', value: env.GEMINI_API_KEY, expected: 'AIzaSy' },
  { key: 'TELEGRAM_BOT_TOKEN', value: env.TELEGRAM_BOT_TOKEN, expected: ':' },
  { key: 'TELEGRAM_CHAT_ID', value: env.TELEGRAM_CHAT_ID, expected: '' },
];

let allPassed = true;

for (const check of checks) {
  const pass = check.expected ? check.value.includes(check.expected) : !!check.value;
  const status = pass ? '✅' : '❌';
  if (!pass) allPassed = false;
  const masked = check.key.includes('KEY') || check.key.includes('TOKEN')
    ? check.value.substring(0, 8) + '...' + check.value.slice(-4)
    : check.value;
  console.log(' ' + status + ' ' + check.key + ': ' + masked);
}

console.log('');
if (allPassed) {
  console.log('✅ STEP 1 COMPLETE: Environment verified. Waiting for permission to proceed to Step 2.');
} else {
  console.log('❌ Some environment variables failed validation.');
}
