/**
 * Browser Factory — Anti-Detect MetaClaw Engine
 *
 * Creates stealth-optimised Playwright contexts with humanized fingerprints:
 * User-Agent rotation, viewport masking, Canvas/WebGL obfuscation,
 * WebDriver eradication, and persistent cookie sessions.
 * Exports interaction helpers (typing, mouse curves, scroll) that
 * mimic natural human behaviour for undetectable automation.
 */

import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser, BrowserContext, Page } from 'playwright';
import { agentConfig } from '../config/agentConfig';

chromium.use(StealthPlugin());

/** Pool of realistic desktop User-Agent strings, rotated per session */
const UA_POOL: readonly string[] = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.208 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:126.0) Gecko/20100101 Firefox/126.0',
];

/** Realistic viewport presets — random selection per context */
const VIEWPORT_POOL: ReadonlyArray<{ width: number; height: number }> = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1536, height: 864 },
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
];

export interface FactoryOptions {
  headless?: boolean;
  cookiePath?: string;
  recordVideo?: boolean;
}

export interface FingerprintMetrics {
  webdriver: boolean;
  pluginsLength: number;
  languages: string;
  canvasNoise: boolean;
  webglVendor: string;
}

function pickRandom<T>(pool: ReadonlyArray<T>): T {
  return pool[Math.floor(Math.random() * pool.length)];
}

function buildInitScript(viewport: { width: number; height: number }): string {
  return `
    // Eradicate WebDriver flag
    Object.defineProperty(navigator, 'webdriver', { get: () => false });

    // Spoof plugin array length
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5] 
    });

    // Set realistic language preferences
    Object.defineProperty(navigator, 'languages', {
      get: () => ['ar-EG', 'en-US', 'en']
    });

    // Mask viewport — hide outer vs inner discrepancies
    const origOuter = Object.getOwnPropertyDescriptor(Window.prototype, 'outerWidth');
    Object.defineProperty(window, 'outerWidth', { 
      get: () => ${viewport.width + 16} 
    });
    Object.defineProperty(window, 'outerHeight', {
      get: () => ${viewport.height + 88} 
    });

    // Canvas fingerprint noise (±1 on each RGBA channel)
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (...args) {
      const ctx = origGetContext.apply(this, args);
      if (ctx && typeof ctx.getImageData === 'function') {
        const origGetImageData = ctx.getImageData.bind(ctx);
        ctx.getImageData = function (...ia) {
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
    };

    // WebGL vendor/renderer spoofing
    const origGetParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (param) {
      if (param === 37445) return 'Intel Inc.';          // UNMASKED_VENDOR_WEBGL
      if (param === 37446) return 'Intel Iris OpenGL Engine'; // UNMASKED_RENDERER_WEBGL
      return origGetParameter.apply(this, arguments);
    };
  `;
}

export async function createManagerBrowser(
  options: FactoryOptions = {},
): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
  const viewport = pickRandom(VIEWPORT_POOL);
  const userAgent = pickRandom(UA_POOL);

  const browser = await chromium.launch({
    headless: options.headless ?? agentConfig.browser.args.includes('--headless=new') ?? true,
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      `--window-size=${viewport.width},${viewport.height + 88}`,
    ],
  });

  const context = await browser.newContext({
    viewport,
    userAgent,
    timezoneId: 'Africa/Cairo',
    locale: 'ar-EG',
    geolocation: { latitude: 30.0444, longitude: 31.2357 },
    permissions: ['geolocation'],
    deviceScaleFactor: 1,
    hasTouch: false,
    isMobile: false,
    ...(options.recordVideo ? { recordVideo: { dir: './recordings' } } : {}),
  });

  if (options.cookiePath) {
    try {
      const { readFileSync } = await import('fs');
      const cookies = JSON.parse(readFileSync(options.cookiePath, 'utf-8'));
      await context.addCookies(cookies);
    } catch {
      // no-op: cookies file absent or corrupt
    }
  }

  const page = await context.newPage();
  await page.addInitScript(buildInitScript(viewport));

  return { browser, context, page };
}

export async function persistCookies(
  context: BrowserContext,
  filePath: string,
): Promise<void> {
  const cookies = await context.cookies();
  const { writeFileSync } = await import('fs');
  writeFileSync(filePath, JSON.stringify(cookies, null, 2), 'utf-8');
}

export async function verifyFingerprint(page: Page): Promise<FingerprintMetrics> {
  return page.evaluate((): FingerprintMetrics => {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 200;
    const ctx = canvas.getContext('2d')!;
    ctx.fillText('fingerprint', 10, 50);
    const imageData = ctx.getImageData(0, 0, 200, 200);
    const hasNoise = imageData.data.some((v) => v % 2 !== 0);
    const gl = canvas.getContext('webgl')!;
    const debugInfo = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      webdriver: (navigator as any).webdriver,
      pluginsLength: navigator.plugins.length,
      languages: navigator.languages.join(','),
      canvasNoise: hasNoise,
      webglVendor: debugInfo
        ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)
        : 'unknown',
    };
  });
}

export async function humanType(
  page: Page,
  selector: string,
  text: string,
): Promise<void> {
  await page.click(selector);
  const baseDelay = 80;
  const variance = 40;
  for (const char of text) {
    await page.keyboard.type(char, {
      delay: baseDelay + Math.floor(Math.random() * variance),
    });
  }
}

export async function humanClick(
  page: Page,
  selector: string,
): Promise<void> {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`Element not found: ${selector}`);

  const targetX = box.x + box.width / 2 + (Math.random() - 0.5) * 10;
  const targetY = box.y + box.height / 2 + (Math.random() - 0.5) * 10;

  const steps = 8 + Math.floor(Math.random() * 6);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await page.mouse.move(
      targetX * t + (Math.random() - 0.5) * 40 * (1 - t),
      targetY * t + (Math.random() - 0.5) * 40 * (1 - t),
    );
    await new Promise((r) => setTimeout(r, 15 + Math.random() * 20));
  }
  await page.mouse.click(targetX, targetY);
}

export async function humanScroll(
  page: Page,
  distance?: number,
): Promise<void> {
  const maxScroll = await page.evaluate(
    () => document.body.scrollHeight - window.innerHeight,
  );
  const total = distance ?? Math.floor(maxScroll * (0.3 + Math.random() * 0.5));
  const steps = 6 + Math.floor(Math.random() * 4);
  const segment = Math.floor(total / steps);

  for (let i = 0; i < steps; i++) {
    await page.evaluate((s: number) => window.scrollBy(0, s), segment);
    await new Promise((r) => setTimeout(r, 40 + Math.random() * 60));
  }
}
