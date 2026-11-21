/* Minimal ZIP (STORE) builder for isolated recovery candidate packages.
 * It packages the original salvage file byte-for-byte plus a review-only manifest.
 * It never reads or writes the application's localStorage or IndexedDB.
 */
(function (global) {
  'use strict';
  if (global.__duoRecoveryCandidateZipInstalled) return;
  global.__duoRecoveryCandidateZipInstalled = true;

  var CRC_TABLE = new Uint32Array(256);
  for (var n = 0; n < 256; n++) {
    var value = n;
    for (var bit = 0; bit < 8; bit++) value = (value & 1) ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1);
    CRC_TABLE[n] = value >>> 0;
  }

  function updateCrc(crc, bytes) {
    for (var i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return crc >>> 0;
  }
  function crcHex(value) { return (value >>> 0).toString(16).padStart(8, '0'); }
  function utf8(value) {
    var Encoder = global.TextEncoder || (typeof TextEncoder === 'function' ? TextEncoder : null);
    if (!Encoder) throw new Error('当前环境缺少 UTF-8 编码器，无法安全生成候选 ZIP');
    return new Encoder().encode(String(value));
  }
  async function readBlobSlice(blob, start, end) {
    var slice = blob.slice(start, end);
    if (slice && typeof slice.arrayBuffer === 'function') return new Uint8Array(await slice.arrayBuffer());
    if (typeof global.FileReader === 'function') {
      return new Promise(function (resolve, reject) {
        var reader = new global.FileReader();
        reader.onload = function () { resolve(new Uint8Array(reader.result)); };
        reader.onerror = function () { reject(reader.error || new Error('读取候选 ZIP 校验分块失败')); };
        reader.onabort = function () { reject(new Error('候选 ZIP 校验分块读取已取消')); };
        try { reader.readAsArrayBuffer(slice); } catch (error) { reject(error); }
      });
    }
    throw new Error('当前 WebView 不支持分块读取文件；候选包生成已停止，原始救援文件未修改');
  }
  async function crc32Blob(blob) {
    if (!blob || !Number.isSafeInteger(Number(blob.size)) || typeof blob.slice !== 'function') throw new Error('候选 ZIP 条目不是可分块读取的 Blob/File');
    var crc = 0xFFFFFFFF;
    var chunkSize = 1024 * 1024;
    for (var offset = 0; offset < blob.size; offset += chunkSize) {
      var bytes = await readBlobSlice(blob, offset, Math.min(blob.size, offset + chunkSize));
      crc = updateCrc(crc, bytes);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function write16(view, offset, value) { view.setUint16(offset, value & 0xFFFF, true); }
  function write32(view, offset, value) { view.setUint32(offset, value >>> 0, true); }
  function dosDateTime(date) {
    var year = Math.max(1980, Math.min(2107, date.getFullYear()));
    return {
      time: ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | (Math.floor(date.getSeconds() / 2) & 31),
      date: (((year - 1980) & 127) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31)
    };
  }
  function safeEntryName(name) {
    var value = String(name || '');
    if (!value || value.length > 200 || value.startsWith('/') || value.includes('\\') || value.split('/').some(function (part) { return !part || part === '.' || part === '..'; })) {
      throw new Error('候选 ZIP 包含不安全的条目路径');
    }
    return value;
  }
  async function buildStoredZip(entries, maxBytes) {
    if (!Array.isArray(entries) || !entries.length || entries.length > 16) throw new Error('候选 ZIP 条目数量无效');
    var limit = Number.isSafeInteger(maxBytes) && maxBytes > 0 ? maxBytes : 132 * 1024 * 1024;
    var names = new Set();
    var localParts = [];
    var centralParts = [];
    var info = [];
    var offset = 0;
    var centralSize = 0;
    var stamp = dosDateTime(new Date());

    for (var entry of entries) {
      var name = safeEntryName(entry && entry.name);
      if (names.has(name)) throw new Error('候选 ZIP 存在重复文件名：' + name);
      names.add(name);
      var blob = entry && entry.blob;
      if (!blob || !Number.isSafeInteger(Number(blob.size)) || blob.size < 0 || blob.size > 0xFFFFFFFF) throw new Error('候选 ZIP 条目大小无效：' + name);
      var nameBytes = utf8(name);
      if (nameBytes.length > 0xFFFF) throw new Error('候选 ZIP 条目名称过长：' + name);
      var crc = await crc32Blob(blob);
      var size = Number(blob.size);
      var local = new Uint8Array(30 + nameBytes.length);
      var lv = new DataView(local.buffer);
      write32(lv, 0, 0x04034B50);
      write16(lv, 4, 20);
      write16(lv, 6, 0x0800); // UTF-8 filename
      write16(lv, 8, 0); // STORE, no compression
      write16(lv, 10, stamp.time);
      write16(lv, 12, stamp.date);
      write32(lv, 14, crc);
      write32(lv, 18, size);
      write32(lv, 22, size);
      write16(lv, 26, nameBytes.length);
      write16(lv, 28, 0);
      local.set(nameBytes, 30);
      localParts.push(local, blob);

      var central = new Uint8Array(46 + nameBytes.length);
      var cv = new DataView(central.buffer);
      write32(cv, 0, 0x02014B50);
      write16(cv, 4, 20);
      write16(cv, 6, 20);
      write16(cv, 8, 0x0800);
      write16(cv, 10, 0);
      write16(cv, 12, stamp.time);
      write16(cv, 14, stamp.date);
      write32(cv, 16, crc);
      write32(cv, 20, size);
      write32(cv, 24, size);
      write16(cv, 28, nameBytes.length);
      write16(cv, 30, 0);
      write16(cv, 32, 0);
      write16(cv, 34, 0);
      write16(cv, 36, 0);
      write32(cv, 38, 0);
      write32(cv, 42, offset);
      central.set(nameBytes, 46);
      centralParts.push(central);

      offset += local.length + size;
      centralSize += central.length;
      info.push({ name: name, bytes: size, crc32: crcHex(crc), localHeaderOffset: offset - local.length - size });
      if (offset + centralSize + 22 > limit) throw new Error('隔离候选包超过 132 MiB 安全上限；原始救援资料未修改，请先在可信桌面环境拆分资料');
    }

    var endOffset = offset;
    var end = new Uint8Array(22);
    var ev = new DataView(end.buffer);
    write32(ev, 0, 0x06054B50);
    write16(ev, 4, 0);
    write16(ev, 6, 0);
    write16(ev, 8, entries.length);
    write16(ev, 10, entries.length);
    write32(ev, 12, centralSize);
    write32(ev, 16, endOffset);
    write16(ev, 20, 0);

    var BlobCtor = global.Blob || (typeof Blob === 'function' ? Blob : null);
    if (!BlobCtor) throw new Error('当前环境不支持 Blob，无法生成候选包');
    var zipBlob = new BlobCtor(localParts.concat(centralParts, [end]), { type: 'application/zip' });
    if (zipBlob.size > limit) throw new Error('候选 ZIP 超过安全容量上限');
    return { blob: zipBlob, bytes: zipBlob.size, entries: info, compression: 'STORE' };
  }

  global.__duoRecoveryCandidateZip = {
    crc32Blob: crc32Blob,
    crc32Hex: crcHex,
    buildStoredZip: buildStoredZip,
    maxBytes: 132 * 1024 * 1024
  };
})(window);
