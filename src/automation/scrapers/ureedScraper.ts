/**
 * Ureed Scraper — Extracts freelance projects from Ureed.com
 *
 * Uses Playwright stealth browser to scrape project listings,
 * enriches with detail-page metadata, and persists to Supabase.
 */

import { supabase, TABLES } from '../../config/db';
import { ensureSession } from '../sessionManager';
import { createStealthBrowser, humanDelay } from '../browserConfig';
import { notifyTelegram } from '../../telegram/notifier';
import { checkBan } from '../../monitoring/banDetector';
import { agentConfig } from '../../config/agentConfig';

/** Raw project shape returned from page.evaluate() */
interface RawProject {
  title: string;
  description: string;
  budget: string;
  url: string;
  client_name: string;
}

/** Standardized project record for Supabase persistence */
export interface UreedProject {
  external_id: string;
  title: string;
  description: string;
  budget: string;
  budget_currency: string;
  url: string;
  posted_at: string;
  client_name: string;
}

const BASE_URL = agentConfig.scrapers.platforms.ureed.baseUrl;

/**
 * Scrape Ureed.com for available freelance projects.
 * @returns Array of standardized UreedProject records
 */
export async function scrapeUreed(): Promise<UreedProject[]> {
  const projects: UreedProject[] = [];

  let cookies: any[];
  try {
    cookies = await ensureSession('ureed');
  } catch (err) {
    console.error('Session fetch failed for ureed:', err);
    cookies = [];
  }

  const { browser, page } = await createStealthBrowser(true);

  try {
    await page.context().addCookies(cookies);

    const platform = agentConfig.scrapers.platforms.ureed;
    await page.goto(BASE_URL + platform.projectsPath, {
      waitUntil: 'domcontentloaded',
      timeout: agentConfig.scrapers.navTimeout,
    });
    await humanDelay(1000, 2000);

    const banResult = await checkBan(page);
    if (banResult.banned) {
      await notifyTelegram(`🚨 *Ban Detected on Ureed*\n${banResult.reason}`);
      return [];
    }

    const rawProjects = await page.evaluate((): RawProject[] => {
      const items: RawProject[] = [];
      document.querySelectorAll('tr.project-row').forEach((row) => {
        const link = row.querySelector('h2 a');
        const desc = row.querySelector('p.project__brief');
        const budgetEl = row.querySelector(
          '[class*="budget"], [class*="Budget"], [class*="price"], [class*="Price"]'
        );
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

    for (const item of rawProjects) {
      const fullUrl = item.url
        ? item.url.startsWith('http')
          ? item.url
          : `${BASE_URL}${item.url}`
        : '';

      const idMatch = fullUrl.match(/\/project[s]?\/(\d+)/);
      const externalId = idMatch
        ? idMatch[1]
        : `ureed-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      projects.push({
        external_id: externalId,
        title: item.title,
        description: item.description,
        budget: item.budget,
        budget_currency: 'USD',
        url: fullUrl,
        posted_at: new Date().toISOString(),
        client_name: item.client_name,
      });
    }

    if (projects.length > 0) {
      const { error } = await supabase.from(TABLES.scrapedJobs).upsert(
        projects.map((p) => ({
          platform: 'ureed',
          external_id: p.external_id,
          title: p.title,
          description: p.description,
          budget: p.budget,
          budget_currency: p.budget_currency,
          skills: [],
          category: 'Freelance',
          url: p.url,
          posted_at: p.posted_at,
          client_name: p.client_name,
          client_country: '',
          raw_data: p,
          status: 'new',
        })),
        { onConflict: 'external_id' }
      );

      if (error) {
        console.error('Failed to persist Ureed projects:', error.message);
      } else {
        console.log(`Persisted ${projects.length} Ureed projects`);
      }
    }

    return projects;
  } finally {
    await browser.close();
  }
}
