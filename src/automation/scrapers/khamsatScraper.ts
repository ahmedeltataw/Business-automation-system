import { supabase } from '../../config/db';
import { ensureSession, SessionExpiredError } from '../sessionManager';
import { createStealthBrowser, humanDelay } from '../browserConfig';
import { notifyTelegram } from '../../telegram/notifier';
import { checkBan } from '../../monitoring/banDetector';
import { agentConfig } from '../../config/agentConfig';

export interface KhamsatRequest {
  external_id: string;
  title: string;
  description: string;
  budget: string;
  budget_currency: string;
  category: string;
  subcategory: string;
  url: string;
  posted_at: string;
  client_name: string;
  status: string;
}

const TARGET_SECTIONS = [
  'الطلبات غير الموجودة',
  'ui/ux',
  'ui ux',
  'web development',
  'mobile development',
  'تطوير مواقع',
  'تطوير تطبيقات',
  'تصميم',
];

export async function scrapeKhamsat(): Promise<KhamsatRequest[]> {
  const requests: KhamsatRequest[] = [];

  let cookies: any[];
  try {
    cookies = await ensureSession('khamsat');
  } catch (err) {
    if (err instanceof SessionExpiredError) throw err;
    console.error('Session fetch failed for khamsat:', err);
    throw err;
  }

  const { browser, page } = await createStealthBrowser(true);

  try {
    await page.context().addCookies(cookies);

    const platform = agentConfig.scrapers.platforms.khamsat;
    await page.goto(platform.baseUrl + platform.projectsPath, {
      waitUntil: 'networkidle',
      timeout: agentConfig.scrapers.navTimeout,
    });

    await humanDelay(agentConfig.scrapers.humanDelay.min, agentConfig.scrapers.humanDelay.max);

    const banResult = await checkBan(page);
    if (banResult.banned) {
      await notifyTelegram(`🚨 *Ban Detected on Khamsat*\n${banResult.reason}`);
      return [];
    }

    const rawRequests = await page.evaluate((sections) => {
      const items: any[] = [];
      const allText = document.body.innerText.toLowerCase();
      const isTargetSection = sections.some((s) => allText.includes(s.toLowerCase()));
      const rows = document.querySelectorAll('tr.forum_post');

      rows.forEach((row) => {
        const titleLink = row.querySelector('h3.details-head a');
        const clientEl = row.querySelector('.details-list li:first-child a.user');

        const href = titleLink?.getAttribute('href') ?? '';

        if (!href.startsWith('/community/requests/')) return;

        const title = titleLink?.textContent?.trim() ?? '';
        const clientName = clientEl?.textContent?.trim() ?? '';

        const matchesTarget = !isTargetSection || sections.some(
          (s) => title.toLowerCase().includes(s.toLowerCase()) || clientName.toLowerCase().includes(s.toLowerCase())
        );

        if (!title || title.length < 3) return;

        items.push({
          title,
          description: '',
          budget: '',
          url: href,
          client_name: clientName,
          html: matchesTarget ? row.outerHTML.slice(0, 300) : '',
        });
      });

      return items;
    }, TARGET_SECTIONS);

    for (const raw of rawRequests) {
      const fullUrl = raw.url
        ? (raw.url.startsWith('http') ? raw.url : `https://khamsat.com${raw.url}`)
        : '';

      const idMatch = fullUrl.match(/\/request[s]?\/(\d+)/);
      const externalId = idMatch ? idMatch[1] : `khamsat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      const title = raw.title || raw.description.slice(0, 80);
      if (!title || title.length < 5) continue;

      const detectedSection = TARGET_SECTIONS.find(
        (s) => title.toLowerCase().includes(s.toLowerCase())
      );

      const request: KhamsatRequest = {
        external_id: externalId,
        title,
        description: raw.description,
        budget: raw.budget,
        budget_currency: 'USD',
        category: detectedSection ?? 'General',
        subcategory: '',
        url: fullUrl,
        posted_at: new Date().toISOString(),
        client_name: raw.client_name,
        status: 'new',
      };

      requests.push(request);
    }

    if (requests.length > 0) {
      const { error } = await supabase.from('scraped_jobs').upsert(
        requests.map((r) => ({
          platform: 'khamsat',
          external_id: r.external_id,
          title: r.title,
          description: r.description,
          budget: r.budget,
          budget_currency: r.budget_currency,
          skills: [],
          category: r.category,
          url: r.url,
          posted_at: r.posted_at,
          client_name: r.client_name,
          client_country: '',
          raw_data: r,
          status: r.status,
        })),
        { onConflict: 'external_id' }
      );

      if (error) {
        console.error('Failed to persist Khamsat requests:', error.message);
      } else {
        console.log(`Persisted ${requests.length} Khamsat requests`);
      }
    }

    return requests;
  } finally {
    await browser.close();
  }
}
