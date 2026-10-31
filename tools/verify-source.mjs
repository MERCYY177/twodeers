import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const required = ['appearance-manager.js','custom-font-manager.js','font-panel.js','sticker-library.js','backup-snapshot-coordinator.js','backup-file-service.js','backup-v4.js'];
for (const file of required) {
  const source = readFileSync(resolve(root, file), 'utf8');
  new vm.Script(source, { filename: file });
  if (!html.includes('src="' + file + '"')) throw new Error('index.html 未接入 ' + file);
}
const inline = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
inline.forEach((match, index) => new vm.Script(match[1], { filename: 'index.html:inline-' + index }));
if (inline.length < 3) throw new Error('主页面脚本块数量异常');
for (const path of ['android-apps/app/src/main/java/com/mercyy/twodeers/MainActivity.java',
                    'android-apps/app/src/main/AndroidManifest.xml']) {
  if (!readFileSync(resolve(root, path), 'utf8').length) throw new Error('缺少 Android 文件：' + path);
}
const mainScript = inline.map(x => x[1]).join('\n');
if (!mainScript.includes('initializeIncomingCallScheduler') || !mainScript.includes('triggerIncomingCall')) throw new Error('主动来电现有逻辑缺失');
if (!html.includes('emoji-panel-columns') || !html.includes('emoji-column-stickers')) throw new Error('原有双列表情包布局被改变');
const fileService = readFileSync(resolve(root, 'backup-file-service.js'), 'utf8');
if (!fileService.includes('BackupFileService') || !fileService.includes('toLocalBlob')) throw new Error('统一文件保存服务关键能力缺失');
if (html.indexOf('src="backup-snapshot-coordinator.js"') < 0 || html.indexOf('src="backup-snapshot-coordinator.js"') > html.indexOf('src="backup-v4.js"')) throw new Error('快照协调器必须在 V4 备份模块之前加载');
if (html.indexOf('src="backup-file-service.js"') < 0 || html.indexOf('src="backup-file-service.js"') > html.indexOf('src="backup-v4.js"')) throw new Error('统一文件保存服务必须在 V4 备份模块之前加载');
const v4 = readFileSync(resolve(root, 'backup-v4.js'), 'utf8');
if (!html.includes('BackupFileService.save') || !v4.includes('BackupFileService.save')) throw new Error('Circle / 旧 JSON / V4 备份未统一接入文件保存服务');
for (const token of ['SHA-256','crc32','manifest.json','applyBackupPayload','font-library.json','beginSnapshot','assertUnchanged','BackupFileService.save']) {
  if (!v4.includes(token)) throw new Error('V4 备份关键能力缺失：' + token);
}
const native = readFileSync(resolve(root, 'android-apps/app/src/main/java/com/mercyy/twodeers/MainActivity.java'), 'utf8');
for (const token of ['onShowFileChooser','ACTION_CREATE_DOCUMENT','triggerDownloadBlob','writeChunk','finishSave']) {
  if (!native.includes(token)) throw new Error('Android 文件桥接缺失：' + token);
}
console.log('OK: ' + required.length + ' 个模块已接入；' + inline.length + ' 个 index.html 内联脚本通过语法编译；来电/双列表情包/V4/Android 关键入口静态检查通过。');
