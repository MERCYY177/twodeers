import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE_KEY = 'dual_space_app_clean_test_v1';
const errors = [];
const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav'
};

function startStaticServer() {
  const root = path.resolve(ROOT);
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://127.0.0.1');
      const decoded = decodeURIComponent(url.pathname);
      let target = path.resolve(root, '.' + decoded);
      if (target !== root && !target.startsWith(root + path.sep)) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      let info = await stat(target);
      if (info.isDirectory()) {
        target = path.join(target, 'index.html');
        info = await stat(target);
      }
      if (!info.isFile()) {
        response.writeHead(404).end('Not found');
        return;
      }
      response.writeHead(200, {
        'content-type': mimeTypes[path.extname(target).toLowerCase()] || 'application/octet-stream',
        'content-length': info.size,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff'
      });
      createReadStream(target).pipe(response);
    } catch (error) {
      response.writeHead(error?.code === 'ENOENT' ? 404 : 500).end('Unable to serve file');
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, url: `http://127.0.0.1:${address.port}/index.html` });
    });
  });
}

async function attachPageGuards(page) {
  page.on('pageerror', error => errors.push({ type: 'pageerror', message: error.message }));
  page.on('console', message => {
    if (message.type() === 'error') errors.push({ type: 'console', message: message.text() });
  });
  await page.route('https://**/*', route => route.abort());
}

async function waitForRuntime(page, writable) {
  await page.waitForFunction(() => {
    const coordinator = window.__duoRuntimeCoordinator;
    return !!coordinator && coordinator.getStatus?.().ready === true;
  }, null, { timeout: 45_000 });
  if (writable) {
    await page.waitForFunction(() => {
      const coordinator = window.__duoRuntimeCoordinator;
      return !!coordinator?.isWritable?.() && coordinator.getStatus?.().startupComplete === true;
    }, null, { timeout: 60_000 });
  } else {
    await page.waitForFunction(() => {
      const coordinator = window.__duoRuntimeCoordinator;
      return !!coordinator && coordinator.getStatus?.().ready === true;
    }, null, { timeout: 45_000 });
  }
}

async function freePort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', resolve);
  });
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}

function childExited(child) { return !!child && (child.exitCode !== null || child.signalCode !== null); }

async function waitForCdp(port, child) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < 30_000) {
    if (childExited(child)) throw new Error(`Chromium exited before CDP became available (${child.exitCode ?? child.signalCode})`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1_500) });
      if (response.ok) return await response.json();
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Chromium CDP did not become ready: ${lastError?.message || 'timeout'}`);
}

function signalCrashProcessGroup(child) {
  if (!child?.pid) return false;
  try {
    // Chromium descendants can outlive the leader. On POSIX always signal the
    // detached process group, even when Node has already observed leader exit.
    if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
    else if (!childExited(child)) child.kill('SIGKILL');
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

async function waitForCrashProcessGroupExit(pid, timeoutMs = 15_000) {
  if (process.platform === 'win32') return true;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { process.kill(-pid, 0); }
    catch (error) {
      if (error?.code === 'ESRCH') return true;
      throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 75));
  }
  throw new Error('SIGKILL 后 Chromium 进程组仍然存在：' + pid);
}

async function launchCrashBrowser(profileDir) {
  const port = await freePort();
  const executable = chromium.executablePath();
  const child = spawn(executable, [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking',
    '--disable-extensions', '--disable-component-update', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', '--remote-allow-origins=*',
    `--user-data-dir=${profileDir}`, 'about:blank'
  ], { detached: process.platform !== 'win32', stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr?.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-8_000); });
  const endpoint = await waitForCdp(port, child).catch(async error => {
    try { await killProcessGroup(child); } catch (cleanupError) { error.cleanupError = cleanupError?.message || String(cleanupError); }
    throw new Error(error.message + '\\n' + stderr);
  });
  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:' + port);
    return { browser, child, port, endpoint, stderr: () => stderr };
  } catch (error) {
    await killProcessGroup(child);
    throw error;
  }
}

async function killProcessGroup(child) {
  if (!child?.pid) return;
  signalCrashProcessGroup(child);
  if (process.platform !== 'win32') {
    // The leader's exit event is not proof that renderer/utility children are gone.
    await waitForCrashProcessGroupExit(child.pid);
    return;
  }
  if (!childExited(child)) {
    await Promise.race([
      new Promise(resolve => child.once('close', resolve)),
      new Promise(resolve => setTimeout(resolve, 8_000))
    ]);
  }
  if (!childExited(child)) throw new Error('Chromium Windows 进程未能退出');
}

async function closeCrashBrowser(session) {
  if (!session) return;
  try { await session.browser.close(); } catch {}
  // Always verify the whole process group, even if the browser leader exited.
  await killProcessGroup(session.child);
}

async function testMultiTab(baseUrl) {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const first = await context.newPage();
    await attachPageGuards(first);
    await first.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitForRuntime(first, true);

    const seeded = await first.evaluate(() => {
      state.chatHistory = Array.isArray(state.chatHistory) ? state.chatHistory : [];
      state.chatHistory.push({ id: 'phase10-multitab-seed', sender: 'me', type: 'text', text: 'phase 10 baseline', time: '00:00', read: false });
      return { saved: save(), lockApi: typeof navigator.locks?.request === 'function', hasIndexedDB: !!window.indexedDB };
    });
    assert.equal(seeded.saved, true, 'the first tab should persist a baseline chat message');
    assert.equal(seeded.hasIndexedDB, true, 'the real browser must expose IndexedDB');

    const second = await context.newPage();
    await attachPageGuards(second);
    await second.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitForRuntime(second, false);

    await Promise.all([
      first.waitForFunction(() => window.__duoRuntimeCoordinator?.getStatus?.().ready === true, null, { timeout: 30_000 }),
      second.waitForFunction(() => window.__duoRuntimeCoordinator?.getStatus?.().ready === true, null, { timeout: 30_000 })
    ]);
    await Promise.race([
      first.waitForFunction(() => window.__duoRuntimeCoordinator?.isWritable?.() === true, null, { timeout: 20_000 }),
      second.waitForFunction(() => window.__duoRuntimeCoordinator?.isWritable?.() === true, null, { timeout: 20_000 })
    ]);
    await new Promise(resolve => setTimeout(resolve, 300));

    const statuses = await Promise.all([first, second].map(page => page.evaluate(() => ({
      writable: window.__duoRuntimeCoordinator?.isWritable?.() === true,
      ready: window.__duoRuntimeCoordinator?.getStatus?.().ready === true,
      startupComplete: window.__duoRuntimeCoordinator?.getStatus?.().startupComplete === true,
      ownerId: window.__duoRuntimeCoordinator?.getStatus?.().ownerId || null,
      visibility: document.visibilityState
    }))));
    const writerIndex = statuses.findIndex(status => status.writable);
    assert.notEqual(writerIndex, -1, `one tab must own the writer lease: ${JSON.stringify(statuses)}`);
    assert.equal(statuses.filter(status => status.writable).length, 1, `exactly one visible tab may write: ${JSON.stringify(statuses)}`);
    const writer = writerIndex === 0 ? first : second;
    const readonly = writerIndex === 0 ? second : first;

    const readonlyAttempt = await readonly.evaluate(() => {
      const before = localStorage.getItem('dual_space_app_clean_test_v1');
      state.__phase10ReadonlyAttempt = 'must-not-persist';
      const saved = save();
      const after = localStorage.getItem('dual_space_app_clean_test_v1');
      return { saved, unchanged: before === after, banner: !!document.querySelector('#duoRuntimeReadonlyBanner') };
    });
    assert.equal(readonlyAttempt.saved, false, 'read-only tab save() must fail closed');
    assert.equal(readonlyAttempt.unchanged, true, 'read-only tab must not change persistent chat state');
    assert.equal(readonlyAttempt.banner, true, 'read-only tab must explain why edits are disabled');

    const shadowClickCount = await readonly.evaluate(() => {
      const host = document.createElement('div');
      host.id = 'phase10-shadow-click-host';
      const root = host.attachShadow({ mode: 'open' });
      const button = document.createElement('button');
      let calls = 0;
      button.textContent = 'forbidden write';
      button.addEventListener('click', () => calls++);
      root.appendChild(button);
      document.body.appendChild(host);
      button.click();
      host.remove();
      return calls;
    });
    assert.equal(shadowClickCount, 0, 'read-only click gate must block a composed Shadow DOM button event');

    const shadowKeyboard = await readonly.evaluate(() => {
      const host = document.createElement('div');
      host.id = 'phase10-shadow-input-host';
      const root = host.attachShadow({ mode: 'open' });
      const input = document.createElement('input');
      input.id = 'phase10-shadow-input';
      host.style.cssText = 'position:fixed;left:8px;top:8px;z-index:2147483647';
      root.appendChild(input);
      document.body.appendChild(host);
      const event = new KeyboardEvent('keydown', { key: 'x', bubbles: true, composed: true, cancelable: true });
      input.dispatchEvent(event);
      host.remove();
      return { defaultPrevented: event.defaultPrevented, composed: event.composed };
    });
    assert.equal(shadowKeyboard.defaultPrevented, true, 'read-only keyboard event inside Shadow DOM must be blocked');

    const writerCommit = await writer.evaluate(() => {
      state.chatHistory.push({ id: 'phase10-multitab-committed', sender: 'me', type: 'text', text: 'committed by the active writer', time: '00:01', read: false });
      return { saved: save(), raw: localStorage.getItem('dual_space_app_clean_test_v1') };
    });
    assert.equal(writerCommit.saved, true, 'active writer should still be able to commit');
    assert.match(writerCommit.raw || '', /phase10-multitab-committed/);

    await writer.close();
    await readonly.bringToFront();
    await readonly.waitForFunction(() => {
      const status = window.__duoRuntimeCoordinator?.getStatus?.();
      return status?.ready === true && status?.promotionAvailable === true && !window.__duoRuntimeCoordinator?.isWritable?.();
    }, null, { timeout: 25_000 });
    await readonly.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitForRuntime(readonly, true);
    const afterHandover = await readonly.evaluate(() => ({
      writable: window.__duoRuntimeCoordinator.isWritable(),
      seed: state.chatHistory.some(item => item.id === 'phase10-multitab-seed'),
      committed: state.chatHistory.some(item => item.id === 'phase10-multitab-committed'),
      forbidden: Object.prototype.hasOwnProperty.call(state, '__phase10ReadonlyAttempt')
    }));
    assert.equal(afterHandover.writable, true, 'reloaded successor tab should acquire writer access');
    assert.equal(afterHandover.seed, true, 'successor must read the previous writer baseline');
    assert.equal(afterHandover.committed, true, 'successor must read the latest committed write');
    assert.equal(afterHandover.forbidden, false, 'failed read-only memory mutation must not leak into the reloaded state');

    return { lockMode: seeded.lockApi ? 'Web Locks API' : 'IndexedDB lease fallback', statuses, readonlyAttempt, shadowClickBlocked: shadowClickCount === 0, shadowKeyboardBlocked: shadowKeyboard.defaultPrevented, successor: afterHandover };
  } finally {
    await browser.close();
  }
}

async function testCrashRecovery(baseUrl) {
  const profileDir = await mkdtemp(path.join(tmpdir(), 'twodeers-phase10-crash-profile-'));
  let session = null;
  try {
    session = await launchCrashBrowser(profileDir);
    let context = session.browser.contexts()[0];
    if (!context) context = await session.browser.newContext();
    let page = await context.newPage();
    await attachPageGuards(page);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitForRuntime(page, true);

    const journalInfo = await page.evaluate(async () => {
      const coordinator = window.__duoRuntimeCoordinator;
      window.__duoCircleApi?.pauseTasks?.();
      window.__duoMailbox?.pauseTasks?.();
      state.incomingCallSettings = { ...(state.incomingCallSettings || {}), enabled: false };
      if (!save()) throw new Error('could not persist initial test state');
      const previous = JSON.parse(JSON.stringify(state));
      previous.__phase10CrashSentinel = 'before-crash';
      const previousSerialized = JSON.stringify(previous);
      const journal = {
        id: coordinator.journalId,
        formatVersion: 1,
        phase: 'prepared',
        createdAt: Date.now(),
        kind: 'phase10-real-browser-crash-test',
        oldState: previousSerialized,
        oldStorage: previousSerialized,
        oldStickerLibrary: null,
        oldCircle: null,
        oldMedia: [],
        oldFonts: null,
        oldMailbox: null,
        oldCards: null,
        oldStorageEntries: []
      };
      await coordinator.saveRecoveryJournal(journal);
      state.__phase10CrashSentinel = 'after-crash';
      if (!save()) throw new Error('could not persist post-journal state');
      const stored = JSON.parse(localStorage.getItem('dual_space_app_clean_test_v1'));
      const persistedJournal = await coordinator.readRecoveryJournal();
      return { storedMarker: stored.__phase10CrashSentinel, journalPhase: persistedJournal?.phase || null, journalBytes: new Blob([JSON.stringify(persistedJournal)]).size };
    });
    assert.equal(journalInfo.storedMarker, 'after-crash', 'the post-journal mutation must be persisted before terminating Chromium');
    assert.equal(journalInfo.journalPhase, 'prepared', 'prepared recovery journal must be durable in IndexedDB');

    await killProcessGroup(session.child);
    session = null;

    session = await launchCrashBrowser(profileDir);
    context = session.browser.contexts()[0];
    if (!context) context = await session.browser.newContext();
    page = await context.newPage();
    await attachPageGuards(page);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitForRuntime(page, true);

    const recovered = await page.evaluate(async () => ({
      memoryMarker: state.__phase10CrashSentinel || null,
      persistedMarker: JSON.parse(localStorage.getItem('dual_space_app_clean_test_v1') || 'null')?.__phase10CrashSentinel || null,
      journal: await window.__duoRuntimeCoordinator.readRecoveryJournal(),
      writable: window.__duoRuntimeCoordinator.isWritable(),
      blocked: window.__duoRuntimeCoordinator.getStatus().blocked
    }));
    assert.equal(recovered.memoryMarker, 'before-crash', 'startup must roll the main in-memory state back to the prepared snapshot after a real browser process kill');
    assert.equal(recovered.persistedMarker, 'before-crash', 'startup must restore persistent localStorage after a real browser process kill');
    assert.equal(recovered.journal, null, 'recovery journal should be cleared only after startup rollback and readback succeed');
    assert.equal(recovered.writable, true, 'writer access should reopen after successful crash recovery');
    assert.equal(recovered.blocked, false);

    const storage = await page.evaluate(async () => ({
      estimate: await window.__duoRuntimeCoordinator.estimateStorage(),
      idb: typeof indexedDB.open === 'function',
      locks: typeof navigator.locks?.request === 'function'
    }));
    assert.equal(storage.idb, true, 'IndexedDB must remain available after browser restart');
    assert.equal(storage.estimate.supported, true, 'real browser storage estimate should be queryable');

    const blockedUi = await page.evaluate(() => {
      window.__duoRuntimeCoordinator.setRecoveryBlocked(new Error('phase 10 permanent-lock UI test'));
      const host = document.createElement('div');
      const shadow = host.attachShadow({ mode: 'open' });
      const button = document.createElement('button');
      const input = document.createElement('input');
      let clicks = 0;
      button.addEventListener('click', () => clicks++);
      shadow.append(button, input);
      document.body.appendChild(host);
      const clickEvent = new MouseEvent('click', { bubbles: true, composed: true, cancelable: true });
      button.dispatchEvent(clickEvent);
      const keyEvent = new KeyboardEvent('keydown', { key: 'x', bubbles: true, composed: true, cancelable: true });
      input.dispatchEvent(keyEvent);
      host.remove();
      return {
        blocked: window.__duoRuntimeCoordinator.getStatus().blocked,
        writable: window.__duoRuntimeCoordinator.isWritable(),
        clickPrevented: clickEvent.defaultPrevented,
        keyPrevented: keyEvent.defaultPrevented,
        clickHandlerCalls: clicks
      };
    });
    assert.equal(blockedUi.blocked, true);
    assert.equal(blockedUi.writable, false);
    assert.equal(blockedUi.clickPrevented, true, 'permanent recovery lock must block Shadow DOM clicks');
    assert.equal(blockedUi.keyPrevented, true, 'permanent recovery lock must block Shadow DOM keyboard edits');
    assert.equal(blockedUi.clickHandlerCalls, 0);
    return { journalBytes: journalInfo.journalBytes, recovered, storage, blockedUi };
  } finally {
    await closeCrashBrowser(session);
    await rm(profileDir, { recursive: true, force: true });
  }
}

let serverSession = null;
try {
  serverSession = await startStaticServer();
  const multiTab = await testMultiTab(serverSession.url);
  const crashRecovery = await testCrashRecovery(serverSession.url);
  const fatalPageErrors = errors.filter(error => error.type === 'pageerror');
  assert.equal(fatalPageErrors.length, 0, `uncaught browser page errors: ${JSON.stringify(fatalPageErrors)}`);
  const report = {
    browser: 'Playwright Chromium',
    url: serverSession.url,
    tests: { multiTab, crashRecovery },
    uncaughtPageErrors: fatalPageErrors,
    consoleErrors: errors.filter(error => error.type === 'console')
  };
  console.log('PASS: real Chromium multi-tab single-writer, readonly DOM/Shadow DOM gate, reload-to-promote, abrupt process termination, persistent IndexedDB recovery journal, startup rollback, and storage diagnostics.');
  console.log(JSON.stringify(report, null, 2));
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    const { appendFile } = await import('node:fs/promises');
    await appendFile(summaryPath, `\n## Twodeers browser runtime E2E\n\n- Browser: ${report.browser}\n- Multi-tab lock: passed (${multiTab.lockMode})\n- Reload handover: passed\n- Shadow DOM write gate: passed\n- Forced process termination and durable recovery: passed\n- Uncaught page errors: ${fatalPageErrors.length}\n`);
  }
} catch (error) {
  console.error('FAIL: browser runtime E2E:', error?.stack || error);
  if (errors.length) console.error('Browser diagnostics:', JSON.stringify(errors, null, 2));
  process.exitCode = 1;
} finally {
  if (serverSession) await new Promise(resolve => serverSession.server.close(resolve));
}
