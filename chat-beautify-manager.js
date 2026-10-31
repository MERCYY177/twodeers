/* 独立聊天 CSS 美化管理器：不接管主题色、不修改聊天数据或媒体存储。 */
(function () {
  'use strict';

  const presets = Array.isArray(window.DuoChatBeautifyPresets) ? window.DuoChatBeautifyPresets : [];
  const validPresets = presets.filter(item =>
    item && /^[a-z0-9-]+$/.test(item.id || '') &&
    typeof item.name === 'string' && typeof item.css === 'string' &&
    item.css.length > 300 && item.css.includes('.msg-row.me .bubble') &&
    item.css.includes('.msg-row.other .bubble')
  );
  const classPrefix = 'duo-chat-beautify--';
  const classNames = validPresets.map(item => classPrefix + item.id);
  const activeClass = id => classPrefix + id;
  const $ = selector => document.querySelector(selector);
  const escapeHtml = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);

  function installPresetCss() {
    let style = $('#duoChatBeautifyPresetStyles');
    if (!style) {
      style = document.createElement('style');
      style.id = 'duoChatBeautifyPresetStyles';
      const customStyle = $('#customStyle');
      if (customStyle && customStyle.parentNode) customStyle.parentNode.insertBefore(style, customStyle);
      else document.head.appendChild(style);
    }
    style.textContent = validPresets.map(item => '/* ' + item.id + ' · ' + item.name + ' */\n' + item.css).join('\n\n');
  }

  function applyToChat(id) {
    const chatList = $('#chatList');
    const chatPage = $('#chatPage');
    if (!chatList || !chatPage) return false;
    classNames.forEach(name => {
      chatList.classList.remove(name);
      chatPage.classList.remove(name);
    });
    if (id && validPresets.some(item => item.id === id)) {
      const className = activeClass(id);
      chatList.classList.add(className);
      chatPage.classList.add(className);
      return true;
    }
    return !id;
  }

  function selectedId() {
    const value = typeof state === 'object' && state ? state.chatBeautifyPresetId : '';
    return validPresets.some(item => item.id === value) ? value : '';
  }

  function setSelected(id, notify) {
    if (id && !validPresets.some(item => item.id === id)) return;
    state.chatBeautifyPresetId = id || '';
    applyToChat(state.chatBeautifyPresetId);
    renderCardStates();
    updateStatus();
    if (typeof save === 'function') save();
    if (notify && typeof showToast === 'function') {
      const item = validPresets.find(entry => entry.id === id);
      showToast(item ? '已应用聊天美化：' + item.name : '已恢复聊天默认样式');
    }
  }

  function previewMarkup(item) {
    const scope = activeClass(item.id);
    return '<div class="duo-chat-beautify-preview ' + scope + '">' +
      '<div class="msg-row other"><div class="chat-avatar"><span>对</span></div><div class="bubble-wrap"><div class="bubble">今天的天空很漂亮，想和你分享。</div><div class="meta"><span class="time">20:18</span></div></div></div>' +
      '<div class="msg-row me"><div class="bubble-wrap"><div class="bubble">我也看到了！晚一点一起散步吧。</div><div class="meta"><span class="meta-line"><span class="time">20:19</span><span class="read-flag">已读</span></span></div></div><div class="chat-avatar"><span>我</span></div></div>' +
      '<div class="duo-chat-preview-composer"><div class="input-shell"><span>输入消息…</span><span>☺</span></div></div>' +
      '</div>';
  }

  function buildPanel() {
    const host = $('#settingsParam');
    if (!host || $('#duoChatBeautifyPanel')) return;
    const categories = ['全部', ...new Set(validPresets.map(item => item.category || '其他'))];
    const panel = document.createElement('section');
    panel.id = 'duoChatBeautifyPanel';
    panel.className = 'panel-card duo-chat-beautify-manager';
    panel.innerHTML =
      '<div class="duo-chat-beautify-head">' +
        '<div><h3>CSS 聊天美化</h3><p>独立设计每一套消息气泡、布局、边框、头像、时间状态和输入栏。预览使用真实 CSS 规则。</p></div>' +
        '<button type="button" class="duo-chat-beautify-reset" data-beautify-reset>恢复默认</button>' +
      '</div>' +
      '<div class="duo-chat-beautify-toolbar">' +
        '<input type="search" data-beautify-search placeholder="搜索名称、风格或说明…" aria-label="搜索聊天美化方案">' +
        '<select data-beautify-category aria-label="筛选聊天美化风格">' +
          categories.map(category => '<option value="' + escapeHtml(category) + '">' + escapeHtml(category) + '</option>').join('') +
        '</select>' +
      '</div>' +
      '<div class="duo-chat-beautify-status" data-beautify-status aria-live="polite"></div>' +
      '<div class="duo-chat-beautify-grid" data-beautify-grid></div>' +
      '<p class="duo-chat-beautify-footnote">优先级：主题配色仍负责全局颜色变量；本功能独立负责聊天消息结构与装饰。用户原有“自定义 CSS”保留在最高优先层，必要时可继续覆盖内置美化。</p>';
    host.appendChild(panel);
    const search = panel.querySelector('[data-beautify-search]');
    const category = panel.querySelector('[data-beautify-category]');
    search.addEventListener('input', renderCards);
    category.addEventListener('change', renderCards);
    panel.querySelector('[data-beautify-reset]').addEventListener('click', () => setSelected('', true));
    panel.querySelector('[data-beautify-grid]').addEventListener('click', event => {
      const button = event.target.closest('[data-beautify-apply]');
      if (!button) return;
      setSelected(button.getAttribute('data-beautify-apply'), true);
    });
    renderCards();
    updateStatus();
  }

  function renderCards() {
    const panel = $('#duoChatBeautifyPanel');
    if (!panel) return;
    const search = (panel.querySelector('[data-beautify-search]').value || '').trim().toLowerCase();
    const category = panel.querySelector('[data-beautify-category]').value;
    const filtered = validPresets.filter(item => {
      const matchesCategory = category === '全部' || (item.category || '其他') === category;
      const haystack = [item.name, item.category, item.description, item.id].join(' ').toLowerCase();
      return matchesCategory && (!search || haystack.includes(search));
    });
    const grid = panel.querySelector('[data-beautify-grid]');
    grid.innerHTML = filtered.map(item =>
      '<article class="duo-chat-beautify-card" data-preset-card="' + escapeHtml(item.id) + '">' +
        '<div class="duo-chat-beautify-card-title"><strong>' + escapeHtml(item.name) + '</strong><span>' + escapeHtml(item.category || '其他') + '</span></div>' +
        '<p>' + escapeHtml(item.description) + '</p>' +
        previewMarkup(item) +
        '<button type="button" data-beautify-apply="' + escapeHtml(item.id) + '">应用这套美化</button>' +
      '</article>'
    ).join('');
    if (!filtered.length) grid.innerHTML = '<div class="duo-chat-beautify-empty">没有找到匹配的方案。</div>';
    renderCardStates();
    updateStatus();
  }

  function renderCardStates() {
    const current = selectedId();
    const panel = $('#duoChatBeautifyPanel');
    if (!panel) return;
    panel.querySelectorAll('[data-preset-card]').forEach(card => {
      const active = card.getAttribute('data-preset-card') === current;
      card.classList.toggle('is-active', active);
      const button = card.querySelector('[data-beautify-apply]');
      if (button) {
        button.textContent = active ? '当前使用中' : '应用这套美化';
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      }
    });
  }

  function updateStatus() {
    const status = $('[data-beautify-status]');
    if (!status) return;
    const id = selectedId();
    const current = validPresets.find(item => item.id === id);
    status.textContent = current
      ? '当前使用：' + current.name + ' · 已内置 ' + validPresets.length + ' 套独立 CSS 方案'
      : '当前使用：默认聊天样式 · 已内置 ' + validPresets.length + ' 套独立 CSS 方案';
  }

  function installManagerCss() {
    if ($('#duoChatBeautifyManagerStyle')) return;
    const style = document.createElement('style');
    style.id = 'duoChatBeautifyManagerStyle';
    style.textContent = \`
      .duo-chat-beautify-manager{margin-top:16px}
      .duo-chat-beautify-manager .duo-chat-beautify-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
      .duo-chat-beautify-manager .duo-chat-beautify-head h3{margin:0 0 6px}
      .duo-chat-beautify-manager .duo-chat-beautify-head p,.duo-chat-beautify-manager .duo-chat-beautify-footnote{margin:0;color:#827b73;font-size:12px;line-height:1.65}
      .duo-chat-beautify-manager .duo-chat-beautify-reset{flex:0 0 auto;padding:8px 12px;border:1px solid #d8d2c9;border-radius:10px;background:#fff;color:#554d45;font-size:12px}
      .duo-chat-beautify-manager .duo-chat-beautify-toolbar{display:grid;grid-template-columns:minmax(0,1fr) minmax(100px,145px);gap:8px;margin:14px 0 9px}
      .duo-chat-beautify-manager .duo-chat-beautify-toolbar input,.duo-chat-beautify-manager .duo-chat-beautify-toolbar select{width:100%;min-width:0;min-height:38px;padding:8px 10px;border:1px solid #dedbd5;border-radius:10px;background:#fff;color:#443f39;font-size:13px}
      .duo-chat-beautify-manager .duo-chat-beautify-status{margin:8px 0 12px;color:#777167;font-size:12px}
      .duo-chat-beautify-manager .duo-chat-beautify-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
      .duo-chat-beautify-manager .duo-chat-beautify-card{min-width:0;padding:10px;border:1px solid #e5e0d9;border-radius:14px;background:#fff}
      .duo-chat-beautify-manager .duo-chat-beautify-card.is-active{border-color:#8a9c7b;box-shadow:0 0 0 1px #8a9c7b33}
      .duo-chat-beautify-manager .duo-chat-beautify-card-title{display:flex;align-items:flex-start;justify-content:space-between;gap:6px}
      .duo-chat-beautify-manager .duo-chat-beautify-card-title strong{font-size:13px;color:#3b3935;line-height:1.4}
      .duo-chat-beautify-manager .duo-chat-beautify-card-title span{flex:0 0 auto;padding:2px 6px;border-radius:8px;background:#f4f1ec;color:#877f74;font-size:10px}
      .duo-chat-beautify-manager .duo-chat-beautify-card>p{min-height:34px;margin:6px 0 9px;color:#80796f;font-size:11px;line-height:1.55}
      .duo-chat-beautify-manager .duo-chat-beautify-preview{height:172px;overflow:hidden;position:relative;border-radius:10px;display:flex;flex-direction:column;padding:8px!important;gap:4px}
      .duo-chat-beautify-manager .duo-chat-beautify-preview .msg-row{flex:0 0 auto;min-height:45px;max-height:55px;overflow:hidden;margin-bottom:3px!important;gap:5px!important}
      .duo-chat-beautify-manager .duo-chat-beautify-preview .chat-avatar{width:23px;height:23px;min-width:23px;display:flex;align-items:center;justify-content:center;font-size:9px;overflow:hidden}
      .duo-chat-beautify-manager .duo-chat-beautify-preview .bubble-wrap{max-width:82%;min-width:0}
      .duo-chat-beautify-manager .duo-chat-beautify-preview .bubble{font-size:10px!important;line-height:1.35!important;padding:6px 8px!important;overflow:hidden;max-height:35px}
      .duo-chat-beautify-manager .duo-chat-beautify-preview .meta{font-size:8px!important;line-height:1.2!important;margin-top:2px}
      .duo-chat-beautify-manager .duo-chat-beautify-preview .duo-chat-preview-composer{margin-top:auto;padding:5px 6px;border-radius:8px;min-height:27px}
      .duo-chat-beautify-manager .duo-chat-beautify-preview .input-shell{display:flex;align-items:center;justify-content:space-between;padding:4px 7px;min-height:22px;font-size:9px;line-height:1.2}
      .duo-chat-beautify-manager .duo-chat-beautify-card>button{width:100%;margin-top:9px;padding:8px 10px;border:1px solid #ddd7cf;border-radius:9px;background:#f8f6f2;color:#524b43;font-size:12px}
      .duo-chat-beautify-manager .duo-chat-beautify-card.is-active>button{border-color:#879b76;background:#edf2e8;color:#43563c;font-weight:600}
      .duo-chat-beautify-manager .duo-chat-beautify-empty{grid-column:1/-1;padding:20px;text-align:center;color:#877f74;font-size:13px}
      .duo-chat-beautify-manager .duo-chat-beautify-footnote{margin-top:12px}
      @media(max-width:390px){.duo-chat-beautify-manager .duo-chat-beautify-grid{grid-template-columns:1fr}.duo-chat-beautify-manager .duo-chat-beautify-preview{height:164px}}
    \`;
    document.head.appendChild(style);
  }

  function init() {
    if (!validPresets.length || typeof state !== 'object' || typeof save !== 'function') return;
    installPresetCss();
    installManagerCss();
    buildPanel();
    const customStyle = $('#customStyle');
    if (customStyle && customStyle.parentNode) customStyle.parentNode.appendChild(customStyle);
    const id = selectedId();
    applyToChat(id);
    renderCardStates();
    updateStatus();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
  window.DuoChatBeautify = {
    presets: validPresets,
    apply: id => setSelected(id, true),
    reset: () => setSelected('', true),
    getCurrent: selectedId
  };
})();