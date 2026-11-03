import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage']
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  colorScheme: 'light'
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));

try {
  await page.goto('http://127.0.0.1:8080/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() =>
    !!window.DuoAppearance &&
    !!document.documentElement.dataset.duoThemeResolved,
    { timeout: 20000 }
  );

  const initial = await page.evaluate(() => ({
    mode: state.appearanceSettings.mode,
    media: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    resolved: document.documentElement.dataset.duoThemeResolved
  }));
  assert.equal(initial.mode, 'system', 'fresh installation should default to follow-system mode');
  assert.equal(initial.media, 'light');
  assert.equal(initial.resolved, 'light');

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForFunction(() =>
    matchMedia('(prefers-color-scheme: dark)').matches &&
    document.documentElement.dataset.duoThemeResolved === 'dark',
    { timeout: 5000 }
  );
  const dark = await page.evaluate(() => ({
    media: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    resolved: document.documentElement.dataset.duoThemeResolved
  }));
  assert.deepEqual(dark, { media: 'dark', resolved: 'dark' });

  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForFunction(() =>
    !matchMedia('(prefers-color-scheme: dark)').matches &&
    document.documentElement.dataset.duoThemeResolved === 'light',
    { timeout: 5000 }
  );
  const light = await page.evaluate(() => ({
    media: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    resolved: document.documentElement.dataset.duoThemeResolved
  }));
  assert.deepEqual(light, { media: 'light', resolved: 'light' });

  assert.deepEqual(errors, [], 'theme changes must not produce page errors');
  console.log('PASS: website system theme follows light → dark → light media changes.');
} finally {
  await browser.close();
}
