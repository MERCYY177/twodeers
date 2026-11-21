import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const activity = fs.readFileSync(path.join(root, 'android-apps/app/src/main/java/com/mercyy/twodeers/MainActivity.java'), 'utf8');

// Legacy JSON exports must carry the first-party appearance settings in both
// chat and parameter archives, and both import routes must restore the field.
assert.ok((index.match(/appearanceSettings:stateSnapshot\.appearanceSettings/g) || []).length >= 2,
  'legacy chat and parameter JSON exports must contain appearanceSettings');
assert.equal((index.match(/importLegacyAppearanceSettings\(data\)/g) || []).length, 3,
  'legacy chat and parameter imports must both consume appearanceSettings');
assert.match(index, /function importLegacyAppearanceSettings\(data\)\{[\s\S]*?state\.appearanceSettings=\{\.\.\.data\.appearanceSettings\};/);
assert.match(index, /function refreshRestoredAppearance\(\)\{[\s\S]*?window\.DuoAppearance\.apply\(false\)/);
assert.ok((index.match(/refreshRestoredAppearance\(\)/g) || []).length >= 5,
  'legacy success and rollback paths must all re-apply the resolved appearance');

// Execute the real helper functions from the page source, rather than testing
// a duplicated implementation in this test file.
function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `missing function: ${signature}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated function: ${signature}`);
}
const helpers = [
  extractFunction(index, 'function importLegacyAppearanceSettings(data)'),
  extractFunction(index, 'function refreshRestoredAppearance()'),
].join('\n');
const helperContext = {
  state: { appearanceSettings: { mode: 'system', palette: 'sage' } },
  window: { DuoAppearance: { calls: 0, apply(saveNow) { this.calls++; this.lastSaveNow = saveNow; } } },
};
vm.createContext(helperContext);
vm.runInContext(helpers, helperContext, { filename: 'legacy-appearance-helpers.js' });
assert.equal(helperContext.importLegacyAppearanceSettings({ appearanceSettings: { mode: 'dark', palette: 'cream' } }), true);
assert.deepEqual({ ...helperContext.state.appearanceSettings }, { mode: 'dark', palette: 'cream' });
assert.equal(helperContext.importLegacyAppearanceSettings({ appearanceSettings: [] }), false,
  'malformed array appearance settings must not replace current settings');
assert.deepEqual({ ...helperContext.state.appearanceSettings }, { mode: 'dark', palette: 'cream' });
helperContext.refreshRestoredAppearance();
assert.equal(helperContext.window.DuoAppearance.calls, 1);
assert.equal(helperContext.window.DuoAppearance.lastSaveNow, false);

// Run the actual visitor timer callback extracted from the Circle runtime.
// The hidden-page and restore-pause guards must prevent hidden/stale writes.
const timerStart = index.indexOf('visitorTimer=setInterval(()=>{');
const timerEnd = index.indexOf('},60000);', timerStart);
assert.ok(timerStart >= 0 && timerEnd > timerStart, 'visitor minute timer must be locatable');
const timerBodyStart = index.indexOf('{', timerStart) + 1;
const visitorTickBody = index.slice(timerBodyStart, timerEnd);
function runVisitorTick({ hidden, restorePaused, lastOnlineAt = 1000, now = 2000 }) {
  const state = { visitorLastOnlineAt: lastOnlineAt, visitorNextAt: 5000 };
  let saves = 0;
  let renders = 0;
  const sandbox = {
    document: { hidden },
    window: { __duoCircleRestorePaused: restorePaused },
    state,
    Date: { now: () => now },
    save() { saves++; return true; },
    renderVisitorBadge() { renders++; },
    todayCount() { return 0; },
    VISITOR_MAX_PER_DAY: 10,
    Math,
  };
  vm.createContext(sandbox);
  vm.runInContext(`(()=>{${visitorTickBody}\n})()`, sandbox, { filename: 'circle-visitor-minute-tick.js' });
  return { state, saves, renders };
}
const hiddenTick = runVisitorTick({ hidden: true, restorePaused: false });
assert.equal(hiddenTick.state.visitorLastOnlineAt, 1000, 'hidden timer must not overwrite the timestamp captured when the app was left');
assert.equal(hiddenTick.saves, 0, 'hidden timer must not write visitor state');
const restoreTick = runVisitorTick({ hidden: false, restorePaused: true });
assert.equal(restoreTick.state.visitorLastOnlineAt, 1000, 'backup restore pause must also suspend visitor timer');
assert.equal(restoreTick.saves, 0, 'visitor timer must not race Circle backup restore');
const foregroundTick = runVisitorTick({ hidden: false, restorePaused: false });
assert.equal(foregroundTick.state.visitorLastOnlineAt, 2000, 'foreground timer should continue tracking online time');
assert.equal(foregroundTick.saves, 1);
assert.equal(foregroundTick.renders, 1);
assert.match(index, /document\.addEventListener\('visibilitychange',\(\)=>\{if\(!window\.__duoRuntimeCoordinator\?\.isWritable\?\.\(\)\)return;if\(document\.hidden\)\{state\.visitorLastOnlineAt=Date\.now\(\);save\(\);\}else\{generateOfflineVisitors\(\);renderVisitorBadge\(\);\}\}\);/,
  'visibility transition must capture departure time and run offline catch-up only for the active writer tab');

// WebView must receive Activity pause/resume notifications; do not globally
// pause all WebView timers because app-owned due-time handlers use visibility guards.
const pause = activity.match(/protected void onPause\(\)\s*\{([\s\S]*?)\n    \}/);
const resume = activity.match(/protected void onResume\(\)\s*\{([\s\S]*?)\n    \}/);
assert.ok(pause && /webView\.onPause\(\)/.test(pause[1]));
assert.ok(resume && /webView\.onResume\(\)/.test(resume[1]));
assert.ok(pause[1].indexOf('webView.onPause()') < pause[1].indexOf('super.onPause()'));
assert.ok(resume[1].indexOf('super.onResume()') < resume[1].indexOf('webView.onResume()'));

console.log('PASS: legacy JSON appearance export/import and restore refresh; malformed settings rejection; visitor timer hidden/restore-pause guards; foreground time tracking; WebView Activity pause/resume forwarding.');
