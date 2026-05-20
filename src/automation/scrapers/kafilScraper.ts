import { supabase } from '../../config/db';
import { ensureSession } from '../sessionManager';
import { createStealthBrowser, humanDelay } from '../browserConfig';
import { notifyTelegram } from '../../telegram/notifier';
import { checkBan } from '../../monitoring/banDetector';
import { agentConfig } from '../../config/agentConfig';

export interface KafilProject {
  external_id: string;
  title: string;
  description: string;
  budget: string;
  budget_currency: string;
  url: string;
  posted_at: string;
  client_name: string;
}

export async function scrapeKafil(): Promise<KafilProject[]> {
  const projects: KafilProject[] = [];
  let cookies: any[];
  try {
    cookies = await ensureSession('kafil');
  } catch (err) {
    console.error('Session fetch failed for kafil:', err);
    cookies = [];
  }
  const { browser, page } = await createStealthBrowser(true);
  try {
    await page.context().addCookies(cookies);
    await page.goto(agentConfig.scrapers.platforms.kafil.baseUrl + agentConfig.scrapers.platforms.kafil.projectsPath, { waitUntil: 'domcontentloaded', timeout: agentConfig.scrapers.navTimeout });
    await humanDelay(1000, 2000);
    const banResult = await checkBan(page);
    if (banResult.banned) {
      await notifyTelegram(`🚨 *Ban Detected on Kafil*\n${banResult.reason}`);
      return [];
    }
    const raw = await page.evaluate(() => {
      const items: any[] = [];
      document.querySelectorAll('tr.project-row').forEach(row => {
        const link = row.querySelector('h2 a');
        const desc = row.querySelector('p.project__brief');
        const budgetEl = row.querySelector('[class*="budget"], [class*="Budget"], [class*="price"], [class*="Price"]');
        const clientEl = row.querySelector('ul.project__meta li bdi');
        const href = link?.getAttribute('href') ?? '';
        items.push({
          title: link?.textContent?.trim() ?? '',
          description: desc?.textContent?.trim() ?? '',
          budget: budgetEl?.textContent?.trim() ?? '',
          url: href,
          client_name: clientEl?.textContent?.trim() ?? '',
        });
      });
      return items;
    });
    for (const item of raw) {
      const fullUrl = item.url ? (item.url.startsWith('http') ? item.url : `https://kafil.com${item.url}`) : '';
      const idMatch = fullUrl.match(/\/project[s]?\/(\d+)/);
      const externalId = idMatch ? idMatch[1] : `kafil-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
      projects.push({
        external_id: externalId, title: item.title, description: item.description,
        budget: item.budget, budget_currency: 'SAR', url: fullUrl,
        posted_at: new Date().toISOString(), client_name: item.client_name,
      });
    }
    if (projects.length > 0) {
      const { error } = await supabase.from('scraped_jobs').upsert(
        projects.map(p => ({
          platform: 'kafil', external_id: p.external_id, title: p.title,
          description: p.description, budget: p.budget, budget_currency: p.budget_currency,
          skills: [], category: 'Freelance', url: p.url, posted_at: p.posted_at,
          client_name: p.client_name, client_country: '', raw_data: p, status: 'new',
        })),
        { onConflict: 'external_id' }
      );
      if (error) console.error('Failed to persist Kafil projects:', error.message);
      else console.log(`Persisted ${projects.length} Kafil projects`);
    }
    return projects;
  } finally {
    await browser.close();
  }
}
