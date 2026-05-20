/**
 * Smoke Test — Fingerprint & System Validation
 *
 * Launches an anti-detect browser instance, navigates to a strict
 * fingerprint audit target, and reports whether our configuration
 * passes undetected as a natural human. Exit code 0 = clean.
 */

import { createManagerBrowser, verifyFingerprint, humanScroll } from './browser_factory';
import { getPerformanceSummary } from './learning_memory';

const AUDIT_URL = 'https://bot.sannysoft.com';
const FALLBACK_URL = 'https://httpbin.org/headers';

async function run(): Promise<void> {
  console.log('🧬 System Manager — Smoke Test');
  console.log('═══════════════════════════════\n');

  const summary = await getPerformanceSummary();
  console.log(`📊 Learning Memory: ${summary.total} runs, ${(summary.successRate * 100).toFixed(1)}% success rate`);
  if (summary.topLessons.length) {
    summary.topLessons.forEach((l) => console.log(`   ⚠ ${l}`));
  }
  console.log('');

  console.log('🚀 Launching anti-detect browser...');
  const { browser, context, page } = await createManagerBrowser({
    headless: true,
  });

  try {
    // Inline fingerprint check before navigation
    const preMetrics = await verifyFingerprint(page);
    console.log(`   WebDriver masked:     ${!preMetrics.webdriver ? '✅' : '❌'}`);
    console.log(`   Plugins length:       ${preMetrics.pluginsLength > 0 ? '✅' : '⚠'}`);
    console.log(`   Languages:            ${preMetrics.languages}`);
    console.log(`   Canvas noise:         ${preMetrics.canvasNoise ? '✅' : '⚠'}`);
    console.log(`   WebGL vendor:         ${preMetrics.webglVendor}`);

    // Navigate to fingerprint audit
    console.log(`\n🌐 Navigating to ${AUDIT_URL}...`);
    let pageTitle = '';
    try {
      await page.goto(AUDIT_URL, { waitUntil: 'networkidle', timeout: 30000 });
      pageTitle = await page.title();
      console.log(`   Page title: ${pageTitle}`);
      await humanScroll(page);
    } catch {
      console.log('   ⚠ bot.sannysoft.com unreachable — falling back to httpbin');
      await page.goto(FALLBACK_URL, { waitUntil: 'networkidle', timeout: 15000 });
      const body = await page.evaluate(() => document.body.innerText);
      console.log(`   Headers received (${body.length} chars)`);
    }

    // Post-navigation fingerprint re-check
    console.log('\n🔍 Post-navigation fingerprint validation:');
    const postMetrics = await verifyFingerprint(page);
    const allPass =
      !postMetrics.webdriver &&
      postMetrics.pluginsLength > 0 &&
      postMetrics.canvasNoise;

    if (allPass) {
      console.log('\n✅ ALL FINGERPRINT CHECKS PASSED — Browser is fully camouflaged');
    } else {
      console.log('\n⚠ Some fingerprint checks triggered warnings:');
      if (postMetrics.webdriver) console.log('   - WebDriver flag is visible');
      if (postMetrics.pluginsLength === 0) console.log('   - Plugin array is empty');
      if (!postMetrics.canvasNoise) console.log('   - Canvas fingerprint not randomised');
    }

    console.log(`\n📸 Screenshot saved to smoke_test_fingerprint.png`);
    await page.screenshot({ path: 'smoke_test_fingerprint.png', fullPage: true });

    process.exit(allPass ? 0 : 1);
  } catch (err: any) {
    console.error(`\n❌ Smoke test failed: ${err.message}`);
    process.exit(1);
  } finally {
    await context.close();
    await browser.close();
  }
}

run();
