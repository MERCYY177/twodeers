import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'appearance-manager.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const activity = fs.readFileSync(path.join(root, 'android-apps/app/src/main/java/com/mercyy/twodeers/MainActivity.java'), 'utf8');
const manifest = fs.readFileSync(path.join(root, 'android-apps/app/src/main/AndroidManifest.xml'), 'utf8');
const backup = fs.readFileSync(path.join(root, 'backup-v4.js'), 'utf8');

class FakeElement {
  constructor(id = '') {
    this.id = id;
    this.dataset = {};
    this.style = { values: {}, setProperty(key, value) { this.values[key] = value; } };
    this.classList = {
      values: new Set(),
      toggle(name, force) { if (force) this.values.add(name); else this.values.delete(name); },
      add(name) { this.values.add(name); },
      remove(name) { this.values.delete(name); }
    };
    this.listeners = new Map();
    this.children = [];
    this.parentNode = null;
    this.textContent = '';
    this.value = '';
    this.attributes = {};
  }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(callback);
  }
  dispatch(type, event = {}) {
    for (const callback of this.listeners.get(type) || []) callback(event);
  }
  appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
  insertBefore(child) { return this.appendChild(child); }
  setAttribute(name, value) { this.attributes[name] = value; }
  querySelector(selector) { return this.lookup?.[selector] || null; }
  querySelectorAll(selector) { return selector === 'i' ? (this.dots || []) : []; }
}

function createHarness({ systemDark = true } = {}) {
  const settingsParam = new FakeElement('settingsParam');
  const panel = new FakeElement('duoAppearancePanel');
  const paletteGrid = new FakeElement('duoPaletteGrid');
  const themeMode = new FakeElement('duoThemeMode');
  const backgroundMode = new FakeElement('duoBackgroundMode');
  const bubbleStyle = new FakeElement('duoBubbleStyle');
  panel.lookup = {
    '#duoPaletteGrid': paletteGrid,
    '#duoThemeMode': themeMode,
    '#duoBackgroundMode': backgroundMode,
    '#duoBubbleStyle': bubbleStyle
  };
  const rootStyle = { values: {}, colorScheme: '', setProperty(key, value) { this.values[key] = value; } };
  const documentElement = { dataset: {}, style: rootStyle };
  const body = { classList: new FakeElement('body').classList };
  const head = new FakeElement('head');
  const customStyle = new FakeElement('customStyle');
  customStyle.parentNode = head;
  const circleMount = new FakeElement('circleMount');
  const elements = new Map([
    ['settingsParam', settingsParam], ['duoAppearancePanel', null],
    ['duoThemeMode', themeMode], ['duoBackgroundMode', backgroundMode],
    ['duoBubbleStyle', bubbleStyle], ['customStyle', customStyle], ['circleMount', circleMount]
  ]);
  const paletteButtons = [];
  const document = {
    readyState: 'complete',
    documentElement,
    body,
    head,
    createElement(tag) {
      const element = new FakeElement();
      if (tag === 'section') {
        element.lookup = panel.lookup;
        element.querySelectorAll = () => [];
      }
      return element;
    },
    getElementById(id) {
      if (id === 'duoAppearancePanel') return elements.get(id);
      if (id === 'duoAppearanceThemeStyle' || id === 'duoAppearancePanelStyle') {
        return head.children.find(child => child.id === id) || null;
      }
      return elements.get(id) || null;
    },
    querySelectorAll(selector) { return selector === '[data-duo-palette]' ? paletteButtons : []; },
    addEventListener() {}
  };
  const originalCreateElement = document.createElement.bind(document);
  document.createElement = (tag) => {
    const element = originalCreateElement(tag);
    if (tag === 'section') {
      element.id = 'duoAppearancePanel';
      element.lookup = panel.lookup;
      element.querySelectorAll = () => [];
    }
    if (tag === 'button') {
      const dots = [new FakeElement(), new FakeElement(), new FakeElement()];
      element.dots = dots;
      element.querySelectorAll = selector => selector === 'i' ? dots : [];
      paletteButtons.push(element);
    }
    return element;
  };
  const originalAppend = head.appendChild.bind(head);
  head.appendChild = (child) => {
    const result = originalAppend(child);
    if (child.id === 'duoAppearancePanelStyle' || child.id === 'duoAppearanceThemeStyle') elements.set(child.id, child);
    return result;
  };
  const originalInsert = settingsParam.insertBefore.bind(settingsParam);
  settingsParam.insertBefore = (child) => {
    elements.set('duoAppearancePanel', child);
    return originalInsert(child);
  };

  const media = {
    matches: systemDark,
    listener: null,
    addEventListener(type, callback) { if (type === 'change') this.listener = callback; }
  };
  const nativeCalls = [];
  const window = {
    matchMedia() { return media; },
    DuoThemeBridge: {
      applyResolvedTheme(mode, color) { nativeCalls.push({ mode, color }); }
    }
  };
  const state = {
    appearanceColors: { theme: '#123456', buttonBg: '#654321', buttonText: '#fefefe' },
    appearanceSettings: { mode: 'system', palette: 'sage', background: 'soft', bubbleStyle: 'soft' }
  };
  let saveCalls = 0;
  const context = {
    window, document, state,
    normalizeHex(value) { return /^#[0-9a-fA-F]{6}$/.test(String(value || '')) ? String(value).toLowerCase() : ''; },
    save() { saveCalls++; return true; },
    console
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'appearance-manager.js' });
  return { state, documentElement, circleMount, themeMode, backgroundMode, bubbleStyle, media, nativeCalls, paletteButtons, themeCss: () => head.children.find(child => child.id === 'duoAppearanceThemeStyle')?.textContent || '', getSaveCalls: () => saveCalls };
}

const app = createHarness({ systemDark: true });
assert.equal(app.documentElement.dataset.duoThemeMode, 'system');
assert.equal(app.documentElement.dataset.duoThemeResolved, 'dark', 'system dark mode must resolve from matchMedia');
assert.equal(app.documentElement.style.colorScheme, 'dark');
assert.equal(app.nativeCalls.at(-1).mode, 'dark', 'native system bars must receive the resolved dark mode');
assert.equal(app.nativeCalls.at(-1).color, '#151a15');
assert.equal(app.circleMount.dataset.duoThemeResolved, 'dark', 'Circle shadow host must use the same resolved mode');
app.backgroundMode.dispatch('change', { target: { value: 'plain' } });
assert.equal(app.nativeCalls.at(-1).color, '#202820', 'plain page background must use the palette panel color for native bars');
app.backgroundMode.dispatch('change', { target: { value: 'soft' } });
assert.match(app.themeCss(), /--theme-color:#123456/, 'legacy custom theme color must remain authoritative');
assert.match(app.themeCss(), /--button-bg:#654321/, 'legacy custom button color must remain authoritative');

// Switching OS appearance updates the page only while the selected mode is system.
app.media.matches = false;
app.media.listener({ matches: false });
assert.equal(app.documentElement.dataset.duoThemeResolved, 'light');
assert.equal(app.nativeCalls.at(-1).mode, 'light');

// Manual dark/light always overrides the system preference and updates native bars.
app.themeMode.dispatch('change', { target: { value: 'dark' } });
assert.equal(app.state.appearanceSettings.mode, 'dark');
assert.equal(app.documentElement.dataset.duoThemeResolved, 'dark');
assert.equal(app.nativeCalls.at(-1).mode, 'dark');
app.media.matches = true;
app.media.listener({ matches: true });
assert.equal(app.documentElement.dataset.duoThemeResolved, 'dark', 'system changes must not override manually selected dark mode');

app.themeMode.dispatch('change', { target: { value: 'light' } });
assert.equal(app.documentElement.dataset.duoThemeResolved, 'light', 'manual light must remain light even on a dark system');
assert.equal(app.nativeCalls.at(-1).mode, 'light');
assert.ok(app.getSaveCalls() >= 2, 'manual mode changes must persist through the existing save path');

// Returning to system restores OS-following behavior; all palettes keep both variants.
app.themeMode.dispatch('change', { target: { value: 'system' } });
assert.equal(app.documentElement.dataset.duoThemeResolved, 'dark');
app.media.matches = false;
app.media.listener({ matches: false });
assert.equal(app.documentElement.dataset.duoThemeResolved, 'light');
assert.equal(app.paletteButtons.length, 9, 'all existing palette choices must remain present');

// Dark-mode behavior is now keyed to the app's resolved theme, not raw OS preference.
assert.match(index, /<meta name="color-scheme" content="light dark"\/>/);
assert.doesNotMatch(index, /@media\s*\(prefers-color-scheme\s*:/, 'all page-specific media styling must follow the resolved user setting');
assert.match(index, /:root\[data-duo-theme-resolved="dark"\]/);
assert.match(index, /:host\(\[data-duo-theme-resolved="dark"\]\)/);
assert.match(source, /window\.DuoThemeBridge/);
assert.match(source, /mediaQuery\.addListener/);
assert.match(backup, /appearanceSettings:stateSnapshot\.appearanceSettings/);
assert.match(backup, /init\(\);window\.DuoAppearance\?\.apply\(false\)/, 'V4 restore must apply the imported appearance immediately');
assert.match(backup, /'appearanceSettings'/);
assert.equal((backup.match(/window\.DuoAppearance\?\.apply\(false\)/g) || []).length, 3, 'V4 restore, in-page rollback, and crash-recovery rollback must all re-apply the active theme');

// Native configuration uses night-qualified resources, exposes the narrow theme bridge,
// and disables browser-side algorithmic inversion in favor of the first-party palette.
assert.match(manifest, /android:theme="@style\/AppTheme"/);
const activityConfigChanges = manifest.match(/android:configChanges="([^"]+)"/)?.[1] || '';
assert.doesNotMatch(activityConfigChanges, /\buiMode\b/, 'system night changes must recreate Activity so the qualified native theme is reloaded');
assert.match(activity, /new ThemeBridge\(\), "DuoThemeBridge"/);
assert.match(activity, /applyResolvedTheme\(String resolvedMode, String backgroundColor\)/);
assert.match(activity, /setAlgorithmicDarkeningAllowed\(settings, false\)/);
assert.match(activity, /setForceDarkAllowed\(false\)/);
assert.match(activity, /setSystemBarsAppearance\(appearance, mask\)/);
for (const resource of [
  'android-apps/app/src/main/res/values/styles.xml',
  'android-apps/app/src/main/res/values-night/styles.xml',
  'android-apps/app/src/main/res/values-v26/styles.xml',
  'android-apps/app/src/main/res/values-night-v26/styles.xml'
]) {
  assert.ok(fs.statSync(path.join(root, resource)).isFile(), `missing DayNight resource: ${resource}`);
}
const lightTheme = fs.readFileSync(path.join(root, 'android-apps/app/src/main/res/values/styles.xml'), 'utf8');
const darkTheme = fs.readFileSync(path.join(root, 'android-apps/app/src/main/res/values-night/styles.xml'), 'utf8');
const lightV26Theme = fs.readFileSync(path.join(root, 'android-apps/app/src/main/res/values-v26/styles.xml'), 'utf8');
assert.match(lightTheme, /Theme\.Material\.Light\.NoActionBar/);
assert.match(darkTheme, /Theme\.Material\.NoActionBar/);
assert.match(lightV26Theme, /windowLightNavigationBar/);
assert.match(activity, /value\.length\(\) == 7/);

console.log('PASS: system/light/dark resolution, OS-change handling, manual override, native bar sync, Circle theme sync, legacy custom-color preservation, V4 theme persistence, and Android DayNight/WebView darkening guards.');
