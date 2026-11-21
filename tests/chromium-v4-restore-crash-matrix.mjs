import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { access, cp, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createValidSeed } from './isolated-application-fixtures.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECKPOINT_KEY = '__twodeers_phase31_crash_checkpoint_v1';
const CHECKPOINT_DETAIL_KEY = '__twodeers_phase31_crash_checkpoint_detail_v1';
const PHASE31_BINDING = '__twodeersPhase31TransactionCheckpoint';
const MEDIA_IDS = ['phase17-chat-media','phase17-sticker-media','phase17-mail-media','phase17-circle-avatar','phase17-circle-cover','phase17-circle-post-media'];
const SOURCE_MEDIA_BYTE_LIST = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 144, 213, 52, 253, 15, 0, 2, 93, 1, 123, 120, 1, 10, 254, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130];
const SOURCE_MEDIA_BYTES = Uint8Array.from(SOURCE_MEDIA_BYTE_LIST);
const SOURCE_MEDIA_BASE64 = Buffer.from(SOURCE_MEDIA_BYTES).toString('base64');
const TARGET_MEDIA_BASE64 = Buffer.from(createValidSeed().pngBase64, 'base64').toString('base64');
const errors = [];

function mimeFor(file) {
  const ext = path.extname(file).toLowerCase();
  return ({ '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.otf':'font/otf' })[ext] || 'application/octet-stream';
}

function startStaticServer() {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://127.0.0.1');
      if (url.pathname === '/__phase31_seed__') {
        response.writeHead(200, { 'content-type':'text/html; charset=utf-8', 'cache-control':'no-store' });
        response.end('<!doctype html><html><head><meta charset="utf-8"></head><body>Phase 32 isolated Chromium origin</body></html>');
        return;
      }
      const decoded = decodeURIComponent(url.pathname);
      let target = path.resolve(ROOT, '.' + decoded);
      if (target !== ROOT && !target.startsWith(ROOT + path.sep)) { response.writeHead(403).end('Forbidden'); return; }
      let info = await stat(target);
      if (info.isDirectory()) { target = path.join(target, 'index.html'); info = await stat(target); }
      if (!info.isFile()) { response.writeHead(404).end('Not found'); return; }
      response.writeHead(200, { 'content-type':mimeFor(target), 'content-length':info.size, 'cache-control':'no-store', 'x-content-type-options':'nosniff' });
      createReadStream(target).pipe(response);
    } catch (error) {
      response.writeHead(error?.code === 'ENOENT' ? 404 : 500).end('Unable to serve file');
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, url:`http://127.0.0.1:${server.address().port}/index.html` }));
  });
}

async function findChromium() {
  const candidates = [process.env.TWODEERS_CHROMIUM_PATH];
  try {
    const playwright = await import('playwright');
    candidates.push(playwright.chromium.executablePath());
  } catch {}
  candidates.push('/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome','/opt/google/chrome/chrome');
  for (const candidate of candidates.filter(Boolean)) {
    try { await access(candidate); return candidate; } catch {}
  }
  const which = spawnSync('sh', ['-lc','command -v chromium || command -v chromium-browser || command -v google-chrome'], { encoding:'utf8' });
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim().split(/\r?\n/)[0];
  throw new Error('未找到 Chromium。请设置 TWODEERS_CHROMIUM_PATH，或在 CI 中先安装 Chromium。');
}

class CdpPage {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    this.events = new Map();
    this.externalRequests = [];
    this.pageErrors = [];
    socket.addEventListener('message', event => {
      let packet;
      try { packet = JSON.parse(String(event.data)); } catch { return; }
      if (packet.id && this.pending.has(packet.id)) {
        const item = this.pending.get(packet.id);
        this.pending.delete(packet.id);
        clearTimeout(item.timer);
        if (packet.error) item.reject(new Error(`${item.method}: ${packet.error.message || JSON.stringify(packet.error)}`));
        else item.resolve(packet.result || {});
        return;
      }
      if (packet.method === 'Network.requestWillBeSent') {
        const url = packet.params?.request?.url || '';
        if (/^https?:\/\//i.test(url) && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(url)) this.externalRequests.push(url);
      }
      if (packet.method === 'Runtime.exceptionThrown') this.pageErrors.push(packet.params?.exceptionDetails?.text || 'unknown page exception');
      for (const fn of this.events.get(packet.method) || []) fn(packet.params || {});
    });
    socket.addEventListener('close', () => {
      for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error('Chromium DevTools websocket closed')); }
      this.pending.clear();
    });
  }
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once:true });
      socket.addEventListener('error', () => reject(new Error('无法连接 Chromium DevTools websocket')), { once:true });
    });
    return new CdpPage(socket);
  }
  on(method, fn) {
    const list = this.events.get(method) || [];
    list.push(fn); this.events.set(method, list);
  }
  send(method, params = {}, timeoutMs = 30_000) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression, options = {}) {
    const response = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: options.awaitPromise !== false,
      returnByValue: true,
      userGesture: true,
      timeout: options.timeoutMs || 30_000
    }, options.timeoutMs || 35_000);
    if (response.exceptionDetails) {
      const detail = response.exceptionDetails;
      throw new Error(`浏览器执行异常：${JSON.stringify({text:detail.text,description:detail.exception?.description,stack:detail.exception?.description,details:detail})}`);
    }
    if (response.result?.subtype === 'error') throw new Error(response.result.description || '浏览器返回错误对象');
    return response.result?.value;
  }
  async navigate(url) {
    const navigation = await this.send('Page.navigate', { url }, 30_000);
    if (navigation.errorText) throw new Error(`Chromium 拒绝导航 ${url}：${navigation.errorText}`);
    const expected = new URL(url).href;
    await this.waitFor(async () => await this.evaluate(`location.href===${JSON.stringify(expected)} && document.readyState==='complete'`).catch(() => false), 60_000, `页面加载完成 ${expected}`);
  }
  async waitFor(check, timeoutMs, label) {
    const start = Date.now(); let last;
    while (Date.now() - start < timeoutMs) {
      try { last = await check(); if (last) return last; } catch {}
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    throw new Error(`等待${label}超时；最后状态：${JSON.stringify(last)}`);
  }
  close() { try { this.socket.close(); } catch {} }
}

async function waitForFile(file, timeoutMs = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const text = await readFile(file, 'utf8'); if (text.trim()) return text; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Chromium 未生成 DevToolsActivePort：${file}`);
}

async function writeJsonAtomic(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2));
  await rename(temporary, file);
}

async function preserveFailedProfile(profile, artifactDir, stage) {
  const preserved = path.join(path.resolve(artifactDir), 'failed-profiles', stage);
  await mkdir(path.dirname(preserved), { recursive:true });
  await rm(preserved, { recursive:true, force:true });
  await cp(profile, preserved, { recursive:true, force:true });
  return path.relative(ROOT, preserved);
}

function signalChromeProcessGroup(child) {
  if (!child?.pid) return false;
  try {
    // On POSIX the process group can outlive Chromium's leader. Always signal
    // the group, even if child.exitCode/signalCode already indicates exit.
    if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
    else if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

async function terminateChromeProcessGroup(child, closePromise, page = null) {
  page?.close();
  signalChromeProcessGroup(child);
  let closeTimer;
  let close;
  try {
    close = await Promise.race([
      closePromise,
      new Promise((_, reject) => { closeTimer = setTimeout(() => reject(new Error('关闭 Chromium 后进程组仍未结束')), 15_000); })
    ]);
  } finally {
    if (closeTimer) clearTimeout(closeTimer);
  }
  if (process.platform !== 'win32' && child?.pid) await waitForProcessGroupExit(child.pid);
  return close;
}

async function launchChrome(binary, profile) {
  const child = spawn(binary, [
    '--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--disable-component-update',
    '--disable-default-apps','--disable-extensions','--no-first-run','--no-default-browser-check','--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'
  ], { detached:process.platform !== 'win32', stdio:'ignore' });
  let closeInfo = null;
  const closePromise = new Promise(resolve => child.once('close', (code, signal) => { closeInfo = { code, signal }; resolve(closeInfo); }));
  let page = null;
  try {
    const activePortText = await waitForFile(path.join(profile, 'DevToolsActivePort'));
    const port = Number(activePortText.split(/\r?\n/)[0]);
    assert.ok(Number.isInteger(port) && port > 0, 'Chromium debug port must be valid');
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const pageTarget = targets.find(item => item.type === 'page' && item.webSocketDebuggerUrl);
    assert.ok(pageTarget, 'Chromium must expose an initial page target');
    page = await CdpPage.connect(pageTarget.webSocketDebuggerUrl);
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Network.enable');
    return { child, closePromise, get closeInfo() { return closeInfo; }, page, port };
  } catch (error) {
    try { await terminateChromeProcessGroup(child, closePromise, page); }
    catch (cleanupError) {
      error.cleanupError = cleanupError?.stack || String(cleanupError);
      // The caller must retain the process handles so the shared failure
      // finalizer can retry shutdown instead of assuming no session means closed.
      error.browserSession = { child, closePromise, get closeInfo() { return closeInfo; }, page, port: null };
    }
    throw error;
  }
}

async function waitForProcessGroupExit(pid, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { process.kill(-pid, 0); }
    catch (error) { if (error?.code === 'ESRCH') return true; throw error; }
    await new Promise(resolve => setTimeout(resolve, 75));
  }
  throw new Error(`SIGKILL 后 Chromium 进程组仍然存在：${pid}`);
}

async function killChrome(session) {
  session.page.close();
  const child = session.child;
  // The leader's close event does not prove all Chromium descendants exited.
  signalChromeProcessGroup(child);
  const close = session.closeInfo || await Promise.race([
    session.closePromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('强制终止 Chromium 后进程组未能关闭')), 15_000))
  ]);
  assert.equal(close.signal, 'SIGKILL', `Chromium 必须被 SIGKILL 终止：${JSON.stringify(close)}`);
  await waitForProcessGroupExit(child.pid);
  return { ...close, processGroupGone:true };
}

async function stopChrome(session) {
  if (!session) return;
  await terminateChromeProcessGroup(session.child, session.closePromise, session.page);
}

async function finalizeFailedRunCase({ session, stopChromeFn, profile, artifactDir, stage, profileMayContainTestData, preserveFailedProfileFn }) {
  let activeSession = session || null;
  let browserStopped = !activeSession;
  const cleanupErrors = [];

  // The first SIGKILL can race with Chromium descendant teardown. Retry once
  // before deciding whether it is safe to copy or remove a failed profile.
  for (let attempt = 0; activeSession && attempt < 2; attempt += 1) {
    try {
      await stopChromeFn(activeSession);
      activeSession = null;
      browserStopped = true;
    } catch (error) {
      cleanupErrors.push(error?.stack || String(error));
    }
  }

  let failedProfileArtifactPath = null;
  let profilePreservationError = null;
  let preserveProfile = false;
  if (browserStopped && artifactDir && profileMayContainTestData) {
    try {
      failedProfileArtifactPath = await preserveFailedProfileFn(profile, artifactDir, stage);
      // The artifact copy now owns the forensic evidence; the temporary source
      // profile should be removed by runCase's finally block after the copy.
      preserveProfile = false;
    } catch (error) {
      // Keep the only local copy if artifact preservation itself failed.
      preserveProfile = true;
      profilePreservationError = error?.stack || String(error);
    }
  } else if (!browserStopped) {
    preserveProfile = true;
    profilePreservationError = 'Chromium process group remained alive after two cleanup attempts; the profile was left in place and was not copied because its contents may still be changing.';
  }

  return {
    session: activeSession,
    browserStopped,
    preserveProfile,
    failedProfileArtifactPath,
    profileRetainedPath: preserveProfile ? path.relative(ROOT, profile) : null,
    cleanupError: cleanupErrors.length ? cleanupErrors.join('\n--- cleanup retry ---\n') : null,
    profilePreservationError
  };
}

async function waitWritable(page) {
  const status = await page.waitFor(async () => {
    const s = await page.evaluate('window.__duoRuntimeCoordinator?.getStatus?.() || null');
    return s && (s.startupComplete === true || s.blocked === true) ? s : null;
  }, 90_000, '启动恢复完成或明确报告恢复阻断');
  assert.equal(status.blocked, false, `启动恢复不得锁定页面：${status.reason || ''}`);
  assert.equal(await page.evaluate('window.__duoRuntimeCoordinator?.isWritable?.() === true'), true, '启动恢复完成后必须重新获得写入权');
  return status;
}

function buildSeedScript(seed, fontBase64) {
  const packed = Buffer.from(JSON.stringify({ seed, fontBase64 })).toString('base64');
  return `(async()=>{
    const {seed,fontBase64}=JSON.parse(atob('${packed}'));
    const openDb=(name,version,stores,keyPaths={})=>new Promise((resolve,reject)=>{
      const req=indexedDB.open(name,version);
      req.onupgradeneeded=()=>{const db=req.result;for(const store of stores)if(!db.objectStoreNames.contains(store))db.createObjectStore(store,{keyPath:keyPaths[store]||'id'});};
      req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error||new Error('seed DB open failed'));req.onblocked=()=>reject(new Error('seed DB blocked'));
    });
    const write=(db,storeName,rows)=>new Promise((resolve,reject)=>{
      const tx=db.transaction(storeName,'readwrite',{durability:'strict'});
      if(tx.durability!=='strict')return reject(new Error('Chromium did not honor strict seed transaction durability'));
      for(const row of rows)tx.objectStore(storeName).put(row);
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error('seed transaction failed'));tx.onabort=()=>reject(tx.error||new Error('seed transaction aborted'));
    });
    localStorage.clear();localStorage.setItem('__twodeers_runtime_revision_v1','0');
    localStorage.setItem('dual_space_app_clean_test_v1',JSON.stringify(seed.main));
    localStorage.setItem('dual_space_sticker_library_v1',JSON.stringify(seed.stickerLibrary));
    localStorage.setItem('twodeers_mailbox_letters_v1',JSON.stringify(seed.mailbox));
    localStorage.setItem('twodeers_card_system_v1',JSON.stringify(seed.cards));
    localStorage.setItem('moments_site_blank_v49_rebuild_baseline_same_layout',JSON.stringify(seed.circle));
    localStorage.setItem('moments_site_blank_v49_rebuild_baseline_same_layout_visitor_backup_step01b',JSON.stringify(seed.visitorBackup));
    const png=Uint8Array.from(atob(seed.pngBase64),c=>c.charCodeAt(0));
    const mediaDb=await openDb('dual_space_chat_media_v1',1,['media']);
    const mediaRows=seed.media.map(row=>({...row,blob:new Blob([png],{type:'image/png'}),size:png.length}));
    await write(mediaDb,'media',mediaRows);mediaDb.close();
    const fontDb=await openDb('chuanxun-local-font-library',1,['fonts','meta'],{meta:'key'});
    const fontBytes=Uint8Array.from(atob(fontBase64),c=>c.charCodeAt(0));
    const fontBlob=new Blob([fontBytes],{type:'font/ttf'});
    await write(fontDb,'fonts',[{id:'phase30-target-font',name:'Phase 30 Target Font',fileName:'phase30-target.ttf',format:'ttf',mimeType:'font/ttf',size:fontBlob.size,blob:fontBlob,createdAt:1798000000000}]);
    await write(fontDb,'meta',[{key:'currentFontId',value:'phase30-target-font',updatedAt:1798000000000}]);fontDb.close();
    return {mediaCount:mediaRows.length,fontSize:fontBlob.size};
  })()`;
}

function mutateSourceScript(sourceFontBase64) {
  return `(async()=>{
    state.chatHistory.push({id:'phase30-source-state',sender:'me',type:'text',text:'Phase 30 pre-restore state',time:'20:29',read:true});
    if(save()===false)throw new Error('source state could not be persisted');
    const circle=window.__duoCircleApi.exportState();
    circle.posts[0].text='Phase 30 pre-restore Circle state';
    window.__duoCircleApi.importState(circle);
    const fontBytes=Uint8Array.from(atob('${sourceFontBase64}'),c=>c.charCodeAt(0));
    const fontBlob=new Blob([fontBytes],{type:'font/ttf'});
    const fontResult=await window.ChuanXunFontManager.importData({currentFontId:'phase30-source-font',fonts:[{id:'phase30-source-font',name:'Phase 30 Source Font',fileName:'phase30-source.ttf',format:'ttf',mimeType:'font/ttf',size:fontBlob.size,blob:fontBlob,createdAt:1798000000100}]},{replace:true});
    if(fontResult===false)throw new Error('source font mutation returned false');
    const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('dual_space_chat_media_v1',1);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('media','readwrite',{durability:'strict'});const store=tx.objectStore('media');const get=store.get('phase17-chat-media');
      get.onsuccess=()=>{const row=get.result;if(!row)throw new Error('source chat media missing');const bytes=Uint8Array.from([${SOURCE_MEDIA_BYTE_LIST.join(',')}]);const blob=new Blob([bytes],{type:'image/png'});store.put({...row,blob,size:blob.size,mimeType:'image/png'});};
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('source media mutation aborted'));
    });db.close();
    window.__duoRuntimeCoordinator.markDataChanged();
    const fontSnapshot=await window.ChuanXunFontManager.exportData();
    return {sourceStateSaved:true,circleText:window.__duoCircleApi.exportState().posts[0].text,fontId:fontSnapshot.currentFontId,fontSize:fontSnapshot.fonts[0]?.size};
  })()`;
}

function installCheckpointScript(stage) {
  const key = JSON.stringify(CHECKPOINT_KEY);
  const detailKey = JSON.stringify(CHECKPOINT_DETAIL_KEY);
  const pause = `async detail=>{localStorage.setItem(${key},${JSON.stringify(stage)});localStorage.setItem(${detailKey},JSON.stringify(detail));window.dispatchEvent(new CustomEvent('phase31-checkpoint',{detail}));await new Promise(()=>{});}`;
  const encodeBlob = `async blob=>{if(!blob)return null;const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary);}`;
  if (stage === 'prepared') return `(async()=>{const c=window.__duoRuntimeCoordinator;const original=c.saveRecoveryJournal;const pause=${pause};const encodeBlob=${encodeBlob};c.saveRecoveryJournal=async function(...args){const result=await original.apply(this,args);if(args[0]?.phase==='prepared'){const j=await c.readRecoveryJournal();const old=JSON.parse(j.oldState);const media=j.oldMedia.find(pair=>pair[0]==='phase17-chat-media')?.[1];const font=j.oldFonts?.fonts?.find(item=>item.id==='phase30-source-font');await pause({stage:'prepared',journalPhase:j.phase,sourceState:old.chatHistory?.some(item=>item.id==='phase30-source-state'&&item.text==='Phase 30 pre-restore state')===true,circleText:j.oldCircle?.posts?.[0]?.text||null,mediaId:'phase17-chat-media',mediaBytes:await encodeBlob(media?.blob),mediaType:media?.blob?.type||null,fontId:j.oldFonts?.currentFontId||null,fontBytes:await encodeBlob(font?.blob)});}return result;};return {installed:true,method:'saveRecoveryJournal'};})()`;
  if (stage === 'media') return `(async()=>{const original=window.putMediaBlob;if(typeof original!=='function')throw new Error('window.putMediaBlob is not exposed for exact production-path interception');let hit=false;const pause=${pause};const encodeBlob=${encodeBlob};window.putMediaBlob=async function(...args){const result=await original.apply(this,args);const id=args[3]||null;if(!hit&&id==='phase17-chat-media'){hit=true;const row=await window.getMediaRecord(id);await pause({stage:'media',mediaId:id,mediaBytes:await encodeBlob(row?.blob),mediaType:row?.blob?.type||null,mediaSize:row?.blob?.size||0});}return result;};return {installed:true,method:'putMediaBlob',requiredMediaId:'phase17-chat-media'};})()`;
  if (stage === 'font') return `(async()=>{const fm=window.ChuanXunFontManager;const original=fm.importData;let hit=false;const pause=${pause};const encodeBlob=${encodeBlob};fm.importData=async function(...args){const result=await original.apply(this,args);if(!hit&&args[1]?.replace===true){hit=true;const snapshot=await fm.exportData();const selected=snapshot.fonts.find(item=>item.id==='phase30-target-font');await pause({stage:'font',currentFontId:snapshot.currentFontId||null,fontIds:snapshot.fonts.map(item=>item.id),fontBytes:await encodeBlob(selected?.blob),fontSize:selected?.size||0});}return result;};return {installed:true,method:'ChuanXunFontManager.importData',requiredFontId:'phase30-target-font'};})()`;
  if (stage === 'committed') return `(async()=>{const c=window.__duoRuntimeCoordinator;const original=c.markRecoveryCommitted;const pause=${pause};const encodeBlob=${encodeBlob};c.markRecoveryCommitted=async function(...args){const result=await original.apply(this,args);const j=await c.readRecoveryJournal();const media=await window.getMediaRecord('phase17-chat-media');const font=await window.ChuanXunFontManager.exportData();const selected=font.fonts.find(item=>item.id==='phase30-target-font');const main=JSON.parse(localStorage.getItem('dual_space_app_clean_test_v1')||'{}');await pause({stage:'committed',journalPhase:j?.phase||null,targetState:main.chatHistory?.some(item=>item.id==='phase17-chat-text'&&item.text==='第十七阶段合成聊天消息')===true,circleText:window.__duoCircleApi.exportState().posts?.[0]?.text||null,mediaId:'phase17-chat-media',mediaBytes:await encodeBlob(media?.blob),mediaType:media?.blob?.type||null,fontId:font.currentFontId||null,fontBytes:await encodeBlob(selected?.blob),fontSize:selected?.size||0});return result;};return {installed:true,method:'markRecoveryCommitted'};})()`;
  if (stage === 'media-inflight') return `(async()=>{const nativePut=IDBObjectStore.prototype.put;const binding=${JSON.stringify(PHASE31_BINDING)};let fired=false;IDBObjectStore.prototype.put=function(...args){const store=this;const request=nativePut.apply(store,args);if(!fired&&store.name==='media'&&args[0]?.id==='phase17-chat-media'){fired=true;request.addEventListener('success',()=>{const probe=store.get('__phase31_keep_transaction_open__');const detail={stage:'media-inflight',storeName:store.name,operation:'put',requestSucceeded:true,transactionMode:store.transaction.mode,transactionDurability:store.transaction.durability,probeQueued:!!probe,mediaId:args[0].id};localStorage.setItem(${key},'media-inflight');localStorage.setItem(${detailKey},JSON.stringify(detail));window.dispatchEvent(new CustomEvent('phase31-checkpoint',{detail}));window[binding](JSON.stringify(detail));const started=performance.now();while(performance.now()-started<120000){};},{once:true});}return request;};return {installed:true,method:'IDBObjectStore.put',databaseStore:'media',mediaId:'phase17-chat-media'};})()`;
  if (stage === 'font-inflight') return `(async()=>{const nativeClear=IDBObjectStore.prototype.clear;const binding=${JSON.stringify(PHASE31_BINDING)};let fired=false;IDBObjectStore.prototype.clear=function(...args){const store=this;const request=nativeClear.apply(store,args);if(!fired&&store.name==='fonts'){fired=true;request.addEventListener('success',()=>{const probe=store.get('__phase31_keep_transaction_open__');const detail={stage:'font-inflight',storeName:store.name,operation:'clear',requestSucceeded:true,transactionMode:store.transaction.mode,transactionDurability:store.transaction.durability,probeQueued:!!probe};localStorage.setItem(${key},'font-inflight');localStorage.setItem(${detailKey},JSON.stringify(detail));window.dispatchEvent(new CustomEvent('phase31-checkpoint',{detail}));window[binding](JSON.stringify(detail));const started=performance.now();while(performance.now()-started<120000){};},{once:true});}return request;};return {installed:true,method:'IDBObjectStore.clear',databaseStore:'fonts'};})()`;
  throw new Error(`unknown checkpoint stage: ${stage}`);
}

async function waitForCheckpoint(page, stage) {
  return page.waitFor(async () => {
    const marker = await page.evaluate(`localStorage.getItem(${JSON.stringify(CHECKPOINT_KEY)})`).catch(() => null);
    return marker === stage ? marker : null;
  }, 90_000, `restore checkpoint ${stage}`);
}

async function inspectJournal(page) {
  return page.evaluate(`(async()=>{const j=await window.__duoRuntimeCoordinator.readRecoveryJournal();return j?{phase:j.phase,kind:j.kind,createdAt:j.createdAt}:null;})()`);
}

async function inspectCheckpointDetail(page) {
  return page.evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(CHECKPOINT_DETAIL_KEY)})||'null')`);
}

function waitForBindingCheckpoint(page, stage, timeoutMs = 90_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`等待 ${stage} 的 IndexedDB 活跃事务 DevTools binding 超时`)), timeoutMs);
    page.on('Runtime.bindingCalled', packet => {
      if (packet?.name !== PHASE31_BINDING) return;
      let detail;
      try { detail = JSON.parse(packet.payload || 'null'); } catch { return; }
      if (detail?.stage !== stage) return;
      clearTimeout(timer);
      resolve(detail);
    });
  });
}

async function inspectPersistedProfileBeforeApp(page) {
  return page.evaluate(`(async()=>{
    const open=async name=>{if(typeof indexedDB.databases!=='function')throw new Error('pre-startup inspection requires indexedDB.databases() to avoid creating missing evidence databases');const known=await indexedDB.databases();if(!known.some(item=>item.name===name))throw new Error('pre-startup evidence database is missing: '+name);return new Promise((resolve,reject)=>{const request=indexedDB.open(name);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||new Error('pre-startup DB open failed: '+name));request.onblocked=()=>reject(new Error('pre-startup DB blocked: '+name));});};
    const readAll=(db,store)=>new Promise((resolve,reject)=>{
      const tx=db.transaction(store,'readonly');const request=tx.objectStore(store).getAll();let rows=null,requestDone=false,settled=false;
      request.onsuccess=()=>{rows=request.result||[];requestDone=true;};
      request.onerror=()=>{if(!settled){settled=true;reject(request.error||new Error('pre-startup read failed: '+store));}};
      tx.oncomplete=()=>{if(settled)return;settled=true;if(!requestDone)reject(new Error('pre-startup read completed without rows: '+store));else resolve(rows);};
      tx.onerror=()=>{if(!settled){settled=true;reject(tx.error||new Error('pre-startup read transaction failed: '+store));}};
      tx.onabort=()=>{if(!settled){settled=true;reject(tx.error||new Error('pre-startup read transaction aborted: '+store));}};
    });
    const readOne=(db,store,key)=>new Promise((resolve,reject)=>{
      const tx=db.transaction(store,'readonly');const request=tx.objectStore(store).get(key);let value=null,requestDone=false,settled=false;
      request.onsuccess=()=>{value=request.result||null;requestDone=true;};
      request.onerror=()=>{if(!settled){settled=true;reject(request.error||new Error('pre-startup read failed: '+store));}};
      tx.oncomplete=()=>{if(settled)return;settled=true;if(!requestDone)reject(new Error('pre-startup read completed without a result: '+store));else resolve(value);};
      tx.onerror=()=>{if(!settled){settled=true;reject(tx.error||new Error('pre-startup read transaction failed: '+store));}};
      tx.onabort=()=>{if(!settled){settled=true;reject(tx.error||new Error('pre-startup read transaction aborted: '+store));}};
    });
    const readFontSnapshot=db=>new Promise((resolve,reject)=>{
      const tx=db.transaction(['fonts','meta'],'readonly');const fontsRequest=tx.objectStore('fonts').getAll();const currentRequest=tx.objectStore('meta').get('currentFontId');
      let fonts=null,current=null,fontsDone=false,currentDone=false,settled=false;
      fontsRequest.onsuccess=()=>{fonts=fontsRequest.result||[];fontsDone=true;};currentRequest.onsuccess=()=>{current=currentRequest.result||null;currentDone=true;};
      const fail=error=>{if(!settled){settled=true;reject(error||new Error('pre-startup font snapshot transaction failed'));}};
      fontsRequest.onerror=()=>fail(fontsRequest.error);currentRequest.onerror=()=>fail(currentRequest.error);
      tx.oncomplete=()=>{if(settled)return;settled=true;if(!fontsDone||!currentDone)reject(new Error('pre-startup font snapshot completed without both request results'));else resolve({fonts,currentFontId:current?.value||null});};
      tx.onerror=()=>fail(tx.error);tx.onabort=()=>fail(tx.error||new Error('pre-startup font snapshot transaction aborted'));
    });
    const encode=async blob=>{if(!blob)return null;const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary);};
    const parseStorage=key=>{const raw=localStorage.getItem(key);if(raw===null)return null;try{return JSON.parse(raw);}catch(error){throw new Error('pre-startup localStorage JSON invalid: '+key+': '+error.message);}};
    const main=parseStorage('dual_space_app_clean_test_v1');
    const circle=parseStorage('moments_site_blank_v49_rebuild_baseline_same_layout');
    const mediaDb=await open('dual_space_chat_media_v1');
    const rawMedia=await readAll(mediaDb,'media');mediaDb.close();
    const mediaRecords=[];
    for(const row of rawMedia){if(${JSON.stringify(MEDIA_IDS)}.includes(row.id))mediaRecords.push({id:row.id,bytes:await encode(row.blob),type:row.blob?.type||null,size:row.blob?.size||0});}
    mediaRecords.sort((a,b)=>${JSON.stringify(MEDIA_IDS)}.indexOf(a.id)-${JSON.stringify(MEDIA_IDS)}.indexOf(b.id));
    const fontDb=await open('chuanxun-local-font-library');
    const fontSnapshot=await readFontSnapshot(fontDb);fontDb.close();
    const fontFiles=[];for(const item of fontSnapshot.fonts||[])fontFiles.push({id:item.id,size:item.size,bytes:await encode(item.blob)});
    const journalDb=await open('twodeers-recovery-journal-v1');
    const journal=await readOne(journalDb,'recovery','v4-restore-active');journalDb.close();
    const journalOldState=journal?.oldState?JSON.parse(journal.oldState):null;
    const journalOldMedia=journal?.oldMedia?.find(pair=>pair[0]==='phase17-chat-media')?.[1]||null;
    const journalOldFont=journal?.oldFonts?.fonts?.find(item=>item.id==='phase30-source-font')||null;
    return {
      journalPhase:journal?.phase||null,
      journalOldStateSource:journalOldState?.chatHistory?.some(item=>item.id==='phase30-source-state'&&item.text==='Phase 30 pre-restore state')===true,
      journalOldCircleText:journal?.oldCircle?.posts?.[0]?.text||null,
      journalOldMediaBytes:await encode(journalOldMedia?.blob),
      journalOldFontId:journalOldFont?.id||null,
      journalOldFontBytes:await encode(journalOldFont?.blob),
      sourceState:main?.chatHistory?.some(item=>item.id==='phase30-source-state'&&item.text==='Phase 30 pre-restore state')===true,
      targetState:main?.chatHistory?.some(item=>item.id==='phase17-chat-text'&&item.text==='第十七阶段合成聊天消息')===true&&main?.chatHistory?.some(item=>item.id==='phase30-source-state')!==true,
      circleText:circle?.posts?.[0]?.text||null,
      mediaRecords,
      sourceFontId:fontFiles.find(item=>item.id==='phase30-source-font')?.id||null,
      sourceFontBytes:fontFiles.find(item=>item.id==='phase30-source-font')?.bytes||null,
      targetFontId:fontFiles.find(item=>item.id==='phase30-target-font')?.id||null,
      targetFontBytes:fontFiles.find(item=>item.id==='phase30-target-font')?.bytes||null,
      fontFiles,
      currentFontId:fontSnapshot.currentFontId
    };
  })()`);
}

function assertPreStartupProfile(stage, profile, sourceFontBase64, targetFontBase64) {
  assert.equal(profile.journalPhase, stage === 'committed' ? 'committed' : 'prepared', `${stage}: raw journal phase before app startup`);
  assert.equal(profile.journalOldStateSource, true, `${stage}: recovery journal must retain the exact old main-state snapshot`);
  assert.equal(profile.journalOldCircleText, 'Phase 30 pre-restore Circle state', `${stage}: recovery journal must retain the old Circle snapshot`);
  assert.equal(profile.journalOldMediaBytes, SOURCE_MEDIA_BASE64, `${stage}: recovery journal must retain the old media Blob bytes`);
  assert.equal(profile.journalOldFontId, 'phase30-source-font', `${stage}: recovery journal must retain the old font row`);
  assert.equal(profile.journalOldFontBytes, sourceFontBase64, `${stage}: recovery journal must retain the old font Blob bytes`);
  const sourceStateExpected = stage !== 'committed';
  assert.equal(profile.sourceState, sourceStateExpected, `${stage}: raw main state must reflect whether the final state commit occurred`);
  assert.equal(profile.targetState, stage === 'committed', `${stage}: target main state must only be durable after COMMITTED`);
  const circleTargetExpected = ['font','font-inflight','committed'].includes(stage);
  assert.equal(profile.circleText, circleTargetExpected ? '第十七阶段合成朋友圈动态' : 'Phase 30 pre-restore Circle state', `${stage}: raw Circle state must match the point reached before process death`);
  const targetMediaExpected = stage !== 'prepared' && stage !== 'media-inflight';
  assert.deepEqual(profile.mediaRecords.map(item=>item.id), MEDIA_IDS, `${stage}: all six original media rows must exist before app startup`);
  for (const media of profile.mediaRecords) {
    const expectSource = media.id === 'phase17-chat-media' && !targetMediaExpected;
    const expectedBytes = expectSource ? SOURCE_MEDIA_BASE64 : TARGET_MEDIA_BASE64;
    assert.equal(media.bytes, expectedBytes, `${stage}: raw media bytes before app startup for ${media.id}`);
    assert.equal(media.type, 'image/png', `${stage}: raw media MIME before app startup for ${media.id}`);
    assert.equal(media.size, Buffer.from(expectedBytes,'base64').length, `${stage}: raw media size before app startup for ${media.id}`);
  }
  const targetFontExpected = stage === 'font' || stage === 'committed';
  assert.equal(profile.currentFontId, targetFontExpected ? 'phase30-target-font' : 'phase30-source-font', `${stage}: current font pointer before app startup`);
  if (targetFontExpected) {
    assert.equal(profile.sourceFontId, null, `${stage}: old font row must have been replaced`);
    assert.equal(profile.targetFontId, 'phase30-target-font');
    assert.equal(profile.targetFontBytes, targetFontBase64, `${stage}: target font bytes before app startup`);
    assert.deepEqual(profile.fontFiles, [{ id:'phase30-target-font', size:Buffer.from(targetFontBase64,'base64').length, bytes:targetFontBase64 }]);
  } else {
    assert.equal(profile.sourceFontId, 'phase30-source-font', `${stage}: old font row must remain before the font transaction commits`);
    assert.equal(profile.sourceFontBytes, sourceFontBase64, `${stage}: old font bytes must be intact before app startup`);
    assert.equal(profile.targetFontId, null, `${stage}: target font row must not leak from an uncommitted font transaction`);
    assert.deepEqual(profile.fontFiles, [{ id:'phase30-source-font', size:Buffer.from(sourceFontBase64,'base64').length, bytes:sourceFontBase64 }]);
  }
}

async function verifyAfterRestart(page, stage) {
  return page.evaluate(`(async()=>{
    const open=async name=>{if(typeof indexedDB.databases!=='function')throw new Error('post-startup verification requires indexedDB.databases() to avoid creating missing evidence databases');const known=await indexedDB.databases();if(!known.some(item=>item.name===name))throw new Error('post-startup evidence database is missing: '+name);return new Promise((resolve,reject)=>{const request=indexedDB.open(name);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||new Error('verify DB open failed: '+name));request.onblocked=()=>reject(new Error('verify DB blocked: '+name));});};
    const readAll=(db,store)=>new Promise((resolve,reject)=>{
      const tx=db.transaction(store,'readonly');const request=tx.objectStore(store).getAll();let rows=null,requestDone=false,settled=false;
      request.onsuccess=()=>{rows=request.result||[];requestDone=true;};
      request.onerror=()=>{if(!settled){settled=true;reject(request.error||new Error('verify read failed: '+store));}};
      tx.oncomplete=()=>{if(settled)return;settled=true;if(!requestDone)reject(new Error('verify transaction completed without rows: '+store));else resolve(rows);};
      tx.onerror=()=>{if(!settled){settled=true;reject(tx.error||new Error('verify transaction failed: '+store));}};
      tx.onabort=()=>{if(!settled){settled=true;reject(tx.error||new Error('verify transaction aborted: '+store));}};
    });
    const readFontSnapshot=db=>new Promise((resolve,reject)=>{
      const tx=db.transaction(['fonts','meta'],'readonly');const fontsRequest=tx.objectStore('fonts').getAll();const currentRequest=tx.objectStore('meta').get('currentFontId');
      let fonts=null,current=null,fontsDone=false,currentDone=false,settled=false;
      fontsRequest.onsuccess=()=>{fonts=fontsRequest.result||[];fontsDone=true;};currentRequest.onsuccess=()=>{current=currentRequest.result||null;currentDone=true;};
      const fail=error=>{if(!settled){settled=true;reject(error||new Error('verify font snapshot failed'));}};
      fontsRequest.onerror=()=>fail(fontsRequest.error);currentRequest.onerror=()=>fail(currentRequest.error);
      tx.oncomplete=()=>{if(settled)return;settled=true;if(!fontsDone||!currentDone)reject(new Error('verify font snapshot missing request result'));else resolve({fonts,currentFontId:current?.value||null});};
      tx.onerror=()=>fail(tx.error);tx.onabort=()=>fail(tx.error||new Error('verify font snapshot aborted'));
    });
    const readOne=(db,store,key)=>new Promise((resolve,reject)=>{
      const tx=db.transaction(store,'readonly');const request=tx.objectStore(store).get(key);let value=null,requestDone=false,settled=false;
      request.onsuccess=()=>{value=request.result||null;requestDone=true;};
      request.onerror=()=>{if(!settled){settled=true;reject(request.error||new Error('verify journal read failed'));}};
      tx.oncomplete=()=>{if(settled)return;settled=true;if(!requestDone)reject(new Error('verify journal transaction completed without request result'));else resolve(value);};
      tx.onerror=()=>{if(!settled){settled=true;reject(tx.error||new Error('verify journal transaction failed'));}};
      tx.onabort=()=>{if(!settled){settled=true;reject(tx.error||new Error('verify journal transaction aborted'));}};
    });
    const b64=bytes=>{let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary);};
    const encode=async blob=>blob?b64(new Uint8Array(await blob.arrayBuffer())):'';
    const mediaDb=await open('dual_space_chat_media_v1');const rawMedia=await readAll(mediaDb,'media');mediaDb.close();
    const mediaRecords=[];
    for(const row of rawMedia){if(${JSON.stringify(MEDIA_IDS)}.includes(row.id))mediaRecords.push({id:row.id,bytes:await encode(row.blob),type:row.blob?.type||null,size:row.blob?.size||0,kind:row.kind||null});}
    mediaRecords.sort((a,b)=>${JSON.stringify(MEDIA_IDS)}.indexOf(a.id)-${JSON.stringify(MEDIA_IDS)}.indexOf(b.id));
    const fontDb=await open('chuanxun-local-font-library');const font=await readFontSnapshot(fontDb);fontDb.close();
    const fontFiles=[];for(const item of font.fonts||[])fontFiles.push({id:item.id,size:item.size,bytes:await encode(item.blob)});
    const journalDb=await open('twodeers-recovery-journal-v1');const journal=await readOne(journalDb,'recovery','v4-restore-active');journalDb.close();
    const main=JSON.parse(localStorage.getItem('dual_space_app_clean_test_v1')||'{}');
    const circle=window.__duoCircleApi?.exportState?.()||null;
    const status=window.__duoRuntimeCoordinator.getStatus();
    return {
      writable:window.__duoRuntimeCoordinator.isWritable()===true,
      startupComplete:status.startupComplete===true,
      blocked:status.blocked===true,
      reason:status.reason||'',
      sourceState:main.chatHistory?.some(item=>item.id==='phase30-source-state'&&item.text==='Phase 30 pre-restore state')===true,
      targetState:main.chatHistory?.some(item=>item.id==='phase17-chat-text'&&item.text==='第十七阶段合成聊天消息')===true && main.chatHistory?.some(item=>item.id==='phase30-source-state')!==true,
      circleText:circle?.posts?.[0]?.text||null,
      fontId:font.currentFontId||null,
      fontIds:(font.fonts||[]).map(item=>item.id),
      fontFiles,
      mediaBytes:mediaRecords.find(item=>item.id==='phase17-chat-media')?.bytes||'',
      mediaType:mediaRecords.find(item=>item.id==='phase17-chat-media')?.type||null,
      mediaSize:mediaRecords.find(item=>item.id==='phase17-chat-media')?.size||0,
      mediaRecords,
      journalPhase:journal?.phase||null,
      checkpoint:localStorage.getItem(${JSON.stringify(CHECKPOINT_KEY)})
    };
  })()`);
}

async function runCase(binary, baseUrl, targetFontBase64, sourceFontBase64, stage, options = {}) {
  const { artifactDir, onProgress } = options;
  const profileRoot = artifactDir ? path.join(path.resolve(artifactDir), 'profiles-in-progress') : os.tmpdir();
  await mkdir(profileRoot, { recursive:true });
  const profile = await mkdtemp(path.join(profileRoot, `twodeers-phase34-${stage}-`));
  let session;
  let preserveProfile = false;
  let profileMayContainTestData = false;
  let scenarioFailure = null;
  const report = async (status, detail = {}) => { if (onProgress) await onProgress({ status, at: new Date().toISOString(), ...detail }); };
  try {
    session = await launchChrome(binary, profile);
    await report('browser-started', { browserPid: session.child.pid, browserPort: session.port });
    console.log(`[Phase 33:${stage}] Chromium started`);
    await session.page.navigate(new URL('/__phase31_seed__', baseUrl).toString());
    await report('seed-origin-loaded');
    console.log(`[Phase 33:${stage}] seed origin loaded`);
    const seed = createValidSeed();
    assert.deepEqual(seed.media.map(item=>item.id), MEDIA_IDS, 'the exact media verification list must cover every seeded media record');
    profileMayContainTestData = true;
    const seedResult = await session.page.evaluate(buildSeedScript(seed, targetFontBase64), {timeoutMs:60_000});
    await report('seed-complete', { seedResult });
    console.log(`[Phase 33:${stage}] IndexedDB seed complete`, seedResult);
    assert.equal(seedResult.mediaCount, seed.media.length);
    await session.page.navigate(baseUrl);
    console.log(`[Phase 33:${stage}] app loaded; waiting startup`);
    await waitWritable(session.page);
    await report('initial-app-startup-complete');
    console.log(`[Phase 33:${stage}] app writable`);
    const archiveInfo = await session.page.evaluate(`(async()=>{window.__phase30Archive=await window.__duoBackupV4.build('all');const parsed=await window.__duoBackupV4.unzip(window.__phase30Archive);const media=parsed.manifest.resources.filter(item=>item.type==='media');const fonts=parsed.manifest.resources.filter(item=>item.type==='font');const font=fonts[0];const fontBlob=font?parsed.map.get(font.path)?.blob:null;const fontBytes=fontBlob?new Uint8Array(await fontBlob.arrayBuffer()):new Uint8Array();let binary='';for(const byte of fontBytes)binary+=String.fromCharCode(byte);return {size:window.__phase30Archive.size,type:window.__phase30Archive.type,mediaIds:media.map(item=>item.id),fontIds:fonts.map(item=>item.id),fontCurrentId:parsed.manifest.fontsCurrentId||null,fontBytes:btoa(binary),fontSize:fontBlob?.size||0};})()`);
    assert.ok(archiveInfo.size > 100, 'real V4 archive must be built in Chromium before the crash');
    assert.equal(archiveInfo.type, 'application/zip');
    assert.deepEqual([...archiveInfo.mediaIds].sort(), [...MEDIA_IDS].sort(), 'the real V4 ZIP manifest must include every expected media resource regardless of order');
    assert.deepEqual(archiveInfo.fontIds, ['phase30-target-font']);
    assert.equal(archiveInfo.fontCurrentId, 'phase30-target-font');
    assert.equal(archiveInfo.fontBytes, targetFontBase64, 'the actual V4 ZIP must contain the exact target font fixture bytes');
    assert.equal(archiveInfo.fontSize, Buffer.from(targetFontBase64,'base64').length);
    await report('archive-built', { archiveSize: archiveInfo.size, archiveMediaIds: archiveInfo.mediaIds, archiveFontIds: archiveInfo.fontIds });
    console.log(`[Phase 33:${stage}] V4 archive built`, { ...archiveInfo, fontBytes: `[${archiveInfo.fontBytes.length} base64 chars]` });
    const source = await session.page.evaluate(mutateSourceScript(sourceFontBase64), {timeoutMs:60_000});
    await report('source-mutated', source);
    console.log(`[Phase 33:${stage}] pre-restore source mutated`, source);
    assert.equal(source.sourceStateSaved, true);
    assert.equal(source.circleText, 'Phase 30 pre-restore Circle state');
    assert.equal(source.fontId, 'phase30-source-font');
    const transactionInFlight = stage === 'media-inflight' || stage === 'font-inflight';
    let bindingCheckpointPromise = null;
    let bindingCheckpointDetail = null;
    if (transactionInFlight) {
      await session.page.send('Runtime.addBinding', { name: PHASE31_BINDING });
      bindingCheckpointPromise = waitForBindingCheckpoint(session.page, stage);
    }
    await session.page.evaluate(installCheckpointScript(stage));
    await session.page.evaluate(`(()=>{window.__phase30RestorePromise=window.__duoBackupV4.restore(window.__phase30Archive).catch(error=>{localStorage.setItem('__twodeers_phase30_unexpected_restore_error_v1',String(error?.stack||error));});return true;})()`);
    if (transactionInFlight) bindingCheckpointDetail = await bindingCheckpointPromise;
    else await waitForCheckpoint(session.page, stage);
    const checkpointDetail = transactionInFlight ? bindingCheckpointDetail : await inspectCheckpointDetail(session.page);
    assert.equal(checkpointDetail?.stage, stage, `${stage}: checkpoint detail must identify the requested boundary`);
    if (stage === 'prepared') {
      assert.equal(checkpointDetail.journalPhase, 'prepared');
      assert.equal(checkpointDetail.sourceState, true, 'PREPARED must contain the actual pre-restore main snapshot');
      assert.equal(checkpointDetail.circleText, 'Phase 30 pre-restore Circle state');
      assert.equal(checkpointDetail.mediaId, 'phase17-chat-media');
      assert.equal(checkpointDetail.mediaBytes, SOURCE_MEDIA_BASE64, 'PREPARED must snapshot the distinct source media bytes');
      assert.equal(checkpointDetail.fontId, 'phase30-source-font');
      assert.equal(checkpointDetail.fontBytes, sourceFontBase64, 'PREPARED must snapshot the distinct source font bytes');
    } else if (stage === 'media') {
      assert.equal(checkpointDetail.mediaId, 'phase17-chat-media', 'media crash must occur after the designated chat-media ID was written');
      assert.equal(checkpointDetail.mediaBytes, TARGET_MEDIA_BASE64, 'media checkpoint must prove the target Blob write actually completed before SIGKILL');
      assert.equal(checkpointDetail.mediaType, 'image/png');
      assert.equal(checkpointDetail.mediaSize, Buffer.from(TARGET_MEDIA_BASE64, 'base64').length);
    } else if (stage === 'font') {
      assert.equal(checkpointDetail.currentFontId, 'phase30-target-font');
      assert.deepEqual(checkpointDetail.fontIds, ['phase30-target-font']);
      assert.equal(checkpointDetail.fontBytes, targetFontBase64, 'font checkpoint must prove the target font bytes committed before SIGKILL');
      assert.equal(checkpointDetail.fontSize, Buffer.from(targetFontBase64,'base64').length);
    } else if (stage === 'media-inflight') {
      assert.equal(checkpointDetail.stage, 'media-inflight');
      assert.equal(checkpointDetail.storeName, 'media');
      assert.equal(checkpointDetail.operation, 'put');
      assert.equal(checkpointDetail.requestSucceeded, true);
      assert.equal(checkpointDetail.transactionMode, 'readwrite');
      assert.equal(checkpointDetail.transactionDurability, 'strict');
      assert.equal(checkpointDetail.probeQueued, true, 'a second request must be queued while the target put transaction is still active');
      assert.equal(checkpointDetail.mediaId, 'phase17-chat-media');
    } else if (stage === 'font-inflight') {
      assert.equal(checkpointDetail.stage, 'font-inflight');
      assert.equal(checkpointDetail.storeName, 'fonts');
      assert.equal(checkpointDetail.operation, 'clear');
      assert.equal(checkpointDetail.requestSucceeded, true);
      assert.equal(checkpointDetail.transactionMode, 'readwrite');
      assert.equal(checkpointDetail.transactionDurability, 'strict');
      assert.equal(checkpointDetail.probeQueued, true, 'subsequent font/meta requests must remain queued in the live transaction');
    } else if (stage === 'committed') {
      assert.equal(checkpointDetail.journalPhase, 'committed');
      assert.equal(checkpointDetail.targetState, true);
      assert.equal(checkpointDetail.circleText, '第十七阶段合成朋友圈动态');
      assert.equal(checkpointDetail.mediaId, 'phase17-chat-media');
      assert.equal(checkpointDetail.mediaBytes, TARGET_MEDIA_BASE64);
      assert.equal(checkpointDetail.fontId, 'phase30-target-font');
      assert.equal(checkpointDetail.fontBytes, targetFontBase64);
      assert.equal(checkpointDetail.fontSize, Buffer.from(targetFontBase64,'base64').length);
    }
    const journalAtCrash = transactionInFlight ? { phase:'prepared', inspectedAfterProcessKillBeforeAppStartup:true } : await inspectJournal(session.page);
    await report('checkpoint-reached', { checkpointDetail, journalAtCrash, transactionInFlight, telemetry: { externalRequests: session.page.externalRequests.length, pageErrors: session.page.pageErrors.length } });
    if (!transactionInFlight) assert.equal(journalAtCrash?.phase, stage === 'committed' ? 'committed' : 'prepared', `wrong recovery journal phase at ${stage} kill`);
    const initialTelemetry = { externalRequests:[...session.page.externalRequests], pageErrors:[...session.page.pageErrors] };
    assert.deepEqual(initialTelemetry.externalRequests, [], `${stage}: initial restore must not contact external origins`);
    assert.deepEqual(initialTelemetry.pageErrors, [], `${stage}: initial restore must not produce uncaught page exceptions`);
    const killed = await killChrome(session);
    session = null;
    await report('chromium-sigkill-confirmed', { killedSignal: killed.signal, processGroupGone: killed.processGroupGone === true });

    const restarted = await launchChrome(binary, profile);
    session = restarted;
    // Inspect the persistent profile before application startup for every checkpoint,
    // not only the two in-flight cases. This prevents startup recovery from hiding
    // the actual crash-time state of localStorage and the independent IDB databases.
    await session.page.navigate(new URL('/__phase31_seed__', baseUrl).toString());
    const preStartupProfile = await inspectPersistedProfileBeforeApp(session.page);
    await report('pre-startup-profile-captured', { preStartupProfile });
    assertPreStartupProfile(stage, preStartupProfile, sourceFontBase64, targetFontBase64);
    await report('pre-startup-profile-validated');
    if (transactionInFlight) {
      assert.equal(preStartupProfile.journalPhase, 'prepared', `${stage}: PREPARED must survive process death before app startup`);
      if (stage === 'media-inflight') {
        assert.equal(preStartupProfile.mediaRecords.find(item=>item.id==='phase17-chat-media')?.bytes, SOURCE_MEDIA_BASE64, 'an IndexedDB media transaction killed while its put request is active must not commit partial replacement data');
      } else {
        assert.equal(preStartupProfile.mediaRecords.find(item=>item.id==='phase17-chat-media')?.bytes, TARGET_MEDIA_BASE64, 'media transactions completed before the font checkpoint must remain committed until PREPARED startup rollback');
      }
    }
    await session.page.navigate(baseUrl);
    console.log(`[Phase 33:${stage}] app loaded; waiting startup`);
    await waitWritable(session.page);
    await report('initial-app-startup-complete');
    console.log(`[Phase 33:${stage}] app writable`);
    const result = await verifyAfterRestart(session.page, stage);
    await report('startup-recovery-observed', { recoverySummary: { blocked: result.blocked, writable: result.writable, startupComplete: result.startupComplete, journalPhase: result.journalPhase, sourceState: result.sourceState, targetState: result.targetState, fontId: result.fontId, mediaRecordCount: result.mediaRecords.length } });
    assert.equal(result.blocked, false, `${stage}: startup must not leave recovery blocked: ${result.reason}`);
    assert.equal(result.writable, true, `${stage}: startup must restore the writer after verified recovery`);
    assert.equal(result.startupComplete, true);
    assert.equal(result.journalPhase, null, `${stage}: recovery journal must be cleared after verified startup handling`);
    assert.equal(result.checkpoint, stage, 'the same persistent Chromium profile must be reused');

    if (stage === 'committed') {
      assert.equal(result.sourceState, false, 'COMMITTED recovery must not roll back the target archive to pre-restore source state');
      assert.equal(result.targetState, true, 'COMMITTED recovery must retain the imported target state');
      assert.equal(result.circleText, '第十七阶段合成朋友圈动态', 'COMMITTED recovery must retain the imported Circle state');
      assert.equal(result.fontId, 'phase30-target-font', 'COMMITTED recovery must retain the imported target font library');
      assert.deepEqual(result.fontIds, ['phase30-target-font']);
      assert.deepEqual(result.fontFiles, [{id:'phase30-target-font',size:Buffer.from(targetFontBase64,'base64').length,bytes:targetFontBase64}], 'COMMITTED recovery must retain the exact target font bytes');
      assert.equal(result.mediaBytes, TARGET_MEDIA_BASE64, 'COMMITTED recovery must retain the imported media Blob');
      assert.equal(result.mediaType, 'image/png');
      assert.equal(result.mediaSize, Buffer.from(TARGET_MEDIA_BASE64,'base64').length);
      assert.deepEqual(result.mediaRecords.map(item=>item.id), MEDIA_IDS);
      for(const media of result.mediaRecords){assert.equal(media.bytes,TARGET_MEDIA_BASE64, `COMMITTED recovery must retain target bytes for ${media.id}`);assert.equal(media.type,'image/png',`COMMITTED recovery must retain MIME type for ${media.id}`);assert.equal(media.size,Buffer.from(TARGET_MEDIA_BASE64,'base64').length,`COMMITTED recovery must retain byte length for ${media.id}`);}
    } else {
      assert.equal(result.sourceState, true, `${stage}: PREPARED recovery must restore the pre-restore main state`);
      assert.equal(result.targetState, false, `${stage}: PREPARED recovery must not keep partially imported target state`);
      assert.equal(result.circleText, 'Phase 30 pre-restore Circle state', `${stage}: PREPARED recovery must restore the old Circle snapshot`);
      assert.equal(result.fontId, 'phase30-source-font', `${stage}: PREPARED recovery must restore the old font snapshot`);
      assert.deepEqual(result.fontIds, ['phase30-source-font']);
      assert.deepEqual(result.fontFiles, [{id:'phase30-source-font',size:Buffer.from(sourceFontBase64,'base64').length,bytes:sourceFontBase64}], `${stage}: PREPARED recovery must restore the exact source font bytes`);
      assert.equal(result.mediaBytes, SOURCE_MEDIA_BASE64, `${stage}: PREPARED recovery must restore the old media Blob after a real process kill`);
      assert.equal(result.mediaType, 'image/png');
      assert.equal(result.mediaSize, Buffer.from(SOURCE_MEDIA_BASE64,'base64').length);
      assert.deepEqual(result.mediaRecords.map(item=>item.id), MEDIA_IDS);
      for(const media of result.mediaRecords){const expected=media.id==='phase17-chat-media'?SOURCE_MEDIA_BASE64:TARGET_MEDIA_BASE64;assert.equal(media.bytes,expected, `${stage}: PREPARED recovery must restore source snapshot bytes for ${media.id}`);assert.equal(media.type,'image/png',`${stage}: PREPARED recovery must retain MIME type for ${media.id}`);assert.equal(media.size,Buffer.from(expected,'base64').length,`${stage}: PREPARED recovery must retain byte length for ${media.id}`);}
    }
    assert.deepEqual(session.page.externalRequests, [], `${stage}: restarted browser must not contact external origins`);
    assert.deepEqual(session.page.pageErrors, [], `${stage}: no uncaught page exceptions during startup recovery`);
    await report('recovery-verified');
    await stopChrome(session);
    session = null;
    await report('recovery-browser-process-group-closed');
    return { stage, archiveSize:archiveInfo.size, archiveMediaIds:archiveInfo.mediaIds, archiveFontIds:archiveInfo.fontIds, checkpointDetail, journalAtCrash, preStartupProfile, killedSignal:killed.signal, processGroupGone:killed.processGroupGone===true, afterRestart:result, externalRequests:initialTelemetry.externalRequests.length, pageErrors:initialTelemetry.pageErrors.length };
  } catch (error) {
    scenarioFailure = error;
    if (!session && scenarioFailure?.browserSession) session = scenarioFailure.browserSession;
    throw error;
  } finally {
    if (scenarioFailure) {
      const cleanup = await finalizeFailedRunCase({
        session,
        stopChromeFn: stopChrome,
        profile,
        artifactDir,
        stage,
        profileMayContainTestData,
        preserveFailedProfileFn: preserveFailedProfile
      });
      session = cleanup.session;
      preserveProfile = cleanup.preserveProfile;
      if (cleanup.cleanupError) scenarioFailure.cleanupError = cleanup.cleanupError;
      if (cleanup.failedProfileArtifactPath) scenarioFailure.failedProfileArtifactPath = cleanup.failedProfileArtifactPath;
      if (cleanup.profilePreservationError) scenarioFailure.profilePreservationError = cleanup.profilePreservationError;
      if (cleanup.profileRetainedPath) scenarioFailure.profileRetainedPath = cleanup.profileRetainedPath;
      if (!cleanup.browserStopped) scenarioFailure.unclosedProfilePath = path.relative(ROOT, profile);
      try {
        await report('failed', {
          error: scenarioFailure?.stack || String(scenarioFailure),
          failedProfileArtifactPath: scenarioFailure.failedProfileArtifactPath || null,
          cleanupError: scenarioFailure.cleanupError || null,
          profilePreservationError: scenarioFailure.profilePreservationError || null,
          profileRetainedPath: scenarioFailure.profileRetainedPath || null,
          unclosedProfilePath: scenarioFailure.unclosedProfilePath || null
        });
      } catch (progressError) {
        scenarioFailure.evidenceWriteError = progressError?.message || String(progressError);
      }
    } else if (session) {
      await stopChrome(session);
      session = null;
    }
    if (!preserveProfile && !session) await rm(profile, { recursive:true, force:true });
  }
}

async function main() {
  if (process.platform === 'win32') throw new Error('本验收依赖 Linux/macOS 进程组 SIGKILL；Windows 请在 Linux CI 执行');
  const artifactDir = path.resolve(process.env.TWODEERS_E2E_ARTIFACT_DIR || path.join(ROOT, 'test-results', 'browser-e2e', 'phase33'));
  await mkdir(artifactDir, { recursive:true });
  const evidencePath = path.join(artifactDir, 'phase33-chromium-v4-ci-independent-matrix.json');
  const evidence = {
    phase: 33,
    harnessPhase: 32,
    status: 'preflight',
    browser: null,
    browserVersion: null,
    node: process.version,
    platform: process.platform,
    ci: process.env.CI === 'true',
    stages: [],
    currentStage: null,
    startedAt: new Date().toISOString()
  };
  const persistEvidence = async () => writeJsonAtomic(evidencePath, { ...evidence, updatedAt: new Date().toISOString() });
  let server = null;
  await persistEvidence();
  try {
    const binary = await findChromium();
    evidence.browser = binary;
    evidence.browserVersion = spawnSync(binary, ['--version'], { encoding:'utf8' }).stdout?.trim() || 'unknown';
    const targetFontCandidates = [
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf',
      '/usr/share/fonts/fonts-go/Go-Regular.ttf',
      '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf'
    ];
    const sourceFontCandidates = [
      '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf',
      '/usr/share/fonts/truetype/liberation2/LiberationSerif-Regular.ttf',
      '/usr/share/fonts/fonts-go/Go-Medium.ttf',
      '/usr/share/fonts/truetype/noto/NotoSerif-Regular.ttf'
    ];
    async function readFirstFont(candidates, label) {
      for (const file of candidates) { try { return { file, bytes:await readFile(file) }; } catch {} }
      throw new Error(`缺少用于真实 Chromium ${label}验收的独立 TTF 文件`);
    }
    const targetFont = await readFirstFont(targetFontCandidates, '目标备份字体');
    const sourceFont = await readFirstFont(sourceFontCandidates, '源数据字体');
    const targetFontBase64 = targetFont.bytes.toString('base64');
    const sourceFontBase64 = sourceFont.bytes.toString('base64');
    assert.notEqual(targetFontBase64, sourceFontBase64, '目标字体和源字体必须是不同的实际文件字节，避免只测试字体 ID');
    assert.notEqual(targetFont.file, sourceFont.file, '目标字体和源字体必须来自不同的 fixture 文件');
    evidence.targetFont = { path:targetFont.file, size:targetFont.bytes.length, sha256:createHash('sha256').update(targetFont.bytes).digest('hex') };
    evidence.sourceFont = { path:sourceFont.file, size:sourceFont.bytes.length, sha256:createHash('sha256').update(sourceFont.bytes).digest('hex') };
    const serverInfo = await startStaticServer();
    server = serverInfo.server;
    evidence.origin = new URL(serverInfo.url).origin;
    evidence.status = 'running';
    await persistEvidence();
    const stageNames = ['prepared','media','media-inflight','font','font-inflight','committed'];
    for (const stage of stageNames) {
      const stageRecord = { stage, status:'running', startedAt:new Date().toISOString(), progress:[] };
      evidence.stages.push(stageRecord);
      evidence.currentStage = stage;
      await persistEvidence();
      console.log(`[Phase 33] starting real Chromium crash checkpoint: ${stage}`);
      try {
        const result = await runCase(binary, serverInfo.url, targetFontBase64, sourceFontBase64, stage, {
          artifactDir,
          onProgress: async progress => {
            stageRecord.progress.push(progress);
            stageRecord.lastProgress = progress.status;
            stageRecord.updatedAt = progress.at;
            if (progress.failedProfileArtifactPath) stageRecord.failedProfileArtifactPath = progress.failedProfileArtifactPath;
            await persistEvidence();
          }
        });
        Object.assign(stageRecord, result, { status:'passed', finishedAt:new Date().toISOString() });
        delete stageRecord.progress;
        delete stageRecord.lastProgress;
        evidence.currentStage = null;
        await persistEvidence();
        console.log(`[Phase 33] passed: ${stage}`);
      } catch (error) {
        stageRecord.status = 'failed';
        stageRecord.error = error?.stack || String(error);
        stageRecord.failedProfileArtifactPath = error.failedProfileArtifactPath || null;
        stageRecord.cleanupError = error.cleanupError || null;
        stageRecord.profilePreservationError = error.profilePreservationError || null;
        stageRecord.profileRetainedPath = error.profileRetainedPath || null;
        stageRecord.unclosedProfilePath = error.unclosedProfilePath || null;
        stageRecord.finishedAt = new Date().toISOString();
        evidence.currentStage = stage;
        throw error;
      }
    }
    assert.equal(evidence.stages.filter(item => item.status === 'passed').length, 6);
    evidence.status = 'passed';
    evidence.currentStage = null;
    evidence.finishedAt = new Date().toISOString();
    await persistEvidence();
    console.log('PASS: Phase 33 independent CI V4 crash matrix; all six SIGKILL checkpoints inspect raw persistent state before startup recovery and verify the same-profile recovery result.');
    console.log(JSON.stringify(evidence, null, 2));
  } catch (error) {
    const errorText = error?.stack || String(error);
    evidence.status = /ERR_BLOCKED_BY_ADMINISTRATOR/.test(errorText) ? 'blocked' : 'failed';
    if (evidence.status === 'blocked') evidence.blockerType = 'managed-chromium-url-policy';
    evidence.error = errorText;
    evidence.finishedAt = new Date().toISOString();
    await persistEvidence();
    throw error;
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
  }
}

await main();
