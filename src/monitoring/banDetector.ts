import type { Page } from 'playwright';

export interface BanCheckResult {
  banned: boolean;
  reason?: string;
  signal?: string;
}

const BAN_PAGE_TITLE_SIGNALS = [
  'account suspended',
  'account disabled',
  'حسابك معطل',
  'حسابك موقوف',
  'تم حظر حسابك',
  'you have been blocked',
];

const BAN_URL_PATTERNS = [
  '/blocked',
  '/suspended',
  '/banned',
  '/access-denied',
  '/captcha',
  '/challenge',
  '/verify-human',
];

const BAN_CSS_SELECTORS = [
  '.access-denied',
  '.blocked-page',
  '.suspended-account',
  '.captcha-container',
  '#cf-challenge',
  '.ddos-guard',
];

const SOFT_BAN_SIGNALS = [
  'cf-challenge',
  'cloudflare challenge',
  'ddos-guard',
  'checking your browser',
  'verifying you are human',
];

export async function checkBan(page: Page, url?: string): Promise<BanCheckResult> {
  const pageUrl = url ?? page.url();
  const urlLower = pageUrl.toLowerCase();

  // 1. Check URL for ban/suspension redirect patterns
  for (const pattern of BAN_URL_PATTERNS) {
    if (urlLower.includes(pattern)) {
      return { banned: true, reason: `Redirected to ban page: "${pattern}"`, signal: 'ban_url_redirect' };
    }
  }

  // 2. Check page title for explicit ban messages
  let pageTitle = '';
  try {
    pageTitle = await page.evaluate(() => document.title.toLowerCase());
  } catch {
    // Can't read title, continue to other checks
  }

  for (const signal of BAN_PAGE_TITLE_SIGNALS) {
    if (pageTitle.includes(signal)) {
      return { banned: true, reason: `Ban detected in page title: "${signal}"`, signal: 'title_ban_signal' };
    }
  }

  // 3. Check for ban-specific CSS selectors
  for (const selector of BAN_CSS_SELECTORS) {
    try {
      const el = await page.$(selector);
      if (el) {
        return { banned: true, reason: `Ban element found: "${selector}"`, signal: 'css_ban_selector' };
      }
    } catch {
      // Selector query failed, continue
    }
  }

  // 4. Soft ban detection (Cloudflare challenge, etc.) — log but don't block
  let bodyText = '';
  try {
    bodyText = await page.evaluate(() => document.body.innerText.toLowerCase());
  } catch {
    // Can't read body, assume OK
  }

  for (const signal of SOFT_BAN_SIGNALS) {
    if (bodyText.includes(signal)) {
      console.log(`[BanDetector] Soft signal detected: "${signal}" — continuing anyway`);
      return { banned: false, reason: `Soft ban signal (ignored): "${signal}"`, signal };
    }
  }

  return { banned: false };
}
