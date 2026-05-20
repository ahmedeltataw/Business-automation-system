import { supabase, TABLES } from '../../config/db';
import { ensureSession } from '../sessionManager';
import { createStealthBrowser, humanDelay } from '../browserConfig';
import { notifyTelegram } from '../../telegram/notifier';
import { checkBan } from '../../monitoring/banDetector';
import { agentConfig } from '../../config/agentConfig';

export interface MostaqlProject {
  external_id: string;
  title: string;
  description: string;
  budget: string;
  budget_currency: string;
  skills: string[];
  category: string;
  url: string;
  posted_at: string;
  client_name: string;
  client_country: string;
  proposals_count: number;
  execution_time: string;
  client_hiring_rate: string;
}

export async function scrapeMostaql(): Promise<MostaqlProject[]> {
  const projects: MostaqlProject[] = [];

  let cookies: any[];
  try {
    cookies = await ensureSession('mostaql');
  } catch (err) {
    console.error('Session fetch failed for mostaql:', err);
    cookies = [];
  }

  const { browser, page } = await createStealthBrowser(true);

  try {
    await page.context().addCookies(cookies);

    const platform = agentConfig.scrapers.platforms.mostaql;
    await page.goto(platform.baseUrl + platform.projectsPath, {
      waitUntil: 'domcontentloaded',
      timeout: agentConfig.scrapers.navTimeout,
    });
    await humanDelay(1000, 2000);

    const banResult = await checkBan(page);
    if (banResult.banned) {
      await notifyTelegram(`🚨 *Ban Detected on Mostaql*\n${banResult.reason}`);
      return [];
    }

    const rawProjects = await page.evaluate(() => {
      const items: any[] = [];
      const rows = document.querySelectorAll('tr.project-row');

      rows.forEach((row) => {
        const titleLink = row.querySelector('h2.mrg--bt-reset a');
        const descLink = row.querySelector('p.project__brief a.details-url, p.project__brief');
        const clientEl = row.querySelector('ul.project__meta li bdi');
        const proposalsEl = row.querySelector('ul.project__meta li:last-child');
        const budgetEl = row.querySelector('[class*="budget"], [class*="Budget"], [class*="price"], [class*="Price"]');

        const href = titleLink?.getAttribute('href') ?? '';

        items.push({
          title: (titleLink?.textContent ?? '').replace(/\s+/g, ' ').trim(),
          description: (descLink?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 500),
          budget: budgetEl?.textContent?.trim() ?? '',
          url: href,
          client_name: clientEl?.textContent?.trim() ?? '',
          proposals_count: parseInt(proposalsEl?.textContent?.trim()?.match(/\d+/)?.[0] ?? '0', 10),
        });
      });

      return items;
    });

    for (const raw of rawProjects) {
      const fullUrl = raw.url
        ? (raw.url.startsWith('http') ? raw.url : `${agentConfig.scrapers.platforms.mostaql.baseUrl}${raw.url}`)
        : '';

      const idMatch = fullUrl.match(/\/project[s]?\/(\d+)/);
      const externalId = idMatch ? idMatch[1] : `mostaql-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      const project: MostaqlProject = {
        external_id: externalId,
        title: raw.title,
        description: raw.description,
        budget: raw.budget,
        budget_currency: 'USD',
        skills: [],
        category: 'Freelance',
        url: fullUrl,
        posted_at: new Date().toISOString(),
        client_name: raw.client_name,
        client_country: '',
        proposals_count: raw.proposals_count,
        execution_time: '',
        client_hiring_rate: '',
      };

      projects.push(project);
    }

    // Enrich top projects with detail-page metadata (execution_time, client_hiring_rate)
    const enrichLimit = Math.min(projects.length, agentConfig.scrapers.maxEnrichPages ?? 10);
    for (let i = 0; i < enrichLimit; i++) {
      const p = projects[i];
      if (!p.url) continue;
      try {
        await page.goto(p.url, { waitUntil: 'domcontentloaded', timeout: agentConfig.scrapers.navTimeout });
        await humanDelay(1000, 2000);
        const enriched = await page.evaluate(() => {
          const sidebarEl = document.querySelector('.project-card');
          const timeEl = sidebarEl?.querySelector('[class*="duration"], [class*="execution"], [class*="time"]');
          const rateEl = document.querySelector('[class*="client"] [class*="rate"], [class*="client_rate"], [class*="rating"]');
          return {
            execution_time: timeEl?.textContent?.trim() ?? '',
            client_hiring_rate: rateEl?.textContent?.trim() ?? '',
          };
        });
        p.execution_time = enriched.execution_time;
        p.client_hiring_rate = enriched.client_hiring_rate;
        console.log(`  [mostaql] Enriched #${p.external_id}: exec=${enriched.execution_time} rate=${enriched.client_hiring_rate}`);
      } catch (err: any) {
        console.error(`  [mostaql] Enrich failed for ${p.external_id}: ${err.message}`);
      }
    }

    if (projects.length > 0) {
      const { error } = await supabase.from(TABLES.scrapedJobs).upsert(
        projects.map((p) => ({
          platform: 'mostaql',
          external_id: p.external_id,
          title: p.title,
          description: p.description,
          budget: p.budget,
          budget_currency: p.budget_currency,
          skills: p.skills,
          category: p.category,
          url: p.url,
          posted_at: p.posted_at,
          client_name: p.client_name,
          client_country: p.client_country,
          proposals_count: p.proposals_count,
          execution_time: p.execution_time || null,
          client_hiring_rate: p.client_hiring_rate || null,
          raw_data: p,
          status: 'new',
        })),
        { onConflict: 'external_id' }
      );

      if (error) {
        console.error('Failed to persist Mostaql projects:', error.message);
      } else {
        console.log(`Persisted ${projects.length} Mostaql projects`);
      }
    }

    return projects;
  } finally {
    await browser.close();
  }
}
