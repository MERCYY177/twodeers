/* Unified file-save entry point for every backup/export surface. */
(function (global) {
  'use strict';
  if (global.BackupFileService) return;

  function isBlobLike(value) {
    if (!value || Object.prototype.toString.call(value) !== '[object Blob]') return false;
    return Number.isSafeInteger(value.size) && value.size >= 0 &&
      typeof value.slice === 'function' &&
      typeof value.arrayBuffer === 'function';
  }

  async function toLocalBlob(value, mimeType) {
    if (!isBlobLike(value)) throw new TypeError('保存内容必须是 Blob');
    if (typeof Blob !== 'undefined' && value instanceof Blob) return value;
    // Blob.prototype.slice performs the platform brand check across realms and returns
    // a Blob in this document's realm without materializing the whole archive in memory.
    try {
      const foreignSlice = Blob.prototype.slice.call(value, 0, value.size, mimeType || value.type || 'application/octet-stream');
      return new Blob([foreignSlice], { type: mimeType || value.type || 'application/octet-stream' });
    } catch (_) {
      // Retain support for trusted Blob-like wrappers used by older embedded WebViews.
      const buffer = await value.arrayBuffer();
      return new Blob([buffer], { type: mimeType || value.type || 'application/octet-stream' });
    }
  }

  function fallbackDownload(name, blob) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = String(name || 'backup.bin');
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    try { anchor.click(); }
    finally {
      anchor.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
    }
    return { status: 'handed-off', method: 'browser-download', name: anchor.download, size: blob.size };
  }

  async function save(name, input, options) {
    options = options || {};
    const blob = await toLocalBlob(input, options.mimeType);
    const safeName = String(name || 'backup.bin').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 180) || 'backup.bin';
    try {
      if (typeof global.triggerDownloadBlob === 'function' &&
          global.triggerDownloadBlob !== save) {
        const accepted = global.triggerDownloadBlob(safeName, blob);
        if (accepted === false) throw new Error('文件保存入口拒绝了该文件');
        if (accepted && typeof accepted.then === 'function') {
          const completed = await accepted;
          return Object.assign({ name: safeName, size: blob.size }, completed || { status: 'handed-off', method: 'platform-adapter' });
        }
        return { status: 'handed-off', method: 'platform-adapter', name: safeName, size: blob.size };
      }
      return fallbackDownload(safeName, blob);
    } catch (error) {
      throw new Error('文件保存失败：' + (error && error.message ? error.message : error));
    }
  }

  global.BackupFileService = Object.freeze({
    save: save,
    isBlobLike: isBlobLike,
    toLocalBlob: toLocalBlob
  });
})(window);
