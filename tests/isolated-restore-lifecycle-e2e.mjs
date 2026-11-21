import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createValidSeed, PNG_BASE64 } from './isolated-application-fixtures.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKER = path.join(ROOT, 'tests/isolated-restore-crash-worker.mjs');
const errors = [];
const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf'
};

function startStaticServer() {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://127.0.0.1');
      if (url.pathname === '/__phase18_seed__') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        response.end('<!doctype html><html><head><meta charset="utf-8"></head><body>phase18 isolated seed origin</body></html>');
        return;
      }
      const decoded = decodeURIComponent(url.pathname);
      let target = path.resolve(ROOT, '.' + decoded);
      if (target !== ROOT && !target.startsWith(ROOT + path.sep)) { response.writeHead(403).end('Forbidden'); return; }
      let info = await stat(target);
      if (info.isDirectory()) { target = path.join(target, 'index.html'); info = await stat(target); }
      if (!info.isFile()) { response.writeHead(404).end('Not found'); return; }
      response.writeHead(200, {
        'content-type': mimeTypes[path.extname(target).toLowerCase()] || 'application/octet-stream',
        'content-length': info.size, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'
      });
      createReadStream(target).pipe(response);
    } catch (error) {
      response.writeHead(error?.code === 'ENOENT' ? 404 : 500).end('Unable to serve file');
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/index.html` }));
  });
}

function attachGuards(page, label) {
  page.on('pageerror', error => errors.push({ label, type: 'pageerror', message: error.message }));
  page.on('request', request => {
    if (/^https?:\/\/(?!127\.0\.0\.1)/i.test(request.url())) errors.push({ label, type: 'external-request', url: request.url() });
  });
}

async function seedOrigin(page, baseUrl, seed, fontBase64) {
  await page.goto(new URL('/__phase18_seed__', baseUrl).toString(), { waitUntil: 'domcontentloaded' });
  return page.evaluate(async ({ seed, fontBase64 }) => {
    const openDb = (name, version, stores, keyPathByStore = {}) => new Promise((resolve, reject) => {
      const request = indexedDB.open(name, version);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const store of stores) if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: keyPathByStore[store] || 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('phase18 IndexedDB seed open failed'));
      request.onblocked = () => reject(new Error('phase18 IndexedDB seed open blocked'));
    });
    const writeRows = (db, storeName, rows, durability = 'strict') => new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite', { durability });
      for (const row of rows) tx.objectStore(storeName).put(row);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('phase18 seed write failed'));
      tx.onabort = () => reject(tx.error || new Error('phase18 seed transaction aborted'));
    });
    localStorage.clear();
    localStorage.setItem('__twodeers_runtime_revision_v1', '0');
    localStorage.setItem('dual_space_app_clean_test_v1', JSON.stringify(seed.main));
    localStorage.setItem('dual_space_sticker_library_v1', JSON.stringify(seed.stickerLibrary));
    localStorage.setItem('twodeers_mailbox_letters_v1', JSON.stringify(seed.mailbox));
    localStorage.setItem('twodeers_card_system_v1', JSON.stringify(seed.cards));
    localStorage.setItem('moments_site_blank_v49_rebuild_baseline_same_layout', JSON.stringify(seed.circle));
    localStorage.setItem('moments_site_blank_v49_rebuild_baseline_same_layout_visitor_backup_step01b', JSON.stringify(seed.visitorBackup));
    const png = Uint8Array.from(atob(seed.pngBase64), ch => ch.charCodeAt(0));
    const rows = seed.media.map(row => ({ ...row, blob: new Blob([png], { type: 'image/png' }), size: png.byteLength }));
    const mediaDb = await openDb('dual_space_chat_media_v1', 1, ['media']);
    await writeRows(mediaDb, 'media', rows);
    mediaDb.close();
    if (fontBase64) {
      const fontBytes = Uint8Array.from(atob(fontBase64), ch => ch.charCodeAt(0));
      const fontDb = await openDb('chuanxun-local-font-library', 1, ['fonts', 'meta'], { meta: 'key' });
      const blob = new Blob([fontBytes], { type: 'font/ttf' });
      await writeRows(fontDb, 'fonts', [{ id: 'phase18_font', name: 'Phase 18 Test Font', fileName: 'phase18-test.ttf', format: 'ttf', mimeType: 'font/ttf', size: blob.size, blob, createdAt: 1_798_000_000_000 }]);
      await writeRows(fontDb, 'meta', [{ key: 'currentFontId', value: 'phase18_font', updatedAt: 1_798_000_000_000 }]);
      fontDb.close();
    }
    return { origin: location.origin, mediaCount: rows.length, fontSeeded: !!fontBase64 };
  }, { seed, fontBase64 });
}

async function waitForWritable(page) {
  await page.waitForFunction(() => !!window.__duoRuntimeCoordinator?.getStatus?.().ready, null, { timeout: 45_000 });
  await page.waitForFunction(() => window.__duoRuntimeCoordinator?.isWritable?.() === true && window.__duoRuntimeCoordinator?.getStatus?.().startupComplete === true, null, { timeout: 60_000 });
}

async function findFontBase64() {
  const candidates = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'
  ];
  for (const file of candidates) { try { return (await readFile(file)).toString('base64'); } catch {} }
  throw new Error('CI 环境缺少用于第十八阶段字体回滚演练的 TTF 文件');
}

async function testV4ThemeRestore(browser, baseUrl, fontBase64) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await context.newPage();
  attachGuards(page, 'phase18-theme-restore');
  const seed = createValidSeed();
  seed.main.appearanceSettings = { mode: 'dark', palette: 'ocean', background: 'plain', bubbleStyle: 'classic' };
  const seeded = await seedOrigin(page, baseUrl, seed, fontBase64);
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await waitForWritable(page);
  await page.waitForFunction(() => document.documentElement.dataset.duoThemeResolved === 'dark', null, { timeout: 20_000 });

  const archive = await page.evaluateHandle(async () => await window.__duoBackupV4.build('all'));
  await page.evaluate(() => {
    state.appearanceSettings = { mode: 'light', palette: 'rose', background: 'soft', bubbleStyle: 'soft' };
    window.DuoAppearance.apply(true);
  });
  await page.waitForFunction(() => document.documentElement.dataset.duoThemeResolved === 'light' && document.documentElement.dataset.duoPalette === 'rose');
  await page.evaluate(async blob => { await window.__duoBackupV4.restore(blob); }, archive);
  const restored = await page.evaluate(() => ({
    mode: state.appearanceSettings?.mode,
    palette: state.appearanceSettings?.palette,
    resolved: document.documentElement.dataset.duoThemeResolved,
    rootMode: document.documentElement.dataset.duoThemeMode,
    colorScheme: document.documentElement.style.colorScheme,
    persistedMode: JSON.parse(localStorage.getItem('dual_space_app_clean_test_v1') || '{}').appearanceSettings?.mode,
    journal: null
  }));
  const journal = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const r=indexedDB.open('twodeers-recovery-journal-v1',1); r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error); });
    const value = await new Promise((resolve,reject)=>{const tx=db.transaction('recovery','readonly');const req=tx.objectStore('recovery').get('v4-restore-active');req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error);});
    db.close(); return value;
  });
  assert.equal(restored.mode, 'dark');
  assert.equal(restored.palette, 'ocean');
  assert.equal(restored.resolved, 'dark', 'V4 restore must re-apply the dark theme to the actual document');
  assert.equal(restored.rootMode, 'dark');
  assert.equal(restored.colorScheme, 'dark');
  assert.equal(restored.persistedMode, 'dark');
  assert.equal(journal, null, 'successful V4 restore should clear its durable recovery journal');
  await archive.dispose();
  await context.close();
  return { origin: seeded.origin, restored, journalCleared: journal === null };
}

async function testFontReplacementRollback(browser, baseUrl, fontBase64) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await context.newPage();
  attachGuards(page, 'phase18-font-rollback');
  const seed = createValidSeed();
  seed.main.appearanceSettings = { mode: 'dark', palette: 'forest', background: 'soft', bubbleStyle: 'classic' };
  const seeded = await seedOrigin(page, baseUrl, seed, fontBase64);
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await waitForWritable(page);
  const archive = await page.evaluateHandle(async () => await window.__duoBackupV4.build('all'));

  const before = await page.evaluate(async fontBase64 => {
    const bytes = Uint8Array.from(atob(fontBase64), ch => ch.charCodeAt(0));
    const blob = new Blob([bytes], { type: 'font/ttf' });
    await window.ChuanXunFontManager.importData({ currentFontId: 'phase18_alt_font', fonts: [{ id: 'phase18_alt_font', name: 'Phase 18 Alternate', fileName: 'phase18-alt.ttf', format: 'ttf', mimeType: 'font/ttf', size: blob.size, blob, createdAt: 1_798_000_000_100 }] }, { replace: true });
    state.appearanceSettings = { mode: 'light', palette: 'cream', background: 'plain', bubbleStyle: 'flat' };
    window.DuoAppearance.apply(true);
    return localStorage.getItem('dual_space_app_clean_test_v1');
  }, fontBase64);

  await page.evaluate(() => {
    const api = window.ChuanXunFontManager;
    const original = api.importData.bind(api);
    window.__phase18FontImportOriginal = original;
    window.__phase18FontImportFailOnce = true;
    api.importData = async function (payload, options) {
      const result = await original(payload, options);
      if (window.__phase18FontImportFailOnce) {
        window.__phase18FontImportFailOnce = false;
        throw new Error('phase18-injected-font-post-write-failure');
      }
      return result;
    };
  });
  const result = await page.evaluate(async blob => {
    try { await window.__duoBackupV4.restore(blob); return { rejected: false, message: '' }; }
    catch (error) { return { rejected: true, message: error?.message || String(error) }; }
  }, archive);
  assert.equal(result.rejected, true, 'injected font failure must reject V4 restore');
  assert.match(result.message, /phase18-injected-font-post-write-failure/);
  const after = await page.evaluate(async () => {
    const fonts = await window.ChuanXunFontManager.exportData();
    const journal = await window.__duoRuntimeCoordinator.readRecoveryJournal();
    return {
      storage: localStorage.getItem('dual_space_app_clean_test_v1'),
      currentFontId: fonts.currentFontId,
      fontIds: fonts.fonts.map(item => item.id),
      resolved: document.documentElement.dataset.duoThemeResolved,
      mode: state.appearanceSettings?.mode,
      palette: state.appearanceSettings?.palette,
      journal
    };
  });
  assert.equal(after.storage, before, 'failed restore must restore exact pre-restore main storage bytes');
  assert.equal(after.currentFontId, 'phase18_alt_font', 'font rollback must restore the previously active font');
  assert.deepEqual(after.fontIds, ['phase18_alt_font']);
  assert.equal(after.resolved, 'light', 'theme must reflect the pre-restore state after rollback');
  assert.equal(after.mode, 'light');
  assert.equal(after.palette, 'cream');
  assert.equal(after.journal, null, 'successful rollback should clear the prepared recovery journal');
  await archive.dispose();
  await context.close();
  return { origin: seeded.origin, error: result.message, restoredFontId: after.currentFontId, theme: after.resolved, journalCleared: after.journal === null };
}

async function testMultiTabHandoff(browser, baseUrl) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const first = await context.newPage();
  attachGuards(first, 'phase18-multi-tab-first');
  const seed = createValidSeed();
  const seeded = await seedOrigin(first, baseUrl, seed, null);
  await first.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await waitForWritable(first);
  await first.evaluate(() => { window.goto('chatPage'); });
  await first.locator('#chatInput').fill('第十八阶段标签页 A 已提交');
  await first.locator('#sendBtn').click();
  await first.waitForFunction(() => document.querySelector('#chatList')?.textContent.includes('第十八阶段标签页 A 已提交') === true);

  const second = await context.newPage();
  attachGuards(second, 'phase18-multi-tab-second');
  await second.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await second.waitForFunction(() => !!window.__duoRuntimeCoordinator?.getStatus?.().ready, null, { timeout: 45_000 });
  await second.waitForFunction(() => window.__duoRuntimeCoordinator?.isWritable?.() === true && window.__duoRuntimeCoordinator?.getStatus?.().startupComplete === true, null, { timeout: 60_000 });
  await first.waitForFunction(() => window.__duoRuntimeCoordinator?.isWritable?.() === false, null, { timeout: 30_000 });
  const visibleLatest = await second.evaluate(() => document.querySelector('#chatList')?.textContent.includes('第十八阶段标签页 A 已提交') === true);
  assert.equal(visibleLatest, true, 'second tab must load the first tab committed state');
  await second.evaluate(() => window.goto('chatPage'));
  await second.locator('#chatInput').fill('第十八阶段标签页 B 已提交');
  await second.locator('#sendBtn').click();
  await second.waitForFunction(() => document.querySelector('#chatList')?.textContent.includes('第十八阶段标签页 B 已提交') === true);
  await second.close();
  await first.bringToFront();
  await first.waitForFunction(() => window.__duoRuntimeCoordinator?.getStatus?.().promotionAvailable === true && window.__duoRuntimeCoordinator?.isWritable?.() === false, null, { timeout: 30_000 });
  const blockedWrite = await first.evaluate(() => {
    try { window.__duoRuntimeCoordinator.assertWritable('phase18 stale tab test'); return false; }
    catch (_) { return true; }
  });
  assert.equal(blockedWrite, true, 'stale tab must not write before reload');
  await first.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await waitForWritable(first);
  const afterReload = await first.evaluate(() => ({
    a: document.querySelector('#chatList')?.textContent.includes('第十八阶段标签页 A 已提交') === true,
    b: document.querySelector('#chatList')?.textContent.includes('第十八阶段标签页 B 已提交') === true,
    writable: window.__duoRuntimeCoordinator.isWritable()
  }));
  assert.deepEqual(afterReload, { a: true, b: true, writable: true });
  await context.close();
  return { origin: seeded.origin, firstAndSecondCommitsVisible: true, staleWriterBlockedUntilReload: true };
}

function spawnWorker(mode, profile, baseUrl) {
  const child = spawn(process.execPath, [WORKER, mode, profile, baseUrl], {
    cwd: ROOT, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], env: process.env
  });
  let stdout = '', stderr = '';
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  let closeInfo = null;
  const closePromise = new Promise(resolve => {
    child.once('close', (code, signal) => {
      closeInfo = { code, signal };
      resolve(closeInfo);
    });
  });
  return { child, closePromise, get closeInfo() { return closeInfo; }, get stdout() { return stdout; }, get stderr() { return stderr; } };
}

async function waitForWorkerLine(worker, marker, timeoutMs = 90_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (worker.stdout.includes(marker)) return;
    if (worker.child.exitCode !== null || worker.child.signalCode !== null) throw new Error(`worker exited before ${marker}; exitCode=${worker.child.exitCode}; signal=${worker.child.signalCode}; stdout=${worker.stdout}; stderr=${worker.stderr}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`worker timeout waiting for ${marker}; stdout=${worker.stdout}; stderr=${worker.stderr}`);
}

async function waitWorkerClose(worker, timeoutMs = 15_000) {
  if (worker.closeInfo) return worker.closeInfo;
  let timer;
  try {
    return await Promise.race([
      worker.closePromise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`worker process did not close; stdout=${worker.stdout}; stderr=${worker.stderr}`)), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function killWorkerProcessGroup(worker) {
  const child = worker.child;
  if (child.exitCode !== null || child.signalCode !== null) throw new Error(`crash seed worker exited unexpectedly: exitCode=${child.exitCode}; signal=${child.signalCode}; ${worker.stdout} ${worker.stderr}`);
  if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
  else child.kill('SIGKILL');
  const closed = await waitWorkerClose(worker, 15_000);
  assert.equal(closed.signal, 'SIGKILL', `seed worker must be forcibly terminated, not exit normally: ${JSON.stringify(closed)}`);
  return closed;
}

async function waitWorkerExit(worker, timeoutMs = 120_000) {
  const closed = await waitWorkerClose(worker, timeoutMs);
  return closed;
}

async function stopWorkerGroup(worker) {
  if (!worker?.child) return;
  // A worker leader can exit while its Chromium descendant still owns the
  // inherited stdio pipes and the persistent profile. On POSIX, terminate the
  // process group until the ChildProcess close event confirms all pipes closed.
  if (!worker.closeInfo && worker.child.pid) {
    try {
      if (process.platform !== 'win32') process.kill(-worker.child.pid, 'SIGKILL');
      else if (worker.child.exitCode === null && worker.child.signalCode === null) worker.child.kill('SIGKILL');
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
  }
  if (!worker.closeInfo) await waitWorkerClose(worker, 15_000);
}

async function testForcedProcessTerminationRecovery(baseUrl) {
  if (process.platform === 'win32') return { skipped: true, reason: 'process-group kill rehearsal is configured for Linux CI only' };
  const profile = await mkdtemp(path.join(os.tmpdir(), 'twodeers-phase18-crash-'));
  let seedWorker, verifyWorker;
  try {
    seedWorker = spawnWorker('seed-crash', profile, baseUrl);
    await waitForWorkerLine(seedWorker, 'PHASE18_CRASH_READY');
    await killWorkerProcessGroup(seedWorker);
    const killed = await waitWorkerExit(seedWorker);
    assert.equal(killed.signal, 'SIGKILL', `seed worker process group must end with SIGKILL: ${JSON.stringify(killed)}`);
    verifyWorker = spawnWorker('verify-recovery', profile, baseUrl);
    await waitForWorkerLine(verifyWorker, 'PHASE18_CRASH_RECOVERY_PASS');
    const exit = await waitWorkerExit(verifyWorker);
    assert.equal(exit.code, 0, `crash recovery verifier failed: ${JSON.stringify(exit)} ${verifyWorker.stdout} ${verifyWorker.stderr}`);
    assert.equal(exit.signal, null, 'recovery verifier must exit normally after completing assertions');
    return { forcedKill: true, preparedJournalRecovered: true, profileReused: true, output: verifyWorker.stdout.trim() };
  } finally {
    await Promise.all([stopWorkerGroup(seedWorker), stopWorkerGroup(verifyWorker)]);
    await rm(profile, { recursive: true, force: true });
  }
}

async function main() {
  const { server, url } = await startStaticServer();
  let browser;
  try {
    const fontBase64 = await findFontBase64();
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const theme = await testV4ThemeRestore(browser, url, fontBase64);
    const fontRollback = await testFontReplacementRollback(browser, url, fontBase64);
    const multiTab = await testMultiTabHandoff(browser, url);
    const crashRecovery = await testForcedProcessTerminationRecovery(url);
    assert.equal(errors.filter(item => item.type === 'pageerror').length, 0, JSON.stringify(errors, null, 2));
    assert.equal(errors.filter(item => item.type === 'external-request').length, 0, 'phase18 isolation must not contact external origins');
    console.log('PASS: V4 theme restoration, post-write font failure rollback, stale multi-tab writer handoff, and forced Chromium process termination with durable PREPARED-journal startup recovery.');
    console.log(JSON.stringify({ theme, fontRollback, multiTab, crashRecovery, pageErrors: errors.filter(item => item.type === 'pageerror').length, externalRequests: 0 }, null, 2));
  } finally {
    try { await browser?.close(); } catch {}
    await new Promise(resolve => server.close(resolve));
  }
}

await main();
