import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const pseudoDecoration = (media, side) => {
  const content = media[side + 'Content'];
  const display = media[side + 'Display'] || 'inline';
  const visibility = media[side + 'Visibility'] || 'visible';
  const opacity = Number.parseFloat(media[side + 'Opacity'] ?? '1');
  const width = Number.parseFloat(media[side + 'Width']) || 0;
  const height = Number.parseFloat(media[side + 'Height']) || 0;
  const backgroundImage = media[side + 'BackgroundImage'] || 'none';
  const backgroundColor = media[side + 'BackgroundColor'] || 'transparent';
  const borderImageSource = media[side + 'BorderImageSource'] || 'none';
  const borderStyles = ['Top','Right','Bottom','Left'].map(edge => media[side + 'Border' + edge + 'Style'] || 'none');
  const borderWidths = ['Top','Right','Bottom','Left'].map(edge => Number.parseFloat(media[side + 'Border' + edge + 'Width']) || 0);
  const boxShadow = media[side + 'BoxShadow'] || 'none';
  const generated = !['none','normal'].includes(content);
  const emptyContent = content === '""' || content === "''" || content === '';
  const hasBox = !['none','contents'].includes(display) && visibility !== 'hidden' && visibility !== 'collapse' && opacity > 0;
  const hasDimensions = width > 0 && height > 0;
  const transparentColor = backgroundColor === 'transparent' || /rgba?\\([^)]*,\\s*0(?:\\.0+)?\\s*\\)$/.test(backgroundColor);
  const hasVisibleBackground = backgroundImage !== 'none' || !transparentColor;
  const hasVisibleBorder = borderImageSource !== 'none' || borderStyles.some((style,index) => !['none','hidden'].includes(style) && borderWidths[index] > 0);
  const visible = hasBox && generated && (!emptyContent || (hasDimensions && (hasVisibleBackground || hasVisibleBorder || boxShadow !== 'none')));
  return {visible,content,display,visibility,opacity,width:media[side + 'Width'],height:media[side + 'Height'],backgroundImage,backgroundColor,borderImageSource,borderStyles,borderWidths,boxShadow};
};
const emptyContentImagePseudo = {
  beforeContent:'""',beforeDisplay:'block',beforeVisibility:'visible',beforeOpacity:'1',
  beforeWidth:'24px',beforeHeight:'18px',beforeBackgroundImage:'url("fixture.png")',
  beforeBackgroundColor:'rgba(0, 0, 0, 0)',beforeBorderImageSource:'none',
  beforeBorderTopStyle:'none',beforeBorderTopWidth:'0px',beforeBorderRightStyle:'none',beforeBorderRightWidth:'0px',
  beforeBorderBottomStyle:'none',beforeBorderBottomWidth:'0px',beforeBorderLeftStyle:'none',beforeBorderLeftWidth:'0px',
  beforeBoxShadow:'none'
};
assert.equal(pseudoDecoration(emptyContentImagePseudo,'before').visible,true,
  'empty content with a background image and non-zero dimensions must be visible');
assert.equal(pseudoDecoration({...emptyContentImagePseudo,beforeContent:'none'},'before').visible,false,
  'content:none must not generate a visible pseudo-element');
assert.equal(pseudoDecoration({...emptyContentImagePseudo,beforeContent:'normal'},'before').visible,false,
  'content:normal must not generate a visible pseudo-element');

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-dev-shm-usage'] });
const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
const page = await context.newPage();
const pageErrors = [];
const consoleErrors = [];
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('pageerror', error => pageErrors.push(error.message));

try {
  await page.goto('http://127.0.0.1:8080/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() =>
    !!window.__duoBackupV4 &&
    !!window.ChuanXunFontManager &&
    !!document.getElementById('duoThemeMode') &&
    !!document.getElementById('duoFontPanel'),
    { timeout: 15000 }
  );

  const baseline = await page.evaluate(() => ({
    circleApi: !!window.__duoCircleApi?.validateState,
    twoColumns: document.querySelectorAll('#emojiPanel .emoji-panel-columns > .emoji-column').length,
    tabs: document.querySelectorAll('#duoStickerTabs [data-duo-sticker-tab]').length,
    backupVersion: window.__duoBackupV4.version
  }));
  assert.equal(baseline.circleApi, true, 'Circle Shadow DOM API should be available');
  assert.equal(baseline.twoColumns, 2, 'the original two-column emoji panel must remain');
  const stickerPanel = await page.locator('#emojiPanel').innerText();
  assert.match(stickerPanel, /常用 Emoji/);
  assert.match(stickerPanel, /我的上传/);
  assert.match(stickerPanel, /收藏/);
  assert.doesNotMatch(stickerPanel, /内置表情/);
  assert.equal(await page.locator('#duoStickerTabs [data-duo-sticker-tab="builtin"]').count(), 0);
  assert.equal(await page.locator('.duo-sticker-notice').count(), 0);
  assert.equal(baseline.tabs, 2, 'only uploads and favorites tabs should be mounted');
  assert.equal(baseline.backupVersion, 4);

  const exposeBeautifySettings = () => page.evaluate(() => {
    if (typeof goto === 'function') goto('settingsPage');
    const panel = document.getElementById('settingsParam');
    if (panel) {
      panel.hidden = false;
      panel.classList.remove('hidden');
      panel.style.setProperty('display', 'block', 'important');
      panel.style.setProperty('visibility', 'visible', 'important');
    }
  });
  await exposeBeautifySettings();
  const beautifyBefore = await page.evaluate(() => ({
    count: window.DuoChatBeautify.presets.length,
    selectedId: state.chatBeautifyPresetId || '',
    customCSS: state.customCSS || '',
    stylePresent: !!document.getElementById('duoChatBeautifyPresetStyles'),
    styleRules: document.getElementById('duoChatBeautifyPresetStyles')?.sheet?.cssRules?.length || 0,
    cards: document.querySelectorAll('#duoChatBeautifyPanel [data-preset-card]').length,
    cssPriority: (() => {
      const ids = [...document.head.querySelectorAll('style')].map(node => node.id);
      return ids.indexOf('duoChatBeautifyPresetStyles') >= 0 &&
        ids.lastIndexOf('customStyle') > ids.indexOf('duoChatBeautifyPresetStyles');
    })()
  }));
  assert.deepEqual(await page.evaluate(() => window.DuoChatBeautify.presets.map(item => item.id)), ["ink-minimal","rose-letter","blue-imessage","mint-sms","carbon-glass","miffy-memo","x-blue-dm","x-night-dm","whatsapp-tails","miu-pink-sms","miu-blue-sms","leaf-garden","ios6-bluegray","wechat-moon","pink-lemon","rabbit-milk","line-kitty","pink-gray-stars","picture-frame","soft-double-frame","line-cat-milk"]);
  assert.equal(beautifyBefore.count, 21, 'exactly 21 approved CSS designs should be loaded');
  assert.equal(beautifyBefore.count, beautifyBefore.cards, 'each approved preset must have a live CSS preview card');
  assert.equal(beautifyBefore.stylePresent, true, 'preset CSS must be injected into the real page');
  assert.ok(beautifyBefore.styleRules > 100, 'browser must parse all 21 source stylesheets');
  assert.equal(beautifyBefore.cssPriority, true, 'user custom CSS must remain after built-in preset styles');

  await page.evaluate(() => window.DuoChatBeautify.reset());
  await page.evaluate(() => goto('chatPage'));
  const baselineMedia = await page.evaluate(() => {
    const chat = document.getElementById('chatList');
    const gif = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    const add = (id, message) => {
      const row = buildMessageRow(Object.assign({id, sender:'me', time:'20:18'}, message));
      row.dataset.beautifySmokeId = id;
      chat.appendChild(row);
      return row;
    };
    add('beautify-smoke-own', {type:'text',text:'发送方普通文字：今晚一起散步吧。'});
    add('beautify-smoke-other', {sender:'other',type:'text',text:'接收方普通文字：当然可以。'});
    add('beautify-smoke-image', {type:'image',url:gif});
    const videoRow = add('beautify-smoke-video', {type:'video'});
    const videoBubble = videoRow.querySelector('.bubble');
    videoBubble.className = 'bubble video-bubble';
    videoBubble.innerHTML = '<video class="message-video" controls playsinline preload="none"></video>';
    const audioRow = add('beautify-smoke-audio', {type:'audio'});
    const audioBubble = audioRow.querySelector('.bubble');
    audioBubble.className = 'bubble audio-bubble';
    audioBubble.innerHTML = '<div class="audio-message"><span class="voice-icon" aria-hidden="true">♫</span><span>语音消息 · 1 秒</span><audio controls preload="none"></audio></div>';
    add('beautify-smoke-sticker', {sender:'other',type:'sticker',url:gif});
    add('beautify-smoke-pending', {sender:'other',type:'image'});
    const cardRow = add('beautify-smoke-card', {type:'text',text:'卡片消息：商品信息'});
    const cardBubble = cardRow.querySelector('.bubble');
    cardBubble.className = 'bubble xiaoshu-card-message-outer';
    cardBubble.innerHTML = '<div class="message-card"><strong>商品卡片</strong><span>卡片专属布局</span></div>';
    const system = buildMessageRow({id:'beautify-smoke-system',type:'system',text:'系统消息：测试开始'});
    system.dataset.beautifySmokeId = 'beautify-smoke-system';
    chat.appendChild(system);
    const metric = bubble => {
      const style = getComputedStyle(bubble);
      return {
        color:style.color,fontSize:style.fontSize,fontWeight:style.fontWeight,lineHeight:style.lineHeight,
        backgroundColor:style.backgroundColor,backgroundImage:style.backgroundImage,
        borderTopColor:style.borderTopColor,
        borderTopStyle:style.borderTopStyle,
        borderTopWidth:style.borderTopWidth,
        boxShadow:style.boxShadow,
        borderRadius:style.borderRadius,
        paddingTop:style.paddingTop,
        paddingRight:style.paddingRight,
        paddingBottom:style.paddingBottom,
        paddingLeft:style.paddingLeft,
        beforeContent:getComputedStyle(bubble,'::before').content,
        beforeDisplay:getComputedStyle(bubble,'::before').display,
        afterContent:getComputedStyle(bubble,'::after').content,
        afterDisplay:getComputedStyle(bubble,'::after').display
      };
    };
    const mediaMetric = bubble => {
      const style = getComputedStyle(bubble);
      const before = getComputedStyle(bubble,'::before');
      const after = getComputedStyle(bubble,'::after');
      return {
        backgroundColor:style.backgroundColor,backgroundImage:style.backgroundImage,
        borderTopStyle:style.borderTopStyle,borderTopWidth:style.borderTopWidth,
        borderRightStyle:style.borderRightStyle,borderRightWidth:style.borderRightWidth,
        borderBottomStyle:style.borderBottomStyle,borderBottomWidth:style.borderBottomWidth,
        borderLeftStyle:style.borderLeftStyle,borderLeftWidth:style.borderLeftWidth,
        boxShadow:style.boxShadow,outlineStyle:style.outlineStyle,outlineWidth:style.outlineWidth,
        borderRadius:style.borderRadius,paddingTop:style.paddingTop,paddingRight:style.paddingRight,
        paddingBottom:style.paddingBottom,paddingLeft:style.paddingLeft,
        beforeContent:before.content,beforeDisplay:before.display,beforeBackgroundImage:before.backgroundImage,
        beforeWidth:before.width,beforeHeight:before.height,
        afterContent:after.content,afterDisplay:after.display,afterBackgroundImage:after.backgroundImage,
        afterWidth:after.width,afterHeight:after.height,
        beforeVisibility:before.visibility,beforeOpacity:before.opacity,beforeBackgroundColor:before.backgroundColor,
        beforeBorderImageSource:before.borderImageSource,beforeBoxShadow:before.boxShadow,
        beforeBorderTopStyle:before.borderTopStyle,beforeBorderTopWidth:before.borderTopWidth,
        beforeBorderRightStyle:before.borderRightStyle,beforeBorderRightWidth:before.borderRightWidth,
        beforeBorderBottomStyle:before.borderBottomStyle,beforeBorderBottomWidth:before.borderBottomWidth,
        beforeBorderLeftStyle:before.borderLeftStyle,beforeBorderLeftWidth:before.borderLeftWidth,
        afterVisibility:after.visibility,afterOpacity:after.opacity,afterBackgroundColor:after.backgroundColor,
        afterBorderImageSource:after.borderImageSource,afterBoxShadow:after.boxShadow,
        afterBorderTopStyle:after.borderTopStyle,afterBorderTopWidth:after.borderTopWidth,
        afterBorderRightStyle:after.borderRightStyle,afterBorderRightWidth:after.borderRightWidth,
        afterBorderBottomStyle:after.borderBottomStyle,afterBorderBottomWidth:after.borderBottomWidth,
        afterBorderLeftStyle:after.borderLeftStyle,afterBorderLeftWidth:after.borderLeftWidth
      };
    };
    const get = id => chat.querySelector('[data-beautify-smoke-id="' + id + '"]');
    const elementMetric = element => {
      if (!element) return null;
      const style = getComputedStyle(element);
      const before = getComputedStyle(element,'::before');
      const after = getComputedStyle(element,'::after');
      const rect = element.getBoundingClientRect();
      return {
        tagName:element.tagName,className:typeof element.className === 'string' ? element.className : '',
        display:style.display,visibility:style.visibility,opacity:style.opacity,position:style.position,
        width:style.width,height:style.height,minWidth:style.minWidth,minHeight:style.minHeight,
        backgroundColor:style.backgroundColor,backgroundImage:style.backgroundImage,
        borderTopStyle:style.borderTopStyle,borderTopWidth:style.borderTopWidth,
        borderRightStyle:style.borderRightStyle,borderRightWidth:style.borderRightWidth,
        borderBottomStyle:style.borderBottomStyle,borderBottomWidth:style.borderBottomWidth,
        borderLeftStyle:style.borderLeftStyle,borderLeftWidth:style.borderLeftWidth,
        borderImageSource:style.borderImageSource,boxShadow:style.boxShadow,borderRadius:style.borderRadius,
        paddingTop:style.paddingTop,paddingRight:style.paddingRight,paddingBottom:style.paddingBottom,paddingLeft:style.paddingLeft,
        overflow:style.overflow,objectFit:style.objectFit,flexDirection:style.flexDirection,alignItems:style.alignItems,
        justifyContent:style.justifyContent,gap:style.gap,color:style.color,fontSize:style.fontSize,lineHeight:style.lineHeight,
        rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},
        before:{content:before.content,display:before.display,visibility:before.visibility,opacity:before.opacity,backgroundImage:before.backgroundImage,width:before.width,height:before.height,borderImageSource:before.borderImageSource},
        after:{content:after.content,display:after.display,visibility:after.visibility,opacity:after.opacity,backgroundImage:after.backgroundImage,width:after.width,height:after.height,borderImageSource:after.borderImageSource}
      };
    };
    const videoRow = get('beautify-smoke-video');
    const audioRow = get('beautify-smoke-audio');
    return {
      mediaElements:{
        video:{row:elementMetric(videoRow),wrap:elementMetric(videoRow.querySelector('.bubble-wrap')),bubble:elementMetric(videoRow.querySelector('.bubble')),element:elementMetric(videoRow.querySelector('video'))},
        audio:{row:elementMetric(audioRow),wrap:elementMetric(audioRow.querySelector('.bubble-wrap')),bubble:elementMetric(audioRow.querySelector('.bubble')),message:elementMetric(audioRow.querySelector('.audio-message')),voiceIcon:elementMetric(audioRow.querySelector('.voice-icon')),element:elementMetric(audioRow.querySelector('audio'))}
      },
      media:{
        video:mediaMetric(get('beautify-smoke-video').querySelector('.bubble')),
        audio:mediaMetric(get('beautify-smoke-audio').querySelector('.bubble')),
        sticker:mediaMetric(get('beautify-smoke-sticker').querySelector('.bubble')),
        pending:mediaMetric(get('beautify-smoke-pending').querySelector('.bubble')),
        card:mediaMetric(get('beautify-smoke-card').querySelector('.bubble'))
      },
      imageRect:(() => {const r=get('beautify-smoke-image').querySelector('img').getBoundingClientRect();return {width:r.width,height:r.height};})(),
      text:{own:metric(get('beautify-smoke-own').querySelector('.bubble')),other:metric(get('beautify-smoke-other').querySelector('.bubble'))},
      rows:chat.querySelectorAll('[data-beautify-smoke-id]').length
    };
  });
  assert.equal(baselineMedia.rows, 9, 'all seven message types, a special card and the system row must be constructed');
  await page.waitForFunction(() => {
    const image = document.querySelector('[data-beautify-smoke-id="beautify-smoke-image"] img');
    return image && image.complete && image.naturalWidth > 0;
  });

  mkdirSync('artifacts/chat-beautify', {recursive:true});
  const presetRunResults = [];
  const viewports = [
    {name:'desktop',width:1365,height:900},
    {name:'mobile',width:390,height:844}
  ];
  for (const viewport of viewports) {
    await page.setViewportSize({width:viewport.width,height:viewport.height});
    await exposeBeautifySettings();
    for (const id of ["ink-minimal","rose-letter","blue-imessage","mint-sms","carbon-glass","miffy-memo","x-blue-dm","x-night-dm","whatsapp-tails","miu-pink-sms","miu-blue-sms","leaf-garden","ios6-bluegray","wechat-moon","pink-lemon","rabbit-milk","line-kitty","pink-gray-stars","picture-frame","soft-double-frame","line-cat-milk"]) {
      await page.evaluate(presetId => window.DuoChatBeautify.apply(presetId), id);
      const audit = await page.evaluate(({id,baselineMedia}) => {
        const chat = document.getElementById('chatList');
        const card = document.querySelector('[data-preset-card="' + id + '"]');
        const preview = card?.querySelector('.duo-chat-beautify-preview');
        const row = name => chat.querySelector('[data-beautify-smoke-id="beautify-smoke-' + name + '"]');
        const bubble = name => row(name)?.querySelector('.bubble');
        const style = element => {
          const s = getComputedStyle(element);
          const before = getComputedStyle(element,'::before');
          const after = getComputedStyle(element,'::after');
          return {
            color:s.color,fontSize:s.fontSize,fontWeight:s.fontWeight,lineHeight:s.lineHeight,
            backgroundColor:s.backgroundColor,backgroundImage:s.backgroundImage,borderTopColor:s.borderTopColor,
            borderTopStyle:s.borderTopStyle,borderTopWidth:s.borderTopWidth,
            boxShadow:s.boxShadow,borderRadius:s.borderRadius,
            paddingTop:s.paddingTop,paddingRight:s.paddingRight,
            paddingBottom:s.paddingBottom,paddingLeft:s.paddingLeft,
            beforeContent:before.content,beforeDisplay:before.display,afterContent:after.content,afterDisplay:after.display
          };
        };
        const mediaStyle = element => {
          const s = getComputedStyle(element);
          const before = getComputedStyle(element,'::before');
          const after = getComputedStyle(element,'::after');
          return {
            backgroundColor:s.backgroundColor,backgroundImage:s.backgroundImage,
            borderTopStyle:s.borderTopStyle,borderTopWidth:s.borderTopWidth,
            borderRightStyle:s.borderRightStyle,borderRightWidth:s.borderRightWidth,
            borderBottomStyle:s.borderBottomStyle,borderBottomWidth:s.borderBottomWidth,
            borderLeftStyle:s.borderLeftStyle,borderLeftWidth:s.borderLeftWidth,
            boxShadow:s.boxShadow,outlineStyle:s.outlineStyle,outlineWidth:s.outlineWidth,
            borderRadius:s.borderRadius,paddingTop:s.paddingTop,paddingRight:s.paddingRight,
            paddingBottom:s.paddingBottom,paddingLeft:s.paddingLeft,
            beforeContent:before.content,beforeDisplay:before.display,beforeBackgroundImage:before.backgroundImage,
            beforeWidth:before.width,beforeHeight:before.height,
            afterContent:after.content,afterDisplay:after.display,afterBackgroundImage:after.backgroundImage,
            afterWidth:after.width,afterHeight:after.height
          };
        };
        const own = style(bubble('own')), other = style(bubble('other'));
        const previewOwn = preview?.querySelector('.msg-row.me .bubble');
        const previewOther = preview?.querySelector('.msg-row.other .bubble');
        const changed = (a,b) => Object.keys(a).some(key => a[key] !== b[key]);
        const media = {
          video:mediaStyle(bubble('video')),audio:mediaStyle(bubble('audio')),
          sticker:mediaStyle(bubble('sticker')),pending:mediaStyle(bubble('pending')),
          card:mediaStyle(bubble('card'))
        };
        const image = row('image')?.querySelector('img');
        const imageRect = image ? image.getBoundingClientRect() : {width:-1,height:-1};
        const system = row('system');
        const elementMetric = element => {
          if (!element) return null;
          const s = getComputedStyle(element), before = getComputedStyle(element,'::before'), after = getComputedStyle(element,'::after');
          const rect = element.getBoundingClientRect();
          return {
            tagName:element.tagName,className:typeof element.className === 'string' ? element.className : '',
            display:s.display,visibility:s.visibility,opacity:s.opacity,position:s.position,
            width:s.width,height:s.height,minWidth:s.minWidth,minHeight:s.minHeight,
            backgroundColor:s.backgroundColor,backgroundImage:s.backgroundImage,
            borderTopStyle:s.borderTopStyle,borderTopWidth:s.borderTopWidth,
            borderRightStyle:s.borderRightStyle,borderRightWidth:s.borderRightWidth,
            borderBottomStyle:s.borderBottomStyle,borderBottomWidth:s.borderBottomWidth,
            borderLeftStyle:s.borderLeftStyle,borderLeftWidth:s.borderLeftWidth,
            borderImageSource:s.borderImageSource,boxShadow:s.boxShadow,borderRadius:s.borderRadius,
            paddingTop:s.paddingTop,paddingRight:s.paddingRight,paddingBottom:s.paddingBottom,paddingLeft:s.paddingLeft,
            overflow:s.overflow,objectFit:s.objectFit,flexDirection:s.flexDirection,alignItems:s.alignItems,
            justifyContent:s.justifyContent,gap:s.gap,color:s.color,fontSize:s.fontSize,lineHeight:s.lineHeight,
            rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},
            before:{content:before.content,display:before.display,visibility:before.visibility,opacity:before.opacity,backgroundImage:before.backgroundImage,width:before.width,height:before.height,borderImageSource:before.borderImageSource},
            after:{content:after.content,display:after.display,visibility:after.visibility,opacity:after.opacity,backgroundImage:after.backgroundImage,width:after.width,height:after.height,borderImageSource:after.borderImageSource}
          };
        };
        const videoRow = row('video'), audioRow = row('audio');
        const mediaElements = {
          video:{row:elementMetric(videoRow),wrap:elementMetric(videoRow?.querySelector('.bubble-wrap')),bubble:elementMetric(bubble('video')),element:elementMetric(videoRow?.querySelector('video'))},
          audio:{row:elementMetric(audioRow),wrap:elementMetric(audioRow?.querySelector('.bubble-wrap')),bubble:elementMetric(bubble('audio')),message:elementMetric(audioRow?.querySelector('.audio-message')),voiceIcon:elementMetric(audioRow?.querySelector('.voice-icon')),element:elementMetric(audioRow?.querySelector('audio'))}
        };
        const specialVoice = id === 'rabbit-milk' || id === 'line-kitty';
        const specialVideo = specialVoice;
        const isolation = {};
        for (const type of ['video','sticker','pending','audio']) {
          if ((type === 'video' && specialVideo) || (type === 'audio' && specialVoice)) continue;
          isolation[type] = JSON.stringify(media[type]) === JSON.stringify(baselineMedia.media[type]);
        }
        return {
          id,
          liveClass:chat.classList.contains('duo-chat-beautify--' + id),
          pageClass:document.getElementById('chatPage').classList.contains('duo-chat-beautify--' + id),
          previewClass:preview?.classList.contains('duo-chat-beautify--' + id) || false,
          selectedClasses:[...chat.classList].filter(name=>name.startsWith('duo-chat-beautify--')),
          ownChanged:changed(own,baselineMedia.text.own),
          otherChanged:changed(other,baselineMedia.text.other),
          own,other,media,mediaElements,
          previewOwn:previewOwn ? style(previewOwn) : null,
          previewOther:previewOther ? style(previewOther) : null,
          isolation,
          imageRect,
          systemHasBubble:!!system?.querySelector('.bubble'),
          systemClass:system?.className || '',
          voicePadding:media.audio.paddingTop,
          videoPseudo:media.video.beforeContent + '|' + media.video.afterContent
        };
      }, {id,baselineMedia});
      assert.equal(audit.liveClass,true,id + ' must scope the live chat list');
      assert.equal(audit.pageClass,true,id + ' must scope the live chat page');
      assert.equal(audit.previewClass,true,id + ' must scope its preview');
      assert.deepEqual(audit.selectedClasses,['duo-chat-beautify--' + id],id + ' must not leave another preset scope active');
      assert.ok(audit.ownChanged,id + ' own text bubble must receive its selected CSS: ' + JSON.stringify({before:baselineMedia.text.own,after:audit.own}));
      assert.ok(audit.otherChanged,id + ' peer text bubble must receive its selected CSS: ' + JSON.stringify({before:baselineMedia.text.other,after:audit.other}));
      assert.ok(audit.previewOwn && audit.previewOther,id + ' must render both preview directions');
      assert.equal(audit.systemHasBubble,false,id + ' must not turn system messages into bubbles');
      for (const [type,passed] of Object.entries(audit.isolation)) assert.equal(passed,true,id + ' must isolate ' + type + ': ' + JSON.stringify({before:baselineMedia.media[type],after:audit.media[type]}));
      assert.ok(Math.abs(audit.imageRect.width - baselineMedia.imageRect.width) < 0.5,id + ' must preserve image width');
      assert.ok(Math.abs(audit.imageRect.height - baselineMedia.imageRect.height) < 0.5,id + ' must preserve image height');
      if (id === 'rabbit-milk' || id === 'line-kitty') {
        console.log('[card-pseudo-diagnostic] ' + JSON.stringify({
          id, baseline: baselineMedia.media.card, after: audit.media.card
        }));
        console.log('[special-media-diagnostic] ' + JSON.stringify({
          id,viewport:viewport.name,baseline:baselineMedia.mediaElements,after:audit.mediaElements,
          videoPseudo:{before:pseudoDecoration(audit.media.video,'before'),after:pseudoDecoration(audit.media.video,'after')},
          audioPseudo:{before:pseudoDecoration(audit.media.audio,'before'),after:pseudoDecoration(audit.media.audio,'after')}
        }));
        assert.equal(audit.voicePadding,'0px',id + ' must retain its source voice-bubble treatment');
        assert.equal(audit.media.card.paddingTop,'0px',id + ' must apply its source card-specific reset');
        for (const side of ['before','after']) {
          const baselinePseudo = pseudoDecoration(baselineMedia.media.card, side);
          const appliedPseudo = pseudoDecoration(audit.media.card, side);
          assert.equal(appliedPseudo.visible, baselinePseudo.visible,
            id + ' card must not gain a visible generic ' + side + ' decoration: ' + JSON.stringify({baseline:baselinePseudo,after:appliedPseudo,baselineStyle:baselineMedia.media.card,afterStyle:audit.media.card}));
          if (baselinePseudo.visible) {
            assert.deepEqual(appliedPseudo, baselinePseudo,
              id + ' card must preserve its pre-existing ' + side + ' decoration without modification');
          }
        }
        for (const side of ['before','after']) {
          assert.equal(pseudoDecoration(audit.media.video,side).visible,false,
            id + ' video bubble must not receive ordinary text-bubble ' + side + ' decoration');
          assert.equal(pseudoDecoration(audit.media.audio,side).visible,false,
            id + ' voice bubble must not receive ordinary text-bubble ' + side + ' decoration');
        }
        assert.ok(audit.mediaElements.video.element && audit.mediaElements.video.element.rect.width > 0,
          id + ' video element must have a rendered box');
        assert.ok(audit.mediaElements.audio.element && audit.mediaElements.audio.element.rect.width > 0,
          id + ' audio element must have a rendered box');
        assert.ok(audit.mediaElements.audio.message && audit.mediaElements.audio.message.rect.width > 0,
          id + ' voice message container must have a rendered box');
        assert.ok(audit.mediaElements.audio.voiceIcon,id + ' voice icon must be present and inspected');
        assert.equal(audit.media.video.backgroundImage,'none',id + ' video container must retain the media reset');
        assert.equal(audit.media.video.paddingTop,'0px',id + ' video container must retain zero media padding');
        assert.equal(audit.media.video.borderTopStyle,'none',id + ' video container must not inherit the ordinary text border');
        assert.equal(audit.media.audio.paddingTop,'0px',id + ' voice container must retain the source zero-padding rule');
        const preset = await page.evaluate(presetId => window.DuoChatBeautify.presets.find(x => x.id === presetId).css,id);
        assert.match(preset,/\.bubble:has\(video\)/,id + ' must retain video-specific CSS');
        assert.match(preset,/audio-bubble/,id + ' must retain voice-specific CSS');
      }
      await page.locator('[data-preset-card="' + id + '"] .duo-chat-beautify-preview').screenshot({
        path:'artifacts/chat-beautify/' + viewport.name + '-preview-' + id + '.png'
      });
      await page.evaluate(() => goto('chatPage'));
      await page.locator('#chatList').screenshot({
        path:'artifacts/chat-beautify/' + viewport.name + '-chat-' + id + '.png'
      });
      if (['pink-gray-stars','picture-frame','soft-double-frame','line-cat-milk'].includes(id)) {
        await page.locator('#chatList').screenshot({
          path:'artifacts/chat-beautify/' + viewport.name + '-decorative-' + id + '.png'
        });
      }
      if (id === 'rabbit-milk' || id === 'line-kitty') {
        await page.locator('#chatList').screenshot({
          path:'artifacts/chat-beautify/' + viewport.name + '-media-special-' + id + '.png'
        });
      }
      await page.evaluate(() => goto('settingsPage'));
      await exposeBeautifySettings();
      presetRunResults.push({viewport:viewport.name,...audit});
    }
  }

  await page.evaluate(() => window.DuoChatBeautify.apply('rabbit-milk'));
  for (const viewport of viewports) {
    await page.setViewportSize({width:viewport.width,height:viewport.height});
    await page.evaluate(() => goto('chatPage'));
    await page.locator('#chatList').screenshot({
      path:'artifacts/chat-beautify/' + viewport.name + '-media-isolation.png'
    });
  }

  const cssomAudit = await page.evaluate(() => {
    return window.DuoChatBeautify.presets.map(item => {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(item.css);
      const rules = [...sheet.cssRules];
      const invalidSelectors = [];
      const split = value => {
        const out=[];let start=0,depth=0,quote='',escaped=false;
        for(let i=0;i<value.length;i++){const c=value[i];if(escaped){escaped=false;continue;}if(c==='\\'){escaped=true;continue;}if(quote){if(c===quote)quote='';continue;}if(c==='"'||c==="'"){quote=c;continue;}if(c==='('||c==='[')depth++;else if(c===')'||c===']')depth--;else if(c===','&&depth===0){out.push(value.slice(start,i));start=i+1;}}
        out.push(value.slice(start));return out;
      };
      for (const rule of rules) {
        if (!rule.selectorText) continue;
        for (const selector of split(rule.selectorText)) {
          const query = selector.replace(/::[a-z-]+/gi,'');
          try { document.querySelectorAll(query); }
          catch (error) { invalidSelectors.push({selector,error:error.message}); }
        }
      }
      return {id:item.id,ruleCount:rules.length,sourceRuleCount:(item.css.match(/\{/g)||[]).length,invalidSelectors};
    });
  });
  for (const item of cssomAudit) {
    assert.equal(item.ruleCount,item.sourceRuleCount,item.id + ' CSSOM must parse every source rule');
    assert.deepEqual(item.invalidSelectors,[],item.id + ' selectors must be accepted by Chromium');
  }

  const resourceAudit = await page.evaluate(async (assets) => {
    const loadImage = url => new Promise(resolve => {
      const image = new Image();
      const timer = setTimeout(() => resolve({loaded:false,naturalWidth:0,error:'timeout'}),12000);
      image.onload = () => {clearTimeout(timer);resolve({loaded:image.naturalWidth>0,naturalWidth:image.naturalWidth});};
      image.onerror = () => {clearTimeout(timer);resolve({loaded:false,naturalWidth:0,error:'image-error'});};
      image.src = url;
    });
    const results=[];
    for (const asset of assets) {
      const image = await loadImage(asset.url);
      results.push({...asset,browser:image});
    }
    return results;
  }, await page.evaluate(() => {
    const urls = new Set();
    for (const item of window.DuoChatBeautify.presets) {
      for (const match of item.css.matchAll(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi)) urls.add(match[2]);
    }
    return [...urls].filter(url => /^https?:|^\/\//i.test(url)).map(url => ({url,kind:'remote'}));
  }).then(async remote => {
    const local = await page.evaluate(() => {
      const urls = new Set();
      for (const item of window.DuoChatBeautify.presets) {
        for (const match of item.css.matchAll(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi)) {
          if (!/^https?:|^data:|^\/\//i.test(match[2])) urls.add(match[2]);
        }
      }
      return [...urls].map(url => ({url:'/' + url,kind:'local',path:url}));
    });
    return [...remote,...local];
  }));
  assert.equal(resourceAudit.filter(item=>item.kind==='remote').length,9,'all nine remote image URLs must be audited');
  assert.equal(resourceAudit.filter(item=>item.kind==='local').length,11,'all eleven local image assets must be audited');
  const resourceHttpAudit = [];
  for (const asset of resourceAudit) {
    const url = asset.kind === 'local' ? 'http://127.0.0.1:8080' + asset.url : asset.url;
    try {
      const response = await page.request.get(url,{timeout:20000});
      resourceHttpAudit.push({...asset,status:response.status(),contentType:response.headers()['content-type'] || ''});
    } catch (error) {
      resourceHttpAudit.push({...asset,status:null,contentType:'',error:error.message});
    }
  }
  writeFileSync('artifacts/chat-beautify/resource-audit.json',JSON.stringify({browser:resourceAudit,http:resourceHttpAudit},null,2));
  writeFileSync('artifacts/chat-beautify/preset-browser-audit.json',JSON.stringify({cssomAudit,presetRunResults},null,2));
  writeFileSync('artifacts/chat-beautify/media-special-audit.json',JSON.stringify({
    results:presetRunResults.filter(item=>item.id==='rabbit-milk'||item.id==='line-kitty').map(item=>({
      viewport:item.viewport,id:item.id,video:item.mediaElements.video,audio:item.mediaElements.audio,
      card:item.media.card,
      videoPseudo:{before:pseudoDecoration(item.media.video,'before'),after:pseudoDecoration(item.media.video,'after')},
      audioPseudo:{before:pseudoDecoration(item.media.audio,'before'),after:pseudoDecoration(item.media.audio,'after')},
      cardPseudo:{before:pseudoDecoration(item.media.card,'before'),after:pseudoDecoration(item.media.card,'after')}
    }))
  },null,2));

  await page.evaluate(() => window.DuoChatBeautify.apply('line-kitty'));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(() => state.chatBeautifyPresetId === 'line-kitty' && document.getElementById('chatList').classList.contains('duo-chat-beautify--line-kitty'));
  const validPersistence = await page.evaluate(() => ({id:state.chatBeautifyPresetId,customCSS:state.customCSS || ''}));
  assert.equal(validPersistence.id,'line-kitty','a valid selected preset must persist after reload');
  await page.evaluate(() => window.DuoChatBeautify.reset());
  const resetAudit = await page.evaluate(() => ({id:state.chatBeautifyPresetId || '',hasPresetClass:[...document.getElementById('chatList').classList].some(name=>name.startsWith('duo-chat-beautify--')),customCSS:state.customCSS || ''}));
  assert.equal(resetAudit.id,'');
  assert.equal(resetAudit.hasPresetClass,false,'reset must remove the selected preset class');
  assert.equal(resetAudit.customCSS,validPersistence.customCSS,'reset must preserve custom CSS');

  const stateBeforeStale = await page.evaluate(() => ({
    customCSS:state.customCSS || '',
    chatHistory:JSON.stringify(state.chatHistory || []),
    stickers:JSON.stringify(state.stickers || []),
    currentPage:state.currentPage
  }));
  await page.evaluate(() => {state.chatBeautifyPresetId='native-style-removed';save();});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(() => !!window.DuoChatBeautify && !!document.getElementById('duoChatBeautifyPanel'));
  const staleCleanup = await page.evaluate(() => ({
    hasPresetId:Object.prototype.hasOwnProperty.call(state,'chatBeautifyPresetId'),
    selectedId:window.DuoChatBeautify.getCurrent(),
    customCSS:state.customCSS || '',
    chatHistory:JSON.stringify(state.chatHistory || []),
    stickers:JSON.stringify(state.stickers || [])
  }));
  assert.equal(staleCleanup.hasPresetId,false,'stale selected ID must be removed from persisted state');
  assert.equal(staleCleanup.selectedId,'');
  assert.equal(staleCleanup.customCSS,stateBeforeStale.customCSS,'stale cleanup must preserve custom CSS');
  assert.equal(staleCleanup.chatHistory,stateBeforeStale.chatHistory,'stale cleanup must preserve chat history');
  assert.equal(staleCleanup.stickers,stateBeforeStale.stickers,'stale cleanup must preserve sticker data');
  if (beautifyBefore.selectedId) await page.evaluate(id => window.DuoChatBeautify.apply(id),beautifyBefore.selectedId);
  await page.evaluate(() => {
    const p = document.getElementById('settingsPage');
    const card = document.getElementById('settingsParam');
    if (p) p.style.display = 'block';
    if (card) card.style.display = 'block';
  });
  await page.locator('#duoThemeMode').selectOption('dark');
  await page.locator('[data-duo-palette="ocean"]').click();
  const themeBeforeReload = await page.evaluate(() => ({
    mode: state.appearanceSettings.mode,
    palette: state.appearanceSettings.palette,
    resolved: document.documentElement.dataset.duoThemeResolved,
    circleBg: document.getElementById('circleMount').style.getPropertyValue('--bg')
  }));
  assert.equal(themeBeforeReload.mode, 'dark');
  assert.equal(themeBeforeReload.palette, 'ocean');
  assert.equal(themeBeforeReload.resolved, 'dark');
  assert.ok(themeBeforeReload.circleBg);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.duoThemeResolved === 'dark');
  const persistedTheme = await page.evaluate(() => state.appearanceSettings.palette);
  assert.equal(persistedTheme, 'ocean', 'theme choice should persist after reload');

  await page.evaluate(() => document.getElementById('emojiBtn').click());
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j+a8AAAAASUVORK5CYII=', 'base64');
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  await page.locator('#stickerUploader').setInputFiles([
    { name: 'smoke.png', mimeType: 'image/png', buffer: png },
    { name: 'smoke.gif', mimeType: 'image/gif', buffer: gif }
  ]);
  await page.waitForFunction(() => document.querySelectorAll('#stickerList [data-sticker-send]').length === 2);
  const uploaded = await page.evaluate(() => state.stickers.map(s => ({ id:s.id, mediaId:s.mediaId, mimeType:s.mimeType })));
  assert.equal(uploaded.length, 2);
  assert.ok(uploaded.some(x => x.mimeType === 'image/png'));
  assert.ok(uploaded.some(x => x.mimeType === 'image/gif'));
  await page.waitForFunction(() => [...document.querySelectorAll('#stickerList img')].every(img => img.complete && img.naturalWidth > 0));
  await page.locator('#stickerList [data-duo-sticker-fav]').first().click();
  await page.locator('[data-duo-sticker-tab="favorites"]').click();
  assert.equal(await page.locator('#stickerList [data-sticker-send]').count(), 1, 'favorite tab should show only the saved upload');
  const favoritesBeforeReload = await page.evaluate(() => state.stickerFavorites.length);
  assert.equal(favoritesBeforeReload, 1);
  await page.locator('#stickerList [data-duo-sticker-fav]').click();
  assert.equal(await page.locator('#stickerList [data-sticker-send]').count(), 0, 'unfavoriting should empty the favorites list');
  assert.match(await page.locator('#stickerList').innerText(), /还没有收藏表情包/);
  await page.locator('[data-duo-sticker-tab="uploads"]').click();
  await page.locator('#stickerList [data-duo-sticker-fav]').first().click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!document.querySelector('#duoStickerTabs'));
  await page.evaluate(() => document.getElementById('emojiBtn').click());
  await page.locator('[data-duo-sticker-tab="favorites"]').click();
  assert.equal(await page.locator('#stickerList [data-sticker-send]').count(), 1, 'favorite should survive reload');
  await page.locator('[data-duo-sticker-tab="uploads"]').click();
  await page.locator('#stickerList [data-sticker-send]').first().click();
  await page.waitForFunction(() => state.chatHistory.some(message => message.mediaId), { timeout: 5000 });
  const sentMediaId = await page.evaluate(() => state.chatHistory.find(message => message.mediaId).mediaId);
  await page.evaluate(() => { const panel=document.getElementById('emojiPanel'); panel.classList.add('show'); panel.setAttribute('aria-hidden','false'); });
  await page.locator('[data-duo-sticker-tab="uploads"]').click();
  await page.evaluate(() => document.querySelector('#stickerList [data-sticker-del]').click());
  await page.waitForFunction(() => state.stickers.length === 1 && state.stickerFavorites.length === 0);
  const protectedMedia = await page.evaluate(async id => !!(await getMediaRecord(id)), sentMediaId);
  assert.equal(protectedMedia, true, 'deleting an uploaded sticker must not delete media still referenced by chat history');
  await page.evaluate(() => document.querySelector('#stickerList [data-sticker-del]').click());
  await page.waitForFunction(async id => state.stickers.length === 0 && !(await getMediaRecord(id)), uploaded[1].mediaId);
  const orphanMedia = await page.evaluate(async id => !!(await getMediaRecord(id)), uploaded[1].mediaId);
  assert.equal(orphanMedia, false, 'unreferenced deleted sticker media should be cleaned up');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!document.querySelector('#duoStickerTabs'));
  await page.evaluate(() => document.getElementById('emojiBtn').click());
  assert.match(await page.locator('#stickerList').innerText(), /还没有表情包/);
  assert.equal(await page.locator('[data-duo-sticker-tab="favorites"]').count(), 1);
  assert.equal(await page.locator('[data-duo-sticker-tab="builtin"]').count(), 0);

  const fontPath = process.env.TWODEERS_TEST_FONT || '';
  let fontTested = false;
  if (fontPath && existsSync(fontPath)) {
    await page.evaluate(() => window.ChuanXunFontManager.openSettings());
    await page.locator('#chuanxun-font-file').setInputFiles(fontPath);
    await page.waitForFunction(() => !!window.ChuanXunFontManager.getCurrentFontId(), { timeout: 20000 });
    fontTested = true;
    const customFontId = await page.evaluate(() => window.ChuanXunFontManager.getCurrentFontId());
    assert.ok(customFontId);
  }

  const backupResult = await page.evaluate(async () => {
    const archive = await window.__duoBackupV4.build('all');
    const parsed = await window.__duoBackupV4.unzip(archive);
    const media = parsed.manifest.resources.filter(item => item.type === 'media');
    const font = parsed.manifest.resources.filter(item => item.type === 'font');
    const before = state.chatHistory.length;
    const beforeCurrentFont = window.ChuanXunFontManager.getCurrentFontId();
    const mutated = JSON.parse(JSON.stringify(state.chatHistory));
    state.chatHistory = [];
    save();
    await window.__duoBackupV4.restore(archive);
    return {
      size: archive.size,
      resources: parsed.manifest.resources.length,
      media: media.length,
      fonts: font.length,
      before,
      after: state.chatHistory.length,
      fontBefore: beforeCurrentFont,
      fontAfter: window.ChuanXunFontManager.getCurrentFontId(),
      messageIdsMatch: state.chatHistory.map(x => x.id).join('|') === mutated.map(x => x.id).join('|')
    };
  });
  assert.ok(backupResult.size > 100);
  assert.ok(backupResult.media >= 1, 'all backup should contain the uploaded/sent sticker media');
  assert.ok(backupResult.after >= backupResult.before, 'V4 restore should restore the original chat');
  assert.equal(backupResult.messageIdsMatch, true);
  assert.equal(backupResult.fontAfter, backupResult.fontBefore);

  if (fontTested) await page.evaluate(() => window.ChuanXunFontManager.restoreDefault());

  const v3Result = await page.evaluate(async () => {
    if (typeof buildBackup !== 'function' || typeof applyBackupPayload !== 'function') return false;
    const oldBlob = await buildBackup('param');
    const payload = JSON.parse(await oldBlob.text());
    if (payload.version !== 3) return false;
    await applyBackupPayload(payload);
    return true;
  });
  assert.equal(v3Result, true, 'legacy v3 JSON backup import path should remain available');
  assert.deepEqual(pageErrors, [], 'page should not emit uncaught JavaScript errors');

  console.log(JSON.stringify({
    result: 'passed',
    themePersisted: true,
    cssBeautifyPresets: beautifyBefore.count,
    cssBeautifyBrowserViews: presetRunResults.length,
    cssBeautifyScreenshots: 98,
    cssomPresetRules: cssomAudit.reduce((sum,item)=>sum+item.ruleCount,0),
    resourceAuditFailures: resourceHttpAudit.filter(item=>item.status!==200 || !/^image\//i.test(item.contentType)).length + resourceAudit.filter(item=>!item.browser.loaded).length,
    consoleErrors,
    cssBeautifyLivePreview: true,
    cssBeautifyApplySwitchReset: resetAudit.id === '' && !resetAudit.hasPresetClass,
    cssBeautifyPersistence: validPersistence.id === 'line-kitty',
    cssBeautifyMediaSafe: true,
    twoColumnStickers: true,
    favoritePersistence: true,
    favoriteRemoval: true,
    pngAndGifUpload: true,
    referencedMediaProtection: true,
    twoTabOnly: true,
    mediaSentAndBackedUp: true,
    v4Restore: true,
    v3Import: v3Result,
    customFontImported: fontTested,
    v4Bytes: backupResult.size,
    mediaResources: backupResult.media,
    fontResources: backupResult.fonts
  }, null, 2));
} finally {
  await browser.close();
}
