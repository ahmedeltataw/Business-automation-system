import type { Page } from 'playwright';

export interface BanCheckResult {
  banned: boolean;
  reason?: string;
  signal?: string;
}

const BAN_SIGNALS = [
  'captcha', 'recaptcha', 'cf-challenge', 'cloudflare',
  'blocked', 'access denied', 'access denied.', 'your ip',
  'rate limit', 'too many requests', '429',
  'please wait', 'verifying you are human',
  'checked your browser', 'ddos-guard',
  'ممنوع', 'محظور', 'حظر', 'تم حظرك',
  'الوصول مرفوض', 'طلب كثير', 'captcha', 'verify',
  'you have been blocked', 'our systems',
];

const SUSPICIOUS_HTTP_CODES = [403, 429, 503, 502];

export function isSuspiciousStatusCode(status: number): boolean {
  return SUSPICIOUS_HTTP_CODES.includes(status);
}

export async function checkBan(page: Page, url?: string): Promise<BanCheckResult> {
  const pageUrl = url ?? page.url();

  let bodyText = '';
  let pageTitle = '';

  try {
    bodyText = await page.evaluate(() => document.body.innerText.toLowerCase());
    pageTitle = await page.evaluate(() => document.title.toLowerCase());
  } catch {
    return { banned: true, reason: 'Page evaluation blocked', signal: 'evaluation_failed' };
  }

  const combined = `${pageTitle}\n${bodyText}`;

  for (const signal of BAN_SIGNALS) {
    if (combined.includes(signal)) {
      return {
        banned: true,
        reason: `Ban signal detected: "${signal}"`,
        signal,
      };
    }
  }

  const urlLower = pageUrl.toLowerCase();
  if (urlLower.includes('captcha') || urlLower.includes('challenge')) {
    return {
      banned: true,
      reason: 'Redirected to captcha/challenge page',
      signal: 'captcha_redirect',
    };
  }

  return { banned: false };
}
