import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser, BrowserContext, Page } from 'playwright';
import { agentConfig } from '../config/agentConfig';

chromium.use(StealthPlugin());

export interface Point {
  x: number;
  y: number;
}

export interface StealthBrowser {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

const B = agentConfig.browser;

export async function createStealthBrowser(headless: boolean = true): Promise<StealthBrowser> {
  const browser = await chromium.launch({
    headless,
    args: B.args,
  });

  const context = await browser.newContext({
    viewport: B.viewport,
    userAgent: B.userAgent,
    timezoneId: B.timezoneId,
    locale: B.locale,
    geolocation: B.geolocation,
    permissions: ['geolocation'],
    deviceScaleFactor: 1,
    hasTouch: false,
    isMobile: false,
  });

  const page = await context.newPage();

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5] as unknown as PluginArray,
    });
    Object.defineProperty(navigator, 'languages', { get: () => ['ar-EG', 'en-US', 'en'] });

    const origGetContext = HTMLCanvasElement.prototype.getContext.bind(HTMLCanvasElement.prototype) as any;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: any[]) {
      const ctx = origGetContext(...args) as any;
      if (ctx && typeof ctx.getImageData === 'function') {
        const origGetImageData = ctx.getImageData.bind(ctx);
        ctx.getImageData = function (...ia: any[]) {
          const imgData = origGetImageData(...ia);
          for (let i = 0; i < imgData.data.length; i += 4) {
            imgData.data[i] += Math.floor(Math.random() * 3) - 1;
            imgData.data[i + 1] += Math.floor(Math.random() * 3) - 1;
            imgData.data[i + 2] += Math.floor(Math.random() * 3) - 1;
          }
          return imgData;
        };
      }
      return ctx;
    } as any;
  });

  return { browser, context, page };
}

export async function humanDelay(minMs?: number, maxMs?: number): Promise<void> {
  const min = minMs ?? B.humanDelay.minMs;
  const max = maxMs ?? B.humanDelay.maxMs;
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

export function generateBezierPath(start: Point, end: Point, steps: number = B.bezierSteps): Point[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;

  const cp1: Point = {
    x: start.x + dx * 0.2 + (Math.random() - 0.5) * Math.min(Math.abs(dx) * 0.3, 60),
    y: start.y + dy * 0.1 + (Math.random() - 0.5) * Math.min(Math.abs(dy) * 0.3, 60),
  };
  const cp2: Point = {
    x: start.x + dx * 0.8 + (Math.random() - 0.5) * Math.min(Math.abs(dx) * 0.3, 60),
    y: start.y + dy * 0.9 + (Math.random() - 0.5) * Math.min(Math.abs(dy) * 0.3, 60),
  };

  const points: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const x = u * u * u * start.x + 3 * u * u * t * cp1.x + 3 * u * t * t * cp2.x + t * t * t * end.x;
    const y = u * u * u * start.y + 3 * u * u * t * cp1.y + 3 * u * t * t * cp2.y + t * t * t * end.y;
    points.push({ x: Math.round(x), y: Math.round(y) });
  }
  return points;
}

export async function humanMouseMove(page: Page, endX: number, endY: number): Promise<void> {
  const def = B.defaultMousePos;
  const currentPos = { x: def.x, y: def.y };
  try {
    const evalPos = await page.evaluate(() => ({ x: (window as any).__mouseX ?? 960, y: (window as any).__mouseY ?? 540 } as any));
    currentPos.x = evalPos.x;
    currentPos.y = evalPos.y;
  } catch {}

  const steps = B.mouseMoveStepsBase + Math.floor(Math.random() * B.mouseMoveStepsRandom);
  const path = generateBezierPath(currentPos, { x: endX, y: endY }, steps);

  for (const point of path) {
    await page.mouse.move(point.x, point.y);
    await new Promise((r) => setTimeout(r, B.mouseMoveDelayMs.min + Math.random() * B.mouseMoveDelayMs.max));
  }
}
