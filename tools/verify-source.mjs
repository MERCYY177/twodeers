import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const required = ['appearance-manager.js','custom-font-manager.js','font-panel.js','sticker-library.js','backup-v4.js'];
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
console.log('OK: ' + required.length + ' 个模块已接入；' + inline.length + ' 个 index.html 内联脚本通过语法编译；Android 壳工程关键文件存在。');
