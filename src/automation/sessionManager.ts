import { supabase } from '../config/db';
import { createStealthBrowser } from './browserConfig';
import { notifyTelegram } from '../telegram/notifier';
import { agentConfig } from '../config/agentConfig';

export class SessionExpiredError extends Error {
  public platform: string;
  constructor(platform: string) {
    super(`Session expired for platform: ${platform}`);
    this.name = 'SessionExpiredError';
    this.platform = platform;
  }
}

export async function ensureSession(platform: string): Promise<any[]> {
  const { data, error } = await supabase
    .from('browser_sessions')
    .select('*')
    .eq('platform', platform)
    .single();

  if (error || !data) {
    await notifyTelegram(
      `⚠️ *Session Missing*\nNo session found for \`${platform}\`. Manual login required.`
    );
    throw new SessionExpiredError(platform);
  }

  const lastRefresh = new Date(data.last_refresh_at).getTime();
  const ageHours = (Date.now() - lastRefresh) / (1000 * 60 * 60);

  if (ageHours > agentConfig.sessionManager.expiryHours) {
    await refreshSession(platform, data.session_cookies);
  }

  return data.session_cookies;
}

export async function refreshSession(platform: string, currentCookies: any): Promise<any[]> {
  const { browser, page } = await createStealthBrowser(true);

  try {
    if (currentCookies && currentCookies.length > 0) {
      await page.context().addCookies(currentCookies);
    }

    const targetUrl = agentConfig.sessionManager.platformUrls[platform] ?? `https://${platform}.com`;
    await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: agentConfig.sessionManager.pageTimeout });

    const bodyText = await page.evaluate(() => document.body.innerText.toLowerCase());
    const loggedOutSignals = agentConfig.sessionManager.loggedOutSignals;

    const isLoggedIn = !loggedOutSignals.some((signal) => bodyText.includes(signal));

    if (!isLoggedIn) {
      await notifyTelegram(
        `🚨 *Session Expired*\n\`${platform}\` session is no longer valid. Manual re-login required.`
      );
      throw new SessionExpiredError(platform);
    }

    const freshCookies = await page.context().cookies();

    const { error: upsertError } = await supabase.from('browser_sessions').upsert(
      {
        platform,
        session_cookies: freshCookies,
        last_refresh_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'platform' }
    );

    if (upsertError) {
      console.error(`Failed to save session for ${platform}:`, upsertError.message);
    }

    return freshCookies;
  } finally {
    await browser.close();
  }
}
