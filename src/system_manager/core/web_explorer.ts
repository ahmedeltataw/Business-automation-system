import * as fs from 'fs';
import * as path from 'path';
import * as cheerio from 'cheerio';
import { elkingEngine } from './elking_engine';

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

const SCRAPE_TIMEOUT = 15000;
const MAX_RESULTS = 5;
const MAX_SCRAPE_CHARS = 5000;

function extractUrl(href: string): string {
  if (!href) return '';
  if (href.startsWith('http')) return href;
  const u = new URL(href, 'https://duckduckgo.com');
  const redirect = u.searchParams.get('uddg');
  return redirect || u.toString();
}

export class WebExplorer {
  async searchAndSynthesize(query: string): Promise<string> {
    const results = await this.searchDuckDuckGo(query);
    if (results.length === 0) {
      return "معلش يا ليدر، ما لقيتش نتائج للبحث ده. جرب صياغة تانية.";
    }

    const scrapedTexts = await Promise.all(
      results.slice(0, 3).map(r => this.scrapeUrl(r.url))
    );

    const context = results.map((r, i) =>
      `[${i + 1}] ${r.title}\nURL: ${r.url}\nSnippet: ${r.snippet}\n${
        scrapedTexts[i] ? `Content: ${scrapedTexts[i]!.slice(0, 2000)}` : ''
      }`
    ).join('\n\n');

    const synthesisPrompt = `حلل و لخص المعلومات دي عن "${query}":\n\nالمصادر:\n${context}\n\nالمطلوب:\n- خلص الكلام في 3-4 نقاط رئيسية\n- حط روابط المصادر\n- استخدم أسلوبك التقني الحاد\n- لو الموضوع تقني، استخدم المقاييس و المعايير المتاحة`;

    return elkingEngine.generateKingResponse(synthesisPrompt, []);
  }

  async ingestUrlToMemory(url: string): Promise<boolean> {
    try {
      const content = await this.scrapeUrl(url);
      if (!content || content.length < 50) return false;

      const title = url.split('/').pop()?.replace(/[-_]/g, ' ') || url;
      const knowledgeDir = path.resolve(process.cwd(), '.agent', 'knowledge');
      if (!fs.existsSync(knowledgeDir)) {
        fs.mkdirSync(knowledgeDir, { recursive: true });
      }

      const entry = {
        source: url,
        title,
        ingestedAt: new Date().toISOString(),
        content: content.slice(0, 30000),
      };

      fs.writeFileSync(
        path.join(knowledgeDir, `web_${Date.now()}.json`),
        JSON.stringify(entry, null, 2),
        'utf-8'
      );

      return true;
    } catch {
      return false;
    }
  }

  private async searchDuckDuckGo(query: string): Promise<SearchResult[]> {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return [];

    const html = await response.text();
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];

    $('.result').each((_i, el) => {
      const titleEl = $(el).find('.result__title a');
      const snippetEl = $(el).find('.result__snippet');

      const title = titleEl.text().trim();
      const href = titleEl.attr('href') || '';
      const snippet = snippetEl.text().trim();

      if (title && snippet) {
        results.push({ title, url: extractUrl(href), snippet });
      }
    });

    return results.slice(0, MAX_RESULTS);
  }

  private async scrapeUrl(url: string): Promise<string> {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        signal: AbortSignal.timeout(SCRAPE_TIMEOUT),
      });

      if (!response.ok) return '';

      const html = await response.text();
      const $ = cheerio.load(html);

      $('script, style, nav, footer, header, aside, iframe, noscript').remove();

      const mainContent = $('main, article, .content, #content, .post, .article').text()
        || $('body').text();

      return mainContent.replace(/\s+/g, ' ').trim().slice(0, MAX_SCRAPE_CHARS);
    } catch {
      return '';
    }
  }
}

export const webExplorer = new WebExplorer();
