/* Cross-tab single-writer coordination, durable V4 restore journal and storage diagnostics. */
(function (global) {
  'use strict';
  if (global.__duoRuntimeCoordinatorInstalled) return;
  global.__duoRuntimeCoordinatorInstalled = true;

  // Freeze all background writers immediately; the page becomes editable only after lease acquisition.
  global.__duoCircleRestorePaused = true;
  global.__duoRuntimeStartupLocked = true;

  var LOCK_NAME = 'twodeers-app-single-writer-v1';
  var FALLBACK_DB = 'twodeers-runtime-coordinator-v1';
  var FALLBACK_STORE = 'leases';
  var JOURNAL_DB = 'twodeers-recovery-journal-v1';
  var JOURNAL_STORE = 'recovery';
  var JOURNAL_ID = 'v4-restore-active';
  var REVISION_KEY = '__twodeers_runtime_revision_v1';
  var LEASE_TTL = 15000;
  var HEARTBEAT_MS = 3000;
  var RETRY_MS = 5000;
  var ownerId = makeId();
  var writable = false;
  var readyResolved = false;
  var readyResolve;
  var ready = new Promise(function (resolve) { readyResolve = resolve; });
  var webRelease = null;
  var fallbackDbPromise = null;
  var journalDbPromise = null;
  var heartbeatHandle = null;
  var retryHandle = null;
  var activeMutations = 0;
  var pendingLeaseRelease = false;
  var resumeAfterMutation = false;
  var leaseLostWhileMutation = false;
  var banner = null;
  var promotionAvailable = false;
  var revisionAtRelease = null;
  var lastOwnRevision = null;
  var revisionReliable = true;
  var permanentlyBlocked = false;
  var startupComplete = false;
  var blockReason = '';
  var channel = null;

  function readRevision() {
    try { return String(global.localStorage.getItem(REVISION_KEY) || '0'); }
    catch (_) { revisionReliable = false; return null; }
  }
  function markDataChanged() {
    if (!writable || permanentlyBlocked) return false;
    try {
      var current = Number(global.localStorage.getItem(REVISION_KEY) || 0);
      if (!Number.isSafeInteger(current) || current < 0) current = 0;
      var next = String(current + 1);
      global.localStorage.setItem(REVISION_KEY, next);
      lastOwnRevision = next;
      return true;
    } catch (error) {
      revisionReliable = false;
      revisionAtRelease = null;
      var reason = new Error('跨标签页数据版本标记写入失败；此前业务数据可能已经写入。当前页面及已打开的其他页面已锁定，请重新加载并检查数据后再操作');
      reason.name = 'RevisionMarkerError';
      try { if (channel) channel.postMessage({ type: 'revision-unreliable', message: reason.message, detectedAt: Date.now() }); } catch (_) {}
      setBlocked(reason);
      return false;
    }
  }
  function canResumeWithoutReload() {
    var now = readRevision();
    return revisionReliable && revisionAtRelease !== null && now !== null && now === revisionAtRelease;
  }
  function makeId() {
    try { return global.crypto && global.crypto.randomUUID ? global.crypto.randomUUID() : 'tab-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2); }
    catch (_) { return 'tab-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2); }
  }
  function emit() {
    var detail = { writable: isWritable(), leaseHeld: writable, startupComplete: startupComplete, promotionAvailable: promotionAvailable, blocked: permanentlyBlocked, reason: blockReason, ownerId: ownerId };
    try { global.dispatchEvent(new CustomEvent('duo-runtime-access-changed', { detail: detail })); } catch (_) {}
    try { if (channel) channel.postMessage({ type: 'access', detail: detail }); } catch (_) {}
    updateBanner();
  }
  function updateBanner() {
    if (!global.document || !document.body) return;
    document.body.dataset.duoWritable = isWritable() ? 'true' : 'false';
    document.body.dataset.duoReadonly = isWritable() ? 'false' : 'true';
    if (isWritable() && !permanentlyBlocked) {
      if (banner) banner.remove();
      banner = null;
      return;
    }
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'duoRuntimeReadonlyBanner';
      banner.style.cssText = 'position:fixed;z-index:2147483646;left:10px;right:10px;top:calc(env(safe-area-inset-top,0px) + 8px);padding:10px 12px;border-radius:12px;background:#342d28;color:#fff;box-shadow:0 6px 24px rgba(0,0,0,.24);font:13px/1.5 sans-serif;display:flex;gap:10px;align-items:center;justify-content:space-between;';
      document.body.appendChild(banner);
    }
    banner.replaceChildren();
    var message = document.createElement('span');
    message.textContent = permanentlyBlocked ? ('恢复保护已启用：' + (blockReason || '请关闭此页面并检查恢复日志')) : writable && !startupComplete ? '正在检查本地数据并完成启动，暂时禁止编辑。' : promotionAvailable ? '当前标签页为只读。编辑标签页已退出；请重新加载此页以读取最新数据并获得编辑权。' : '当前标签页为只读：另一个双人空间标签页正在编辑。关闭编辑页后，请重新加载本页。';
    banner.appendChild(message);
    if (permanentlyBlocked) {
      // A corrupted-store page cannot use the normal navigation controls.
      // Keep a direct, explicitly read-only route to the diagnostic/export UI.
      var diagnostics = document.createElement('button');
      diagnostics.type = 'button';
      diagnostics.dataset.duoReadonlyAllowed = 'true';
      diagnostics.textContent = '打开数据诊断';
      diagnostics.style.cssText = 'flex:none;border:1px solid rgba(255,255,255,.75);border-radius:999px;padding:6px 12px;color:#fff;background:transparent;';
      diagnostics.addEventListener('click', function () {
        try {
          if (typeof global.goto === 'function') global.goto('settingsPage');
          else {
            var page = document.getElementById('settingsPage');
            if (page) { document.querySelectorAll('.page').forEach(function (item) { item.classList.remove('active'); }); page.classList.add('active'); }
          }
          global.setTimeout(function () {
            var target = document.getElementById('recoveryWorkbenchFile') || document.getElementById('storageDiagnosticsBtn');
            if (target && typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'center' });
          }, 0);
        } catch (_) {}
      });
      banner.appendChild(diagnostics);
    }
    if (!permanentlyBlocked && !(writable && !startupComplete)) {
      var reload = document.createElement('button');
      reload.type = 'button';
      reload.textContent = '重新加载';
      reload.style.cssText = 'flex:none;border:1px solid rgba(255,255,255,.65);border-radius:999px;padding:6px 12px;color:#fff;background:transparent;';
      reload.addEventListener('click', function () { global.location.reload(); });
      banner.appendChild(reload);
    }
  }
  function setWritable(value, reason) {
    var next = !!value && !permanentlyBlocked;
    var changed = writable !== next;
    writable = next;
    if (next) { lastOwnRevision = readRevision(); revisionAtRelease = null; }
    global.__duoRuntimeStartupLocked = !isWritable();
    if (reason) blockReason = reason;
    if (!readyResolved) { readyResolved = true; readyResolve({ writable: writable, reason: blockReason }); }
    if (changed || reason) emit();
  }
  function setBlocked(error) {
    permanentlyBlocked = true;
    blockReason = error && error.message ? error.message : String(error || '恢复日志无法安全处理');
    setWritable(false, blockReason);
    // Do not keep an otherwise idle Web Lock / fallback lease hostage while a
    // read-only diagnostic export is available. In-flight transactions retain
    // the lease until their final mutation token is closed.
    if (activeMutations > 0) pendingLeaseRelease = true;
    else releaseLeaseNow();
  }
  function reportStorageDamage(key, error) {
    var item = { key: String(key || 'unknown').slice(0, 180), name: String(error && error.name || 'StorageError').slice(0, 80), message: String(error && error.message || error || '本地存储结构异常').slice(0, 500), detectedAt: Date.now() };
    try {
      if (!Array.isArray(global.__duoStorageBootIssues)) global.__duoStorageBootIssues = [];
      if (!global.__duoStorageBootIssues.some(function (old) { return old.key === item.key && old.message === item.message; })) global.__duoStorageBootIssues.push(item);
    } catch (_) {}
    setBlocked(new Error('检测到本地数据损坏（' + item.key + '）：' + item.message + '。原始数据已保留，诊断和导出前禁止继续写入'));
    return item;
  }
  function assertWritable(operation) {
    if (!readyResolved) {
      var waitingPrefix = operation ? String(operation) + '：' : '';
      throw new Error(waitingPrefix + '正在确认本地编辑权，请稍后重试');
    }
    if (!writable || permanentlyBlocked) {
      var prefix = operation ? String(operation) + '：' : '';
      throw new Error(prefix + (permanentlyBlocked ? '检测到未完成的恢复事务，已锁定写入；请先完成恢复处理' : '当前标签页为只读，另一个标签页拥有编辑权；请关闭编辑页并重新加载'));
    }
    return true;
  }
  function isWritable() { return writable && startupComplete && !permanentlyBlocked; }
  function completeStartup() {
    if (!writable || permanentlyBlocked || !readyResolved) throw new Error('当前标签页尚未取得安全启动写入权');
    startupComplete = true;
    global.__duoRuntimeStartupLocked = false;
    emit();
    return true;
  }

  function openDb(name, version, storeName) {
    return new Promise(function (resolve, reject) {
      if (!global.indexedDB) { reject(new Error('IndexedDB 不可用，无法建立跨标签页安全锁')); return; }
      var request;
      try { request = global.indexedDB.open(name, version); } catch (error) { reject(error); return; }
      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName, { keyPath: 'id' });
      };
      request.onsuccess = function () {
        var db = request.result;
        db.onversionchange = function () { try { db.close(); } catch (_) {} };
        resolve(db);
      };
      request.onerror = function () { reject(request.error || new Error('运行时协调数据库打开失败')); };
      request.onblocked = function () { reject(new Error('运行时协调数据库被其他页面阻塞')); };
    });
  }
  function openFallbackDb() {
    if (!fallbackDbPromise) fallbackDbPromise = openDb(FALLBACK_DB, 1, FALLBACK_STORE).catch(function (error) { fallbackDbPromise = null; throw error; });
    return fallbackDbPromise;
  }
  function transactLease(mode, operation) {
    return openFallbackDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx, result = null, failure = null;
        try { tx = db.transaction(FALLBACK_STORE, mode); } catch (error) { reject(error); return; }
        var store = tx.objectStore(FALLBACK_STORE);
        operation(store, function (value) { result = value; }, function (error) { failure = error; try { tx.abort(); } catch (_) {} });
        tx.oncomplete = function () { if (failure) reject(failure); else resolve(result); };
        tx.onerror = function () { reject(failure || tx.error || new Error('跨标签页锁事务失败')); };
        tx.onabort = function () { reject(failure || tx.error || new Error('跨标签页锁事务中断')); };
      });
    });
  }
  async function fallbackClaim() {
    var acquired = false;
    await transactLease('readwrite', function (store, done) {
      var request = store.get(LOCK_NAME);
      request.onsuccess = function () {
        var current = request.result;
        var now = Date.now();
        if (!current || Number(current.expiresAt) <= now || current.ownerId === ownerId) {
          store.put({ id: LOCK_NAME, ownerId: ownerId, expiresAt: now + LEASE_TTL, heartbeatAt: now });
          acquired = true;
        }
        done(acquired);
      };
    });
    return acquired;
  }
  async function fallbackRelease() {
    try {
      await transactLease('readwrite', function (store, done) {
        var request = store.get(LOCK_NAME);
        request.onsuccess = function () { if (request.result && request.result.ownerId === ownerId) store.delete(LOCK_NAME); done(true); };
      });
    } catch (_) {}
  }
  async function fallbackRenew(allowReadonly) {
    if ((!writable && !(activeMutations > 0 && pendingLeaseRelease) && !allowReadonly) || !heartbeatHandle || permanentlyBlocked) return false;
    var kept = false;
    try {
      await transactLease('readwrite', function (store, done) {
        var request = store.get(LOCK_NAME);
        request.onsuccess = function () {
          var current = request.result;
          if (current && current.ownerId === ownerId) {
            var now = Date.now();
            store.put({ id: LOCK_NAME, ownerId: ownerId, expiresAt: now + (activeMutations > 0 ? 10 * 60 * 1000 : LEASE_TTL), heartbeatAt: now, mutationActive: activeMutations > 0 });
            kept = true;
          }
          done(kept);
        };
      });
    } catch (_) { kept = false; }
    if (!kept) { leaseLostWhileMutation = true; revisionReliable = false; revisionAtRelease = null; stopHeartbeat(); setWritable(false, '编辑权已转移到其他标签页，请重新加载'); promotionAvailable = true; }
    return kept;
  }
  function stopHeartbeat() { if (heartbeatHandle) clearInterval(heartbeatHandle); heartbeatHandle = null; }
  function startHeartbeat() {
    stopHeartbeat();
    // Timer APIs pass their handle as the callback's first argument. Never let
    // that numeric handle accidentally opt the renewal into readonly mode.
    heartbeatHandle = setInterval(function () { fallbackRenew(false); }, HEARTBEAT_MS);
  }
  function scheduleRetry() {
    if (retryHandle || permanentlyBlocked) return;
    retryHandle = setTimeout(function () { retryHandle = null; acquireWriter().catch(function (error) { setWritable(false, error.message); scheduleRetry(); }); }, RETRY_MS);
  }
  async function acquireWithWebLocks() {
    var resolveAcquired;
    var acquiredPromise = new Promise(function (resolve) { resolveAcquired = resolve; });
    var settled = false;
    var request;
    try {
      request = global.navigator.locks.request(LOCK_NAME, { mode: 'exclusive', ifAvailable: true }, async function (lock) {
        if (!lock) { settled = true; resolveAcquired(false); return; }
        webRelease = null;
        var releasePromiseResolve;
        var releasePromise = new Promise(function (resolve) { releasePromiseResolve = resolve; webRelease = resolve; });
        settled = true;
        if (readyResolved && canResumeWithoutReload()) {
          promotionAvailable = false;
          setWritable(true);
          resolveAcquired(true);
          await releasePromise;
          webRelease = null;
          setWritable(false);
          return;
        }
        if (readyResolved) {
          promotionAvailable = true;
          setWritable(false, '编辑权已空闲；数据版本已变化，请重新加载');
          resolveAcquired(false);
          releasePromiseResolve();
          webRelease = null;
          scheduleRetry();
          return;
        }
        leaseLostWhileMutation = false;
        setWritable(true);
        promotionAvailable = false;
        resolveAcquired(true);
        await releasePromise;
        webRelease = null;
        setWritable(false);
      });
      request.catch(function (error) { if (!settled) { settled = true; resolveAcquired(false); } setWritable(false, error.message); });
    } catch (error) { resolveAcquired(false); }
    return acquiredPromise;
  }
  async function acquireWriter() {
    if (permanentlyBlocked || document.visibilityState === 'hidden') return false;
    if (global.navigator && global.navigator.locks && typeof global.navigator.locks.request === 'function') {
      var got = await acquireWithWebLocks();
      if (!got) { promotionAvailable = false; setWritable(false); scheduleRetry(); }
      return got;
    }
    var claimed = await fallbackClaim();
    if (claimed) {
      leaseLostWhileMutation = false;
      if (readyResolved && canResumeWithoutReload()) {
        leaseLostWhileMutation = false; promotionAvailable = false; setWritable(true); startHeartbeat(); return true;
      }
      if (readyResolved) {
        promotionAvailable = true;
        await fallbackRelease();
        setWritable(false, '编辑权已空闲；数据版本已变化，请重新加载');
        scheduleRetry();
        return false;
      }
      promotionAvailable = false; setWritable(true); startHeartbeat(); return true;
    }
    promotionAvailable = false; setWritable(false); scheduleRetry(); return false;
  }
  function releaseLeaseNow() {
    var actuallyHeld = !!webRelease || !!heartbeatHandle;
    if (webRelease) { var release = webRelease; webRelease = null; try { release(); } catch (_) {} }
    if (heartbeatHandle) { stopHeartbeat(); fallbackRelease(); }
    if (actuallyHeld) { revisionReliable = false; revisionAtRelease = null; }
  }
  function beginMutation(operation) {
    // A transaction already holding the lease may start nested writes while the
    // UI is hidden/readonly, but only as long as ownership has not been lost.
    // This lets an in-flight importer finish or roll back without opening the
    // page to new user/background writes.
    var continuingOwnedMutation = activeMutations > 0 && pendingLeaseRelease && !leaseLostWhileMutation && (webRelease || heartbeatHandle);
    if (!continuingOwnedMutation) assertWritable(operation || '写入数据');
    activeMutations++;
    var ended = false;
    return function endMutation() {
      if (ended) return;
      ended = true;
      activeMutations = Math.max(0, activeMutations - 1);
      if (activeMutations !== 0 || !pendingLeaseRelease) return;
      pendingLeaseRelease = false;
      if (resumeAfterMutation && !leaseLostWhileMutation && document.visibilityState !== 'hidden' && (webRelease || heartbeatHandle) && !permanentlyBlocked) {
        resumeAfterMutation = false;
        setWritable(true);
        return;
      }
      resumeAfterMutation = false;
      releaseLeaseNow();
    };
  }
  function releaseCurrent() {
    if (writable) revisionAtRelease = readRevision();
    setWritable(false);
    if (activeMutations > 0) { pendingLeaseRelease = true; if (heartbeatHandle) fallbackRenew(); return; }
    pendingLeaseRelease = false; resumeAfterMutation = false;
    releaseLeaseNow();
  }

  async function revalidateFallbackLease() {
    if (!writable || !heartbeatHandle || permanentlyBlocked) return false;
    var wasStartupComplete = startupComplete;
    setWritable(false, '正在重新确认跨标签页编辑权');
    var kept = await fallbackRenew(true);
    if (kept && !permanentlyBlocked) {
      setWritable(true);
      startupComplete = wasStartupComplete;
      emit();
      return true;
    }
    return false;
  }
  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      releaseCurrent();
    } else if (pendingLeaseRelease && activeMutations > 0) {
      // Do not reacquire a second Web Lock or expose the UI mid-transaction.
      // The current owner still holds the lease until the final mutation ends.
      resumeAfterMutation = true;
    } else if (writable && heartbeatHandle) {
      revalidateFallbackLease().catch(function (error) { setWritable(false, error.message); });
    } else if (!writable && !permanentlyBlocked) {
      acquireWriter().catch(function (error) { setWritable(false, error.message); scheduleRetry(); });
    }
  }
  if (global.BroadcastChannel) {
    try {
      channel = new BroadcastChannel('twodeers-runtime-coordinator-v1');
      channel.onmessage = function (event) {
        var message = event && event.data;
        if (!message || message.type !== 'revision-unreliable') return;
        revisionReliable = false;
        revisionAtRelease = null;
        setBlocked(new Error(String(message.message || '其他标签页无法确认数据版本；请重新加载并检查数据后再操作')));
      };
    } catch (_) { channel = null; }
  }
  if (global.document) {
    document.addEventListener('visibilitychange', onVisibilityChange);
    global.addEventListener('storage', function (event) { if (event && event.key === REVISION_KEY && !writable) promotionAvailable = true; });
    global.addEventListener('pagehide', releaseCurrent);
    global.addEventListener('beforeunload', releaseCurrent);
    global.addEventListener('pageshow', function () { onVisibilityChange(); });
    global.addEventListener('focus', function () { onVisibilityChange(); });
    document.addEventListener('DOMContentLoaded', updateBanner, { once: true });
    function findEventElement(event, selector) {
      var path = event && typeof event.composedPath === 'function' ? event.composedPath() : [];
      for (var i = 0; i < path.length; i++) {
        var node = path[i];
        if (node && node.nodeType === 1 && typeof node.matches === 'function' && node.matches(selector)) return node;
      }
      var fallback = event && event.target;
      return fallback && fallback.closest ? fallback.closest(selector) : null;
    }
    document.addEventListener('click', function (event) {
      if (isWritable()) return;
      if (findEventElement(event, '[data-duo-readonly-allowed="true"]')) return;
      var target = findEventElement(event, 'button,input,textarea,select,[contenteditable="true"],[data-duo-mutating]');
      if (!target || target.closest('#duoRuntimeReadonlyBanner')) return;
      event.preventDefault(); event.stopImmediatePropagation();
      try { if (global.showToast) global.showToast('当前标签页为只读，请在编辑标签页操作或重新加载接管'); } catch (_) {}
    }, true);
    function blockReadonlyFormEdit(event) {
      if (isWritable()) return;
      if (findEventElement(event, '[data-duo-readonly-allowed="true"]')) return;
      var target = findEventElement(event, 'input,textarea,select');
      if (target) {
        event.preventDefault(); event.stopImmediatePropagation();
        try { if (global.showToast) global.showToast('当前标签页为只读，修改未保存'); } catch (_) {}
      }
    }
    document.addEventListener('input', blockReadonlyFormEdit, true);
    document.addEventListener('change', blockReadonlyFormEdit, true);
    document.addEventListener('keydown', function (event) {
      if (isWritable()) return;
      if (findEventElement(event, '[data-duo-readonly-allowed="true"]')) return;
      var mutatingSurface = findEventElement(event, 'button,input,textarea,select,[contenteditable="true"],[role="button"],[data-sticker-id],[data-card-draw],[data-card-use],[data-card-add],[data-card-remove]');
      if (!mutatingSurface) return;
      if (event.key === 'Tab' || event.key === 'Escape' || event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'ArrowLeft' || event.key === 'ArrowRight') return;
      event.preventDefault(); event.stopImmediatePropagation();
      try { if (global.showToast) global.showToast('当前标签页尚未获得编辑权，键盘操作未执行'); } catch (_) {}
    }, true);
    document.addEventListener('submit', function (event) {
      if (isWritable() || findEventElement(event, '[data-duo-readonly-allowed="true"]')) return;
      event.preventDefault(); event.stopImmediatePropagation();
    }, true);
  }

  async function openJournalDb() {
    if (!journalDbPromise) journalDbPromise = openDb(JOURNAL_DB, 1, JOURNAL_STORE).catch(function (error) { journalDbPromise = null; throw error; });
    return journalDbPromise;
  }
  function beginStrictJournalWrite(db, operation) {
    var tx;
    try { tx = db.transaction(JOURNAL_STORE, 'readwrite', { durability: 'strict' }); }
    catch (error) { throw new Error((operation || '恢复保护日志') + '无法建立严格持久化事务：' + (error.message || error)); }
    // Some older engines silently ignore unknown transaction options. Never
    // mistake that for durable PREPARED/COMMITTED journal persistence.
    if (tx.durability !== 'strict') {
      try { tx.abort(); } catch (_) {}
      throw new Error((operation || '恢复保护日志') + '：当前浏览器不支持严格持久化事务，已停止此项恢复操作');
    }
    return tx;
  }
  async function saveRecoveryJournal(record) {
    assertWritable('创建恢复保护日志');
    if (!record || record.id !== JOURNAL_ID || record.phase !== 'prepared') throw new Error('恢复保护日志格式无效');
    var db = await openJournalDb();
    await new Promise(function (resolve, reject) {
      var tx = beginStrictJournalWrite(db, '创建 PREPARED 恢复保护日志');
      tx.objectStore(JOURNAL_STORE).put(record);
      tx.oncomplete = resolve;
      tx.onerror = function () { reject(normalizeQuotaError(tx.error || new Error('恢复保护日志写入失败'), '创建恢复保护日志')); };
      tx.onabort = function () { reject(normalizeQuotaError(tx.error || new Error('恢复保护日志写入中断'), '创建恢复保护日志')); };
    });
    var check = await readRecoveryJournal();
    if (!check || check.id !== record.id || check.phase !== 'prepared' || check.createdAt !== record.createdAt) throw new Error('PREPARED 恢复保护日志严格事务后回读校验失败');
    return true;
  }
  async function readRecoveryJournal() {
    var db = await openJournalDb();
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(JOURNAL_STORE, 'readonly');
      var request = tx.objectStore(JOURNAL_STORE).get(JOURNAL_ID);
      var result = null, requestFailed = null;
      request.onsuccess = function () { result = request.result || null; };
      request.onerror = function () { requestFailed = request.error || new Error('恢复保护日志读取失败'); try { tx.abort(); } catch (_) {} };
      tx.oncomplete = function () { if (requestFailed) reject(requestFailed); else resolve(result); };
      tx.onerror = function () { reject(requestFailed || tx.error || new Error('恢复保护日志读取事务失败')); };
      tx.onabort = function () { reject(requestFailed || tx.error || new Error('恢复保护日志读取事务中断')); };
    });
  }
  async function markRecoveryCommitted() {
    assertWritable('标记恢复事务已提交');
    var record = await readRecoveryJournal();
    if (!record || record.id !== JOURNAL_ID || record.phase !== 'prepared') throw new Error('PREPARED 恢复保护日志丢失或状态无效，无法标记提交');
    record.phase = 'committed'; record.committedAt = Date.now();
    var db = await openJournalDb();
    await new Promise(function (resolve, reject) {
      var tx = beginStrictJournalWrite(db, '标记 COMMITTED 恢复保护日志'); tx.objectStore(JOURNAL_STORE).put(record);
      tx.oncomplete = resolve; tx.onerror = function () { reject(normalizeQuotaError(tx.error || new Error('恢复提交标记失败'), '写入恢复提交标记')); }; tx.onabort = function () { reject(normalizeQuotaError(tx.error || new Error('恢复提交标记中断'), '写入恢复提交标记')); };
    });
    // The transaction completed, so the COMMITTED marker may already be
    // durable. A failed read-back must not be treated as a normal import error:
    // blindly rolling back could conflict with a committed marker and startup
    // would then skip the rollback. Fence the page and let startup inspect it.
    var committed;
    try { committed = await readRecoveryJournal(); }
    catch (error) {
      var uncertainRead = new Error('COMMITTED 恢复标记事务已完成，但回读失败，提交状态不确定：' + (error.message || error));
      uncertainRead.journalCommitUncertain = true;
      throw uncertainRead;
    }
    if (!committed || committed.id !== record.id || committed.phase !== 'committed' || committed.committedAt !== record.committedAt) {
      var uncertainMarker = new Error('COMMITTED 恢复标记事务已完成，但回读内容不一致，提交状态不确定');
      uncertainMarker.journalCommitUncertain = true;
      throw uncertainMarker;
    }
    return true;
  }
  async function clearRecoveryJournal() {
    assertWritable('清理恢复保护日志');
    var db = await openJournalDb();
    await new Promise(function (resolve, reject) {
      var tx = beginStrictJournalWrite(db, '清理恢复保护日志'); tx.objectStore(JOURNAL_STORE).delete(JOURNAL_ID);
      tx.oncomplete = resolve; tx.onerror = function () { reject(normalizeQuotaError(tx.error || new Error('恢复保护日志清理失败'), '清理恢复保护日志')); }; tx.onabort = function () { reject(normalizeQuotaError(tx.error || new Error('恢复保护日志清理中断'), '清理恢复保护日志')); };
    });
    if (await readRecoveryJournal() !== null) throw new Error('恢复保护日志删除后回读仍然存在');
  }
  async function estimateStorage() {
    if (!global.navigator || !global.navigator.storage || typeof global.navigator.storage.estimate !== 'function') return { supported: false, usage: null, quota: null, percent: null };
    try {
      var result = await global.navigator.storage.estimate();
      var usage = Number(result && result.usage), quota = Number(result && result.quota);
      return { supported: true, usage: Number.isFinite(usage) ? usage : null, quota: Number.isFinite(quota) ? quota : null, percent: Number.isFinite(usage) && Number.isFinite(quota) && quota > 0 ? usage / quota : null };
    } catch (error) { return { supported: true, error: error.message || String(error), usage: null, quota: null, percent: null }; }
  }
  function normalizeQuotaError(error, context) {
    var name = error && error.name || '';
    var message = error && error.message || String(error || '未知错误');
    if (name === 'QuotaExceededError' || /quota|storage.*full|disk.*full|存储空间不足|配额/i.test(message)) {
      return new Error((context ? context + '：' : '') + '设备本地存储空间不足，数据没有确认写入。请先导出备份，再清理不需要的媒体或字体后重试。');
    }
    return error instanceof Error ? error : new Error(message);
  }

  var api = {
    ownerId: ownerId,
    ready: ready,
    isWritable: isWritable,
    assertWritable: assertWritable,
    beginMutation: beginMutation,
    markDataChanged: markDataChanged,
    setRecoveryBlocked: setBlocked,
    reportStorageDamage: reportStorageDamage,
    getStatus: function () { return { ready: readyResolved, writable: writable, startupComplete: startupComplete, blocked: permanentlyBlocked, promotionAvailable: promotionAvailable, reason: blockReason, ownerId: ownerId }; },
    completeStartup: completeStartup,
    saveRecoveryJournal: saveRecoveryJournal,
    readRecoveryJournal: readRecoveryJournal,
    markRecoveryCommitted: markRecoveryCommitted,
    clearRecoveryJournal: clearRecoveryJournal,
    estimateStorage: estimateStorage,
    normalizeQuotaError: normalizeQuotaError,
    journalId: JOURNAL_ID,
    journalDatabaseName: JOURNAL_DB,
    fallbackDatabaseName: FALLBACK_DB
  };
  global.__duoRuntimeCoordinator = api;

  acquireWriter().then(function (got) {
    if (!readyResolved) { readyResolved = true; readyResolve({ writable: !!got, reason: blockReason }); }
    if (!got) updateBanner();
  }).catch(function (error) {
    setWritable(false, error.message || '无法确认跨标签页写入权');
    scheduleRetry();
  });
})(window);
