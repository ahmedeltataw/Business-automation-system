/**
 * Kafil Website Scraper
 * 
 * Scrapes freelance project listings from Kafil (kafil.com).
 * Extracts project metadata including title, description, budget, and client info,
 * then persists enriched records to Supabase.
 */

import { supabase, TABLES } from '../../config/db';
import { ensureSession } from '../sessionManager';
import { createStealthBrowser, humanDelay } from '../browserConfig';
import { notifyTelegram } from '../../telegram/notifier';
import { checkBan } from '../../monitoring/banDetector';
import { agentConfig } from '../../config/agentConfig';

/** Raw project data extracted from page DOM */
interface RawProject {
  title: string;
  description: string;
  budget: string;
  url: string;
  client_name: string;
}

/** Final project record with generated fields */
interface EnrichedProject {
  external_id: string;
  title: string;
  description: string;
  budget: string;
  budget_currency: string;
  url: string;
  posted_at: string;
  client_name: string;
}

const BASE_URL = 'https://kafil.com';

export async function scrapeKafil(): Promise<EnrichedProject[]> {
  const projects: EnrichedProject[] = [];

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

    const platform = agentConfig.scrapers.platforms.kafil;
    await page.goto(platform.baseUrl + platform.projectsPath, {
      waitUntil: 'domcontentloaded',
      timeout: agentConfig.scrapers.navTimeout,
    });
    await humanDelay(1000, 2000);

    const banResult = await checkBan(page);
    if (banResult.banned) {
      await notifyTelegram(`🚨 *Ban Detected on Kafil*\n${banResult.reason}`);
      return [];
    }

    const rawProjects = await page.evaluate((): RawProject[] => {
      const items: RawProject[] = [];
      document.querySelectorAll('tr.project-row').forEach((row) => {
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

    for (const raw of rawProjects) {
      const fullUrl = raw.url
        ? (raw.url.startsWith('http') ? raw.url : `${BASE_URL}${raw.url}`)
        : '';

      const idMatch = fullUrl.match(/\/project[s]?\/(\d+)/);
      const externalId = idMatch
        ? idMatch[1]
        : `kafil-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      projects.push({
        external_id: externalId,
        title: raw.title,
        description: raw.description,
        budget: raw.budget,
        budget_currency: 'SAR',
        url: fullUrl,
        posted_at: new Date().toISOString(),
        client_name: raw.client_name,
      });
    }

    if (projects.length > 0) {
      const { error } = await supabase.from(TABLES.scrapedJobs).upsert(
        projects.map((p) => ({
          platform: 'kafil',
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
        console.error('Failed to persist Kafil projects:', error.message);
      } else {
        console.log(`Persisted ${projects.length} Kafil projects`);
      }
    }

    return projects;
  } finally {
    await browser.close();
  }
}
