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
  const transparentColor = backgroundColor === 'transparent' || /rgba?\([^)]*,\s*0(?:\.0+)?\s*\)$/.test(backgroundColor);
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

const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox','--disable-dev-shm-usage'] });
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
    !!document.getElementById('duoFontPanel') &&
    !!document.getElementById('settingsCategoryGrid') &&
    !!document.getElementById('duoUnifiedCardPanel') &&
    window.__duoSettingsPagesReady === true,
    { timeout: 15000 }
  );

  const baseline = await page.evaluate(() => ({
    circleApi: !!window.__duoCircleApi?.validateState,
    stickerOverlay: !!document.getElementById('stickerOverlay'),
    stickerGrid: !!document.getElementById('stickerGrid'),
    emojiButton: !!document.getElementById('quickEmojiBtn'),
    stickerTabs: document.querySelectorAll('#duoStickerTabs [data-duo-sticker-tab]').length,
    backupVersion: window.__duoBackupV4.version
  }));
  assert.equal(baseline.circleApi, true, 'Circle Shadow DOM API should be available');
  assert.equal(baseline.stickerOverlay, true, 'the sticker selector must be a separate bottom sheet');
  assert.equal(baseline.stickerGrid, true, 'the sticker sheet must own one full-width grid');
  assert.equal(baseline.emojiButton,true,'the separate Emoji entry must remain available');
  await page.evaluate(() => goto('chatPage'));
  await page.locator('#plusBtn').click();
  await page.locator('#quickEmojiBtn').click();
  await page.waitForFunction(() => document.querySelector('#emojiPanel')?.classList.contains('show') && document.querySelectorAll('#emojiGrid [data-emoji]').length > 0);
  await page.locator('#emojiPanelClose').click();
  const composerVisibility = await page.evaluate(() => {
    const button=document.getElementById('emojiBtn');
    const rect=button.getBoundingClientRect();
    const ancestors=[];
    for(let node=button;node&&ancestors.length<10;node=node.parentElement){
      const style=getComputedStyle(node),r=node.getBoundingClientRect();
      ancestors.push({
        tag:node.tagName,id:node.id,className:typeof node.className==='string'?node.className:'',
        display:style.display,visibility:style.visibility,opacity:style.opacity,
        overflow:style.overflow,clipPath:style.clipPath,transform:style.transform,
        hidden:node.hidden,rect:{x:r.x,y:r.y,width:r.width,height:r.height}
      });
    }
    return {
      activePages:Array.from(document.querySelectorAll('.page.active')).map(page=>page.id),
      chatPageActive:document.getElementById('chatPage')?.classList.contains('active')||false,
      display:getComputedStyle(button).display,
      visibility:getComputedStyle(button).visibility,
      opacity:getComputedStyle(button).opacity,
      rect:{x:rect.x,y:rect.y,right:rect.right,bottom:rect.bottom,width:rect.width,height:rect.height},
      viewport:{width:innerWidth,height:innerHeight,scrollX,scrollY},
      isVisible:!!(rect.width&&rect.height&&getComputedStyle(button).visibility!=='hidden'),
      ancestors
    };
  });
  console.log('[browser-smoke] composer after closing Emoji picker:',JSON.stringify(composerVisibility));
  console.log('[browser-smoke] Playwright composer visibility:',await page.locator('#emojiBtn').isVisible());
  assert.equal(composerVisibility.chatPageActive,true,'closing Emoji picker must return to the active chat composer');
  assert.equal(composerVisibility.isVisible,true,'chat sticker entry must remain visible after closing Emoji picker');
  assert.ok(composerVisibility.rect.width>0&&composerVisibility.rect.height>0,'chat sticker entry must have a non-zero visible box after closing Emoji picker');
  assert.equal(baseline.stickerTabs, 0, 'the send surface must not add filter or management tabs');
  assert.equal(await page.locator('#stickerGrid .sticker-send').count(), 0, 'stickers must not have redundant Send buttons');
  assert.equal(await page.locator('#stickerGrid [data-open-sticker-admin]').count(), 0, 'management must not appear in the send surface');
  assert.equal(await page.locator('#settingsCategoryGrid [data-settings-category="stickers"]').count(), 1, 'sticker management must remain in the parameter area');
  assert.equal(baseline.backupVersion, 4);

  await page.waitForFunction(() => window.__duoStickerState?.exportSnapshot?.().items?.filter(item=>item.source==='builtin').length === 352,{timeout:60000});
  await page.locator('#emojiBtn').click();
  await page.waitForFunction(() => document.querySelector('#stickerOverlay')?.classList.contains('show'));
  await page.waitForFunction(() => document.querySelectorAll('#stickerGrid [data-sticker-id]').length === 352,{timeout:60000});
  assert.equal(await page.locator('#stickerGrid [data-sticker-id]').count(),352,'all built-in sticker entries should render into the dedicated grid');
  for (const viewport of [
    {name:'360px',width:360,height:800,columns:4},
    {name:'390px',width:390,height:844,columns:4},
    {name:'desktop',width:1365,height:900,columns:5}
  ]) {
    await page.setViewportSize({width:viewport.width,height:viewport.height});
    const layout=await page.evaluate(()=>{
      const sheet=document.querySelector('#stickerOverlay .kb-sticker-sheet');
      const grid=document.getElementById('stickerGrid');
      const rect=sheet.getBoundingClientRect(),gridRect=grid.getBoundingClientRect();
      return {
        columns:(()=>{const items=[...grid.querySelectorAll('[data-sticker-id]')];const firstTop=items[0]?.getBoundingClientRect().top??0;return items.filter(item=>Math.abs(item.getBoundingClientRect().top-firstTop)<1).length;})(),
        sheetWidth:rect.width,gridWidth:gridRect.width,
        viewportWidth:innerWidth,scrollHeight:grid.scrollHeight,clientHeight:grid.clientHeight,
        overflowX:document.documentElement.scrollWidth>innerWidth
      };
    });
    assert.equal(layout.columns,viewport.columns,viewport.name+' sticker grid must use the intended responsive column count');
    assert.ok(layout.sheetWidth<=viewport.width+1&&layout.gridWidth<=viewport.width+1,viewport.name+' sticker panel must fit inside the viewport');
    assert.ok(layout.scrollHeight>layout.clientHeight,viewport.name+' sticker grid must scroll internally instead of being clipped');
    assert.equal(layout.overflowX,false,viewport.name+' sticker panel must not cause horizontal page overflow');
  }
  await page.setViewportSize({width:1365,height:900});
  const favoriteBefore = await page.locator('#stickerGrid [data-sticker-favorite]').first().getAttribute('aria-label');
  await page.locator('#stickerGrid [data-sticker-favorite]').first().click();
  const favoriteAfter = await page.locator('#stickerGrid [data-sticker-favorite]').first().getAttribute('aria-label');
  assert.notEqual(favoriteAfter, favoriteBefore, 'favorite must toggle without sending the sticker');
  await page.locator('#stickerGrid [data-sticker-favorite]').first().click();

  await page.evaluate(() => {
    window.__stickerSendSmokeId = '';
    window.__stickerSendSmokeOriginal = window.sendSticker;
    window.sendSticker = async id => {
      window.__stickerSendSmokeId = id;
      document.getElementById('stickerOverlay').classList.remove('show');
    };
  });
  const firstSticker = page.locator('#stickerGrid [data-sticker-id]').first();
  const expectedStickerId = await firstSticker.getAttribute('data-sticker-id');
  await firstSticker.click();
  assert.equal(await page.evaluate(() => window.__stickerSendSmokeId), expectedStickerId,
    'tapping the sticker image itself must invoke direct send');
  assert.equal(await page.locator('#stickerOverlay.show').count(), 0, 'sending a sticker must close the sheet');
  await page.evaluate(() => { window.sendSticker = window.__stickerSendSmokeOriginal; });

  await page.locator('#chatMoreBtn').click();
  assert.equal(await page.locator('#chatMoreMenu').evaluate(el => el.parentElement === document.body), true,
    'header menu must be portalled out of the header stacking context');
  assert.equal(await page.locator('#chatMoreMenu').evaluate(el => getComputedStyle(el).position), 'fixed',
    'header menu must use viewport-fixed positioning');
  assert.ok(await page.locator('#chatMoreMenu').evaluate(el => Number(getComputedStyle(el).zIndex) >= 10000),
    'header menu must sit above chat decorations');
  await page.locator('#chatMoreBtn').click();

  const exposeBeautifySettings = () => page.evaluate(() => {
    if (typeof goto === 'function') goto('settingsPage');
    if (typeof window.__duoOpenSettingsCategory === 'function') {
      window.__duoOpenSettingsCategory('appearance');
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
  assert.deepEqual(await page.evaluate(() => window.DuoChatBeautify.presets.map(item => item.id)), ["ink-minimal","rose-letter","blue-imessage","mint-sms","miffy-memo","x-blue-dm","x-night-dm","whatsapp-tails","miu-pink-sms","miu-blue-sms","ios6-bluegray","wechat-moon","pink-lemon","line-kitty","pink-gray-stars","picture-frame","soft-double-frame"]);
  assert.equal(beautifyBefore.count, 17, 'exactly 17 approved CSS designs should be loaded');
  assert.equal(beautifyBefore.count, beautifyBefore.cards, 'each approved preset must have a live CSS preview card');
  assert.equal(beautifyBefore.stylePresent, true, 'preset CSS must be injected into the real page');
  assert.ok(beautifyBefore.styleRules > 100, 'browser must parse all 17 source stylesheets');
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
    const videoRowForMetrics = get('beautify-smoke-video');
    const audioRowForMetrics = get('beautify-smoke-audio');
    return {
      mediaElements:{
        video:{row:elementMetric(videoRowForMetrics),wrap:elementMetric(videoRowForMetrics.querySelector('.bubble-wrap')),bubble:elementMetric(videoRowForMetrics.querySelector('.bubble')),element:elementMetric(videoRowForMetrics.querySelector('video'))},
        audio:{row:elementMetric(audioRowForMetrics),wrap:elementMetric(audioRowForMetrics.querySelector('.bubble-wrap')),bubble:elementMetric(audioRowForMetrics.querySelector('.bubble')),message:elementMetric(audioRowForMetrics.querySelector('.audio-message')),voiceIcon:elementMetric(audioRowForMetrics.querySelector('.voice-icon')),element:elementMetric(audioRowForMetrics.querySelector('audio'))}
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
      messageLayout:(() => {
        const row=get('beautify-smoke-own');
        const line=row.querySelector('.message-line');
        const avatar=row.querySelector('.chat-avatar');
        const bubble=row.querySelector('.bubble');
        const meta=row.querySelector('.meta');
        const avatarRect=avatar.getBoundingClientRect();
        const bubbleRect=bubble.getBoundingClientRect();
        return {
          lineDisplay:getComputedStyle(line).display,
          metaIsRowSibling:meta.parentElement===row,
          metaInsideBubbleWrap:!!row.querySelector('.bubble-wrap .meta'),
          avatarBottom:Number(avatarRect.bottom.toFixed(2)),
          bubbleBottom:Number(bubbleRect.bottom.toFixed(2))
        };
      })(),
      rows:chat.querySelectorAll('[data-beautify-smoke-id]').length
    };
  });
  assert.equal(baselineMedia.rows, 9, 'all seven message types, a special card and the system row must be constructed');
  assert.equal(baselineMedia.messageLayout.lineDisplay,'flex','avatar and bubble must share one flex line');
  assert.equal(baselineMedia.messageLayout.metaIsRowSibling,true,'time/read metadata must sit below the avatar-bubble line');
  assert.equal(baselineMedia.messageLayout.metaInsideBubbleWrap,false,'metadata must not affect avatar alignment');
  assert.ok(Math.abs(baselineMedia.messageLayout.avatarBottom-baselineMedia.messageLayout.bubbleBottom)<=1,
    'avatar bottom must align to bubble bottom, independently of metadata');
  await page.waitForFunction(() => {
    const image = document.querySelector('[data-beautify-smoke-id="beautify-smoke-image"] img');
    return image && image.complete && image.naturalWidth > 0;
  });
  baselineMedia.imageRect = await page.evaluate(() => {
    const rect = document.querySelector('[data-beautify-smoke-id="beautify-smoke-image"] img').getBoundingClientRect();
    return {width:rect.width,height:rect.height};
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
    for (const id of ["ink-minimal","rose-letter","blue-imessage","mint-sms","miffy-memo","x-blue-dm","x-night-dm","whatsapp-tails","miu-pink-sms","miu-blue-sms","ios6-bluegray","wechat-moon","pink-lemon","line-kitty","pink-gray-stars","picture-frame","soft-double-frame"]) {
      await page.evaluate(presetId => window.DuoChatBeautify.apply(presetId), id);
      await page.evaluate(() => goto('chatPage'));
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
        const specialVoice = id === 'line-kitty';
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
      assert.ok(Math.abs(audit.imageRect.width - baselineMedia.imageRect.width) < 0.5,id + ' must preserve image width: ' + JSON.stringify({before:baselineMedia.imageRect,after:audit.imageRect}));
      assert.ok(Math.abs(audit.imageRect.height - baselineMedia.imageRect.height) < 0.5,id + ' must preserve image height: ' + JSON.stringify({before:baselineMedia.imageRect,after:audit.imageRect}));
      if (id === 'line-kitty') {
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
        assert.ok(audit.mediaElements.video.row && audit.mediaElements.video.bubble,
          id + ' video row and bubble containers must be inspected');
        assert.ok(audit.mediaElements.audio.row && audit.mediaElements.audio.bubble,
          id + ' voice row and bubble containers must be inspected');
        assert.ok(audit.mediaElements.video.element && audit.mediaElements.video.element.rect.width > 0 && audit.mediaElements.video.element.rect.height > 0,
          id + ' video element must have a rendered box');
        assert.ok(audit.mediaElements.audio.element && audit.mediaElements.audio.element.rect.width > 0 && audit.mediaElements.audio.element.rect.height > 0,
          id + ' audio element must have a rendered box');
        assert.ok(audit.mediaElements.audio.message && audit.mediaElements.audio.message.rect.width > 0,
          id + ' voice message container must have a rendered box');
        assert.ok(audit.mediaElements.audio.voiceIcon,id + ' voice icon must be present and inspected');
        assert.equal(audit.media.video.backgroundImage,'none',id + ' video container must retain the media reset');
        assert.equal(audit.media.video.backgroundColor,'rgba(0, 0, 0, 0)',id + ' video container must not inherit a text-bubble fill');
        assert.equal(audit.media.video.paddingTop,'0px',id + ' video container must retain zero media padding');
        assert.equal(audit.media.video.borderTopStyle,'none',id + ' video container must not inherit the ordinary text border');
        assert.equal(audit.media.video.borderTopWidth,'0px',id + ' video container border must be reset');
        assert.equal(audit.media.video.boxShadow,'none',id + ' video container must not inherit the ordinary text shadow');
        assert.equal(audit.media.video.borderRadius,'0px',id + ' video container must retain the source media radius reset');
        assert.equal(audit.media.audio.paddingTop,'0px',id + ' voice container must retain the source zero-padding rule');
        const preset = await page.evaluate(presetId => window.DuoChatBeautify.presets.find(x => x.id === presetId).css,id);
        assert.ok(preset.includes('.bubble.video-bubble'),id + ' must retain explicit video-bubble isolation without :has');
        assert.match(preset,/audio-bubble/,id + ' must retain voice-specific CSS');
      }
      await page.evaluate(() => goto('settingsPage'));
      await exposeBeautifySettings();
      const capturePresetScreenshot=['pink-gray-stars','picture-frame','line-kitty','ink-minimal','rose-letter','blue-imessage','mint-sms'].includes(id);
      if(capturePresetScreenshot){
        await page.locator('[data-preset-card="' + id + '"] .duo-chat-beautify-preview').screenshot({
          path:'artifacts/chat-beautify/' + viewport.name + '-preview-' + id + '.png'
        });
      }
      await page.evaluate(() => goto('chatPage'));
      if(capturePresetScreenshot){
        await page.locator('#chatList').screenshot({
          path:'artifacts/chat-beautify/' + viewport.name + '-chat-' + id + '.png'
        });
      }
      if (['pink-gray-stars','picture-frame'].includes(id)) {
        await page.locator('#chatList').screenshot({
          path:'artifacts/chat-beautify/' + viewport.name + '-decorative-' + id + '.png'
        });
      }
      if (id === 'line-kitty') {
        await page.locator('#chatList').screenshot({
          path:'artifacts/chat-beautify/' + viewport.name + '-media-special-' + id + '.png'
        });
      }
      await page.evaluate(() => goto('settingsPage'));
      await exposeBeautifySettings();
      presetRunResults.push({viewport:viewport.name,...audit});
    }
  }

  await page.evaluate(() => window.DuoChatBeautify.apply('line-kitty'));
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
      const timer = setTimeout(() => resolve({loaded:false,naturalWidth:0,naturalHeight:0,error:'timeout'}),12000);
      image.onload = () => {clearTimeout(timer);resolve({loaded:image.naturalWidth>0 && image.naturalHeight>0,naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight});};
      image.onerror = () => {clearTimeout(timer);resolve({loaded:false,naturalWidth:0,naturalHeight:0,error:'image-error'});};
      image.src = url;
    });
    const results=[];
    for (const asset of assets) {
      const image = await loadImage(asset.url);
      results.push({...asset,browser:image});
    }
    return results;
  }, await page.evaluate(() => {
    const urls = new Map();
    for (const item of window.DuoChatBeautify.presets) {
      for (const match of item.css.matchAll(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi)) {
        const url = match[2];
        if (!/^https?:|^\/\//i.test(url)) continue;
        if (!urls.has(url)) urls.set(url,new Set());
        urls.get(url).add(item.id);
      }
    }
    return [...urls].map(([url,presets]) => ({url,kind:'remote',presets:[...presets]}));
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
  assert.equal(resourceAudit.filter(item=>item.kind==='remote').length,6,'all six remaining remote image URLs must be audited');
  assert.equal(resourceAudit.filter(item=>item.kind==='local').length,10,'all ten active local image assets must be audited');
  const resourceHttpAudit = [];
  for (const asset of resourceAudit) {
    const url = asset.kind === 'local' ? 'http://127.0.0.1:8080' + asset.url : asset.url;
    try {
      const response = await page.request.get(url,{timeout:20000});
      resourceHttpAudit.push({...asset,status:response.status(),contentType:response.headers()['content-type'] || '',contentLength:response.headers()['content-length'] || null});
    } catch (error) {
      resourceHttpAudit.push({...asset,status:null,contentType:'',error:error.message});
    }
  }
  const remoteResourceFailures = resourceAudit.filter(item => item.kind === 'remote' && (
    !item.browser.loaded || !resourceHttpAudit.some(http => http.url === item.url && http.status === 200 && /^image\//i.test(http.contentType))
  )).map(item => ({url:item.url,presets:item.presets || [],browser:item.browser,http:resourceHttpAudit.find(http => http.url === item.url)}));
  writeFileSync('artifacts/chat-beautify/resource-audit.json',JSON.stringify({
    browser:resourceAudit,http:resourceHttpAudit,
    summary:{remoteCount:resourceAudit.filter(item=>item.kind==='remote').length,localCount:resourceAudit.filter(item=>item.kind==='local').length,remoteFailures:remoteResourceFailures}
  },null,2));
  writeFileSync('artifacts/chat-beautify/preset-browser-audit.json',JSON.stringify({cssomAudit,presetRunResults},null,2));
  writeFileSync('artifacts/chat-beautify/media-special-audit.json',JSON.stringify({
    results:presetRunResults.filter(item=>item.id==='line-kitty').map(item=>({
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
  const previousPresetId=beautifyBefore.selectedId==='carbon-glass'?'ink-minimal':beautifyBefore.selectedId;
  await page.evaluate(() => {state.chatBeautifyPresetId='carbon-glass';save();});
  const migratedPreset=await page.evaluate(() => ({
    selectedId:window.DuoChatBeautify.getCurrent(),
    storedId:state.chatBeautifyPresetId
  }));
  assert.equal(migratedPreset.selectedId,'ink-minimal','legacy Carbon Glass selection should migrate to Ink Minimal');
  assert.equal(migratedPreset.storedId,'ink-minimal','legacy ID must be rewritten in persisted state');
  await page.evaluate(id => id ? window.DuoChatBeautify.apply(id) : window.DuoChatBeautify.reset(),previousPresetId);
  await page.evaluate(() => {
    if (typeof goto === 'function') goto('settingsPage');
    if (typeof window.__duoOpenSettingsCategory === 'function') {
      window.__duoOpenSettingsCategory('appearance');
    }
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
  const darkThemeTailAudit=await page.evaluate(() => {
    const list=document.getElementById('chatList');
    const other=buildMessageRow({id:'dark-tail-other',sender:'other',type:'text',text:'深色模式接收方尾巴',time:'20:20'});
    const me=buildMessageRow({id:'dark-tail-me',sender:'me',type:'text',text:'深色模式发送方尾巴',time:'20:21',read:true});
    list.append(other,me);
    window.DuoChatBeautify.apply('mint-sms');
    const otherBubble=other.querySelector('.bubble');
    const meBubble=me.querySelector('.bubble');
    const otherTail=getComputedStyle(otherBubble,'::after');
    const meTail=getComputedStyle(meBubble,'::after');
    return {
      resolved:document.documentElement.dataset.duoThemeResolved,
      incoming:{mask:otherTail.maskImage,backgroundImage:otherTail.backgroundImage,backgroundColor:otherTail.backgroundColor,bubbleColor:getComputedStyle(otherBubble).backgroundColor},
      outgoing:{mask:meTail.maskImage,backgroundImage:meTail.backgroundImage,backgroundColor:meTail.backgroundColor,bubbleColor:getComputedStyle(meBubble).backgroundColor}
    };
  });
  assert.equal(darkThemeTailAudit.resolved,'dark');
  assert.ok(darkThemeTailAudit.incoming.mask.includes('theme-a559ffc20c358860.svg'),'incoming SMS tail should use its transparent shape as a dark-mode mask');
  assert.ok(darkThemeTailAudit.outgoing.mask.includes('theme-607e5703516d09dc.png'),'outgoing SMS tail should use its transparent shape as a dark-mode mask');
  assert.equal(darkThemeTailAudit.incoming.backgroundImage,'none');
  assert.equal(darkThemeTailAudit.outgoing.backgroundImage,'none');
  assert.equal(darkThemeTailAudit.incoming.backgroundColor,darkThemeTailAudit.incoming.bubbleColor);
  assert.equal(darkThemeTailAudit.outgoing.backgroundColor,darkThemeTailAudit.outgoing.bubbleColor);

  await page.locator('#duoThemeMode').selectOption('system');
  await page.emulateMedia({colorScheme:'dark'});
  await page.waitForFunction(() => document.documentElement.dataset.duoThemeResolved==='dark');
  const systemDarkResolved=await page.evaluate(() => document.documentElement.dataset.duoThemeResolved);
  await page.emulateMedia({colorScheme:'light'});
  await page.waitForFunction(() => document.documentElement.dataset.duoThemeResolved==='light');
  const systemLightResolved=await page.evaluate(() => document.documentElement.dataset.duoThemeResolved);
  assert.equal(systemDarkResolved,'dark','system mode must follow a dark OS color scheme');
  assert.equal(systemLightResolved,'light','system mode must follow a light OS color scheme');
  await page.locator('#duoThemeMode').selectOption('dark');
  await page.waitForFunction(() => document.documentElement.dataset.duoThemeResolved==='dark');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.duoThemeResolved === 'dark');
  const persistedTheme = await page.evaluate(() => state.appearanceSettings.palette);
  assert.equal(persistedTheme, 'ocean', 'theme choice should persist after reload');

  await page.evaluate(() => goto('chatPage'));
  await page.waitForFunction(() => document.getElementById('chatPage')?.classList.contains('active'));
  await page.locator('#emojiBtn').click();
  await page.waitForFunction(() => document.querySelector('#stickerOverlay')?.classList.contains('show'));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j+a8AAAAASUVORK5CYII=', 'base64');
  const gif = Buffer.from('R0lGODlhAgACAIEAAP8AAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQIDAAAACwAAAAAAgACAAAIBgABCAQQEAAh+QQIDAAAACwAAAAAAgACAIEAAP8AAAAAAAAAAAAIBgABCAQQEAA7', 'base64');
  await page.locator('#stickerUploader').setInputFiles([
    { name: 'smoke.png', mimeType: 'image/png', buffer: png },
    { name: 'smoke.gif', mimeType: 'image/gif', buffer: gif }
  ]);
  await page.waitForFunction(() => window.__duoStickerState.exportSnapshot().items.filter(item => item.source !== 'builtin').length === 2);
  const uploaded = await page.evaluate(() => window.__duoStickerState.exportSnapshot().items.filter(item => item.source !== 'builtin').map(item => ({id:item.id,mediaId:item.mediaId,mimeType:item.mimeType})));
  assert.equal(uploaded.length,2);
  assert.ok(uploaded.some(item=>item.mimeType==='image/png'));
  assert.ok(uploaded.some(item=>item.mimeType==='image/gif'));
  for (const item of uploaded) {
    const card=page.locator('#stickerGrid [data-sticker-id="'+item.id+'"]');
    await card.locator('img').evaluate(img=>img.decode());
    assert.ok(await card.locator('img').evaluate(img=>img.naturalWidth>0));
  }
  const favoriteCard=page.locator('#stickerGrid [data-sticker-id="'+uploaded[0].id+'"]');
  await favoriteCard.locator('[data-sticker-favorite]').click();
  await page.waitForFunction(id=>window.__duoStickerState.exportSnapshot().favorites.includes(id),uploaded[0].id);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(() => !!window.__duoStickerState?.exportSnapshot?.().items?.length);
  assert.ok(await page.evaluate(id=>window.__duoStickerState.exportSnapshot().favorites.includes(id),uploaded[0].id),'favorite should survive reload');
  await page.evaluate(() => goto('chatPage'));
  await page.waitForFunction(() => document.getElementById('chatPage')?.classList.contains('active'));
  await page.locator('#emojiBtn').click();
  await page.waitForFunction(() => document.querySelector('#stickerOverlay')?.classList.contains('show'));
  const sendCard=page.locator('#stickerGrid [data-sticker-id="'+uploaded[0].id+'"]');
  await sendCard.click();
  await page.waitForFunction(id=>state.chatHistory.some(message=>message.mediaId===id),uploaded[0].mediaId);
  assert.equal(await page.locator('#stickerOverlay.show').count(),0,'sending a sticker must close the sticker sheet');
  await page.evaluate(() => { goto('settingsPage'); setSettingsTab('param'); });
  await page.locator('[data-settings-category="stickers"]').click();
  await page.waitForSelector('[data-sticker-admin-grid]');
  await page.locator('[data-sticker-admin-filter="uploads"]').click();
  for (const item of uploaded) {
    const checkbox=page.locator('[data-sticker-admin-select="'+item.id+'"]');
    await checkbox.check();
    page.once('dialog',dialog=>dialog.accept());
    await page.locator('[data-sticker-admin-delete]').click();
    await page.waitForFunction(id=>!window.__duoStickerState.exportSnapshot().items.some(entry=>entry.id===id),item.id);
    if(item.mediaId===uploaded[0].mediaId){
      assert.ok(await page.evaluate(async id=>!!(await getMediaRecord(id)),item.mediaId),'deleting a sticker already sent to chat must preserve the referenced media');
    }else{
      await page.waitForFunction(async id=>!(await getMediaRecord(id)),item.mediaId);
    }
  }
  await page.locator('#settingsCategoryBack').click();
  await page.evaluate(() => goto('chatPage'));
  await page.waitForFunction(() => document.getElementById('chatPage')?.classList.contains('active'));
  await page.locator('#emojiBtn').click();
  await page.waitForFunction(() => document.querySelectorAll('#stickerGrid [data-sticker-id]').length === 352);
  assert.equal(await page.locator('#stickerGrid .sticker-send').count(),0,'the reference-style sticker picker has no Send buttons');
  await page.locator('#stickerClose').click();
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

  const allPresetScrollAudit = [];
  const allPresetPerformanceAudit = [];
  for (const viewport of [
    {name:'desktop',width:1365,height:900},
    {name:'mobile',width:390,height:844}
  ]) {
    await page.setViewportSize({width:viewport.width,height:viewport.height});
    const samples = await page.evaluate(async () => {
      const list = document.getElementById('chatList');
      const composer = document.querySelector('#chatPage .composer');
      const originalHistory = state.chatHistory;
      const originalPhrases = state.cardPhrases;
      const originalLastChatAt = state.offline.lastChatAt;
      state.cardPhrases = [];
      const results = [];
      for (const preset of window.DuoChatBeautify.presets) {
        const synthetic = Array.from({length:400}, (_,i) => {
          const id = 'all-css-audit-'+preset.id+'-'+i;
          if (i % 11 === 0) return {id,type:'system',text:'系统记录 · 历史消息 '+i,time:'14:29'};
          if (i % 37 === 0) return {id,sender:i%2?'me':'other',type:'image',time:'14:29'};
          if (i % 41 === 0) return {id,sender:i%2?'me':'other',type:'video',time:'14:29'};
          if (i % 43 === 0) return {id,sender:i%2?'me':'other',type:'audio',time:'14:29'};
          if (i % 47 === 0) return {id,sender:i%2?'me':'other',type:'sticker',time:'14:29'};
          return {id,sender:i%2?'me':'other',type:'text',text:preset.name+' 历史消息 '+i+' · 长列表滚动回归',time:'14:29',read:false};
        });
        const fragment = document.createDocumentFragment();
        for (const message of synthetic) fragment.appendChild(buildMessageRow(message));
        list.replaceChildren(fragment);
        state.chatHistory = synthetic;

        const started = performance.now();
        window.DuoChatBeautify.apply(preset.id);
        const applied = performance.now();

        let checksum = 0;
        const bubbles = list.querySelectorAll('.bubble');
        for (const bubble of bubbles) {
          const computed = getComputedStyle(bubble);
          const before = getComputedStyle(bubble,'::before');
          const after = getComputedStyle(bubble,'::after');
          checksum += computed.borderTopWidth.length + before.content.length + after.content.length;
        }
        const styled = performance.now();

        sendCurrentText('滚动验收最新消息 · '+preset.name);
        await new Promise(resolve => requestAnimationFrame(() =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        ));

        const latest = state.chatHistory[state.chatHistory.length-1];
        const latestRow = latest ? list.querySelector('[data-mid="'+latest.id+'"]') : null;
        const latestRect = latestRow?.getBoundingClientRect();
        const listRect = list.getBoundingClientRect();
        const composerRect = composer.getBoundingClientRect();
        const visibleBottom = Math.min(listRect.bottom,composerRect.top);
        const maxScroll = Math.max(0,list.scrollHeight-list.clientHeight);
        const distanceToBottom = Math.max(0,maxScroll-list.scrollTop);
        const result = {
          presetId:preset.id,
          presetName:preset.name,
          historyCount:synthetic.length,
          messageOrderCorrect:!!latest && latest.text==='滚动验收最新消息 · '+preset.name &&
            latest.id===state.chatHistory[state.chatHistory.length-1].id,
          overflowY:getComputedStyle(list).overflowY,
          distanceToBottom:Number(distanceToBottom.toFixed(1)),
          latestRowVisible:!!latestRect && latestRect.top>=listRect.top-1 && latestRect.bottom<=visibleBottom+1,
          latestRowBottom:latestRect?Number(latestRect.bottom.toFixed(1)):null,
          visibleBottom:Number(visibleBottom.toFixed(1)),
          applySyncMs:Number((applied-started).toFixed(2)),
          styleAndLayoutMs:Number((styled-applied).toFixed(2)),
          totalStyleMs:Number((styled-started).toFixed(2)),
          checksum,
          bubbleCount:bubbles.length
        };
        results.push(result);
        list.replaceChildren();
      }
      window.DuoChatBeautify.reset();
      state.chatHistory = originalHistory;
      state.cardPhrases = originalPhrases;
      state.offline.lastChatAt = originalLastChatAt;
      renderChatHistory(false);
      save();
      return results;
    });
    allPresetScrollAudit.push(...samples.map(item=>({viewport:viewport.name,...item})));
    allPresetPerformanceAudit.push(...samples.map(item=>({
      viewport:viewport.name,
      presetId:item.presetId,
      presetName:item.presetName,
      applySyncMs:item.applySyncMs,
      styleAndLayoutMs:item.styleAndLayoutMs,
      totalStyleMs:item.totalStyleMs,
      bubbleCount:item.bubbleCount
    })));
  }
  await page.setViewportSize({width:1365,height:900});
  const scrollFailures = allPresetScrollAudit.filter(item =>
    !item.messageOrderCorrect || item.overflowY!=='auto' ||
    item.distanceToBottom>2 || !item.latestRowVisible
  );
  assert.equal(allPresetScrollAudit.length,34,'all 17 presets must be checked on desktop and mobile viewports');
  assert.deepEqual(scrollFailures,[],'every preset must keep the newest sent message visible and the chat list at bottom: '+JSON.stringify(scrollFailures));
  console.log('ALL_PRESET_SCROLL_AUDIT '+JSON.stringify(allPresetScrollAudit));
  console.log('ALL_PRESET_PERFORMANCE_AUDIT '+JSON.stringify(allPresetPerformanceAudit));
  // New second-level settings, unified card pools/recent usage, mailbox drafts and V4 inclusion.
  await page.evaluate(() => { goto('settingsPage'); setSettingsTab('param'); });
  await page.locator('[data-settings-category="cards"]').click();
  await page.waitForSelector('#duoUnifiedCardPanel');
  await page.locator('[data-card-input="chat"]').fill('浏览器验收字卡');
  await page.locator('[data-card-add="chat"]').click();
  const recentBeforeDraw = await page.evaluate(() => window.__duoCardSystem.getRecent().length);
  await page.evaluate(() => { window.__testRandomOriginal=Math.random; Math.random=()=>0.999999; });
  await page.locator('[data-card-draw="chat"]').click();
  await page.evaluate(() => { Math.random=window.__testRandomOriginal; delete window.__testRandomOriginal; });
  const afterPreview = await page.evaluate(() => window.__duoCardSystem.getRecent().length);
  assert.equal(afterPreview,recentBeforeDraw,'previewing a random card must not count as actual use');
  assert.equal(await page.locator('[data-card-preview="chat"]').textContent(),'浏览器验收字卡','random draw preview should show the selected card');
  await page.locator('[data-card-use="chat"]').click();
  await page.locator('[data-card-input="moments-dynamic"]').fill('朋友圈动态验收字卡');
  await page.locator('[data-card-add="moments-dynamic"]').click();
  await page.locator('[data-card-input="moments-reply"]').fill('朋友圈回复验收字卡');
  await page.locator('[data-card-add="moments-reply"]').click();
  const cardAudit = await page.evaluate(() => ({
    chat:state.cardPhrases.includes('浏览器验收字卡'),
    dynamic:window.__duoCircleApi.exportState().dynamicCards.includes('朋友圈动态验收字卡'),
    reply:window.__duoCircleApi.exportState().replyCards.includes('朋友圈回复验收字卡'),
    recent:window.__duoCardSystem.getRecent().some(x=>x.textSnapshot==='浏览器验收字卡'),
    previewOnlyDoesNotCount:true
  }));
  assert.deepEqual(cardAudit,{chat:true,dynamic:true,reply:true,recent:true,previewOnlyDoesNotCount:true},'the three card pools must remain distinct and actual use must be recorded');
  await page.locator('#settingsCategoryBack').click();
  assert.equal(await page.locator('[data-settings-category]').count(),7,'all seven independent settings categories must be available');
  await page.locator('[data-settings-category="appearance"]').click();
  const appearanceCategory = await page.evaluate(() => ({theme:!document.getElementById('duoAppearancePanel').hidden,font:!document.getElementById('duoFontPanel').hidden,beautify:!document.getElementById('duoChatBeautifyPanel').hidden}));
  assert.deepEqual(appearanceCategory,{theme:true,font:true,beautify:true},'theme, font and CSS beautification controls should live in the appearance subpage');
  await page.locator('#settingsCategoryBack').click();
  await page.locator('[data-settings-category="calls"]').click();
  await page.waitForSelector('#callMasterEnabled');
  assert.equal(await page.locator('#incomingCallFrequency').inputValue(),'low','legacy call settings should migrate to the reference low-frequency preset');
  await page.locator('#incomingCallFrequency').selectOption('high');
  await page.locator('#callSettingsCancel').click();
  await page.locator('[data-settings-category="calls"]').click();
  assert.equal(await page.locator('#incomingCallFrequency').inputValue(),'low','Cancel must discard staged call-setting changes');
  await page.locator('#incomingCallFrequency').selectOption('medium');
  await page.locator('#callMasterEnabled').check();
  await page.locator('#callIncomingEnabled').check();
  await page.locator('#callIncomingAudioEnabled').check();
  await page.locator('#callIncomingVideoEnabled').check();
  await page.locator('#callSettingsSave').click();
  await page.waitForFunction(() => state.incomingCallSettings.frequency==='medium' && state.incomingCallSettings.minIntervalSec===1800 && state.incomingCallSettings.maxIntervalSec===5400);
  assert.equal(await page.locator('#settingsCategoryGrid').count(),1,'saving call settings should return to the parameter category list');
  await page.locator('[data-settings-category="mail"]').click();
  await page.waitForSelector('[data-mail-settings-form]');
  const originalMailSettings=await page.evaluate(()=>window.__duoMailbox.exportData().mailbox.settings);
  await page.locator('#mailIncomingMin').fill('13');
  await page.locator('#mailSettingsCancel').click();
  await page.locator('[data-settings-category="mail"]').click();
  assert.equal(await page.locator('#mailIncomingMin').inputValue(),String(Number((originalMailSettings.minIncomingMin/60).toFixed(2))),'Cancel must discard staged mailbox settings');
  await page.locator('#mailSettingsDefault').click();
  assert.equal(await page.locator('#mailCardCountMin').inputValue(),'2','restore defaults must restore the default minimum card count');
  await page.locator('#mailAutoIncoming').check();
  await page.locator('#mailIncomingMin').fill('12');
  await page.locator('#mailIncomingMax').fill('36');
  await page.locator('#mailReplyMin').fill('2');
  await page.locator('#mailReplyMax').fill('15');
  await page.locator('#mailCardCountMin').fill('3');
  await page.locator('#mailCardCountMax').fill('4');
  await page.locator('#mailSettingsSave').click();
  await page.waitForFunction(() => {const s=window.__duoMailbox.exportData().mailbox.settings;return s.minIncomingMin===720&&s.maxIncomingMin===2160&&s.cardCountMin===3&&s.cardCountMax===4&&s.autoIncoming===true;});
  const savedMailSettings=await page.evaluate(()=>window.__duoMailbox.exportData().mailbox.settings);
  assert.deepEqual({min:savedMailSettings.minIncomingMin,max:savedMailSettings.maxIncomingMin,cardMin:savedMailSettings.cardCountMin,cardMax:savedMailSettings.cardCountMax,enabled:savedMailSettings.autoIncoming},{min:720,max:2160,cardMin:3,cardMax:4,enabled:true},'mail settings must save hours, minutes and card bounds into mailbox state');
  await page.evaluate(() => goto('mailPage'));
  await page.locator('#mailComposeBtn').click();
  await page.locator('#mailComposeTitle').fill('浏览器验收信件');
  await page.locator('#mailComposeContent').fill('这是一封用于回归测试的信。');
  await page.locator('#mailInsertCardBtn').click();
  await page.locator('#mailDraftBtn').click();
  const draftCount = await page.locator('#mailDraftList [data-mail-draft]').count();
  assert.equal(draftCount,1,'typing and explicit save should persist a draft');
  const mailJpegDataUrl=await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=160;canvas.height=80;
    const context=canvas.getContext('2d');context.fillStyle='#f2d7c9';context.fillRect(0,0,160,80);
    context.fillStyle='#354b63';context.fillRect(12,10,136,60);
    context.fillStyle='#ffffff';context.fillRect(28,24,104,32);
    return canvas.toDataURL('image/jpeg',0.9);
  });
  const mailJpegBuffer=Buffer.from(mailJpegDataUrl.split(',')[1],'base64');
  const mailImageFixtures=[
    {name:'letter-original.jpg',mimeType:'image/jpeg',buffer:mailJpegBuffer},
    {name:'letter-landscape.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAPAAAABaCAIAAAAJsExNAAAAxElEQVR42u3SAQ0AMAjAsHMhOMUkitABaSUsi6x+cMWXAEODocHQYGgMDYYGQ4OhwdAYGgwNhgZDg6ExNBgaDA2GBkODocHQYGgwNBgaQ4OhwdBgaAwNhgZDg6HB0BgaDA2GBkODoTE0GBoMDYYGQ2NoMDQYGgwNhsbQYGgwNBgaDI2hwdBgaDA0GBpDg6HB0GBoMDSGBkODocHQGBoMDYYGQ4OhMTQYGgwNhgZDY2jYagCYLwIh2nWq4wAAAABJRU5ErkJggg==','base64')},
    {name:'letter-portrait.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEYAAADSCAIAAAB4uyGGAAAB/ElEQVR42u3cO27DMAwA0FjoJXqszj1f5h6rJ/DetciQyJKoX563IADJZ1KynCHHeZ63va502+5CQkJCQkKa6frokOP36/v/x8+fe2i6I/RA9IDpA0tDPC+/nZGUU3GQKo3yxKnSQE+QKo31RKg8asNudsNGpRk8bVUGL/gGN4mjS/FbcH00XXoHUsQhrTKmLvV656mJrEt7k+KmrjK+Lm1Mip66miy6hLQMqc9CKs6lS0hrkHoupLKMuoS0AKn/QirIa/CQkLqTRu0NV7MbPCQkpErS2O3uUg0GDwkJCWm6HTy/EoOHhISEhLQWaZ7nbGY9Bg8JCQkJCQkJCWl90mzH8JyqDB4SEhISEhISEhISEhISEhISEhISEhISEhISEhLSdKTof2gvu55XZfCQkJCQkJCQkJC2IM12GH9Zj8FDQkJCQlqONM/TNqcSg4eEhIQ04z6eWYPBQ0JCqieN3fTysxs8JKQRpFE7xKW8Bg9pDVL/5XQ1oy4hLUPquZwKcukS0kqkPsupLIsu7U2Knr3i+Lq0PSlu9moi61KXRlXG1KU3IbWdvfpouhTcqCZxdCnyBrdqdZpkZTfcYwxezM1u+xho36Wr9TU/UoUMXn6VEUfEqLWUU2vQu0ng9vC84rh3reM8z+gt6OEfzaN/tOhB8nKBhISEhPTGpD9Zn5Qf1FK8bQAAAABJRU5ErkJggg==','base64')},
    {name:'letter-square.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAHgAAAB4CAIAAAC2BqGFAAAA1ElEQVR42u3UwQnAIBBE0RjsyDKsI1WljpRhOXO3BSEEhLx/38tj2JLk0PedCECDFmjQoAUatECDBi3QoAUaNGiBBi3Qe1bfHLfn+pvX6LdFex0CDRq0QIMWaNCgBRq0QIMGLdCgQSMADVqgQYMWaNACDRq0QIMWaNCgBRq0QIMGLdCgBRo0aIEGLdCgQQs0aIEGDVqgQQs0aNACDVqgQYMWaNACDRq0QIMWaNCgBRq0QIMGLdCgtVZJQsGiQQs0aNACDVqgQYMWaNACDRq0QIMW6A2bp0UJrwA5ekEAAAAASUVORK5CYII=','base64')},
    {name:'letter-transparent.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAABjklEQVR42u3dwVFDMQxF0W/VQjksKIHSUgILyqEYWoAZy5blc/dMLN3/pGQywc8DAAAAAADqME478M/H9+u/f/P29f5JyEYBJwsat0g4Rc64UUJlOYOIWmIGEbXEBBm1zjmIqJWWIKPW+YOMWnUMImqNsCCjVn1BRq06g4xa9caDUoR01Ko7yKhVf5BRS4od0m2HSMfcfgQZtaQYWV1GlnTk9EdCOiREOvL6JCHd3vZisxDjKrdfEmJkYZoQ4yp/bEmIkQVCOgqxP9bsEQkxskAIISCEEBBCCAghBISAkHZCTvoXRxX5a/8kxMgCIV2F2CO5+0NCjCxMF2Js5fZLQowsTBdibOX1SUK6jCwpyemPhHRa6lIyvy+x88XJMLLu+BwiJfP6EJUOc7uM6SPrVikz67ZDOu6Qm1Myu9444ZC3yEgdWd2lZNW35P6QTj8YzX7QokMRXWQsfZd1upRV599yKdhJI2z1gxQ3FHnSOd1jWOyBcdNnseS6C9dduPvluC16syDf1wAAAAAAjuEX8lS8lOMF0MkAAAAASUVORK5CYII=','base64')},
    {name:'letter-animated.gif',mimeType:'image/gif',buffer:gif}
  ];
  await page.locator('#mailImageInput').setInputFiles(mailImageFixtures);
  await page.waitForFunction(() => {
    const draft=window.__duoMailbox.exportData().drafts.find(item=>item.title==='浏览器验收信件');
    return draft?.images?.length===5 && draft.images.filter(image=>image.mimeType==='image/png').length===4 && draft.images[4].mimeType==='image/gif';
  });
  await page.locator('#mailComposeSend').click();
  const mailboxAudit = await page.evaluate(() => {
    const data=window.__duoMailbox.exportData();
    const letter=data.mailbox.items.find(x=>x.type==='outgoing'&&x.title==='浏览器验收信件');
    return {outgoing:!!letter,drafts:data.drafts.length,fragments:letter?.cardFragments?.length||0,imageMimes:letter?.images?.map(image=>image.mimeType)||[],imageIds:letter?.images?.map(image=>image.id)||[]};
  });
  assert.equal(mailboxAudit.outgoing,true,'manual letters should be persisted independently');
  assert.equal(mailboxAudit.drafts,0,'sent drafts should be removed from the draft list');
  assert.equal(mailboxAudit.fragments,1,'selected card fragments should be snapshotted into the letter');
  assert.deepEqual(mailboxAudit.imageMimes,['image/jpeg','image/png','image/png','image/png','image/png','image/gif'],'letter attachment formats must be preserved');
  const expectedBytes=mailImageFixtures.map(file=>file.buffer.toString('base64'));
  const storedBytes=await page.evaluate(async ids=>Promise.all(ids.map(async id=>{
    const record=await getMediaRecord(id);if(!record?.blob)return {type:'',base64:''};
    const bytes=new Uint8Array(await record.blob.arrayBuffer());let binary='';
    for(let offset=0;offset<bytes.length;offset+=0x8000)binary+=String.fromCharCode(...bytes.subarray(offset,Math.min(offset+0x8000,bytes.length)));
    return {type:record.blob.type,base64:btoa(binary)};
  })),mailboxAudit.imageIds);
  assert.deepEqual(storedBytes.map(item=>item.type),mailboxAudit.imageMimes,'original PNG and GIF MIME types must remain in IndexedDB media blobs');
  assert.deepEqual(storedBytes.map(item=>item.base64),expectedBytes,'mail attachments must be byte-preserved without image re-encoding');
  const mailLetterId=await page.evaluate(title=>window.__duoMailbox.exportData().mailbox.items.find(x=>x.title===title)?.id,'浏览器验收信件');
  await page.locator('#mailLetterList [data-mail-open="'+mailLetterId+'"]').click();
  await page.waitForFunction(()=>document.querySelectorAll('#mailReadImages .mail-read-image img').length===5&&Array.from(document.querySelectorAll('#mailReadImages .mail-read-image img')).every(img=>img.complete&&img.naturalWidth>0));
  const mailImageLayouts=await page.locator('#mailReadImages .mail-read-image img').evaluateAll(images=>images.map(img=>{
    const rect=img.getBoundingClientRect(),style=getComputedStyle(img);
    return {objectFit:style.objectFit,naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,renderedWidth:rect.width,renderedHeight:rect.height};
  }));
  assert.ok(mailImageLayouts.every(item=>item.objectFit==='contain'),'all letter body images must use contain, never crop edges');
  assert.ok(mailImageLayouts.every(item=>item.naturalWidth>0&&item.naturalHeight>0),'all letter attachments must decode in the reading view');
  assert.ok(mailImageLayouts.every(item=>Math.abs((item.renderedWidth/item.renderedHeight)/(item.naturalWidth/item.naturalHeight)-1)<0.02),'horizontal, portrait, square, transparent PNG and GIF must preserve their original aspect ratios');
  await page.locator('#mailReadClose').click();
  const extendedBackup = await page.evaluate(async () => {
    const blob=await window.__duoBackupV4.build('all');
    const parsed=await window.__duoBackupV4.unzip(blob);
    return {mailbox:parsed.map.has('mailbox-data.json'),cards:parsed.map.has('card-system.json'),circleSettings:parsed.map.has('circle-settings.json')||parsed.map.has('circle-state.json'),resources:parsed.manifest.resources.length};
  });
  assert.equal(extendedBackup.mailbox,true,'all backup must include letters and drafts');
  assert.equal(extendedBackup.cards,true,'all backup must include card IDs and recent usage');
  assert.equal(extendedBackup.circleSettings,true,'param/all data paths must preserve the Circle settings area');
  assert.ok(extendedBackup.resources>=4,'all backup should include state, Circle, mailbox and card system');
  const roundTrip = await page.evaluate(async () => {
    const archive=await window.__duoBackupV4.build('all');
    window.__duoMailbox.importData({mailbox:{items:[],pending:[],settings:{autoIncoming:false,autoReply:false}},drafts:[]});
    window.__duoCardSystem.importData({version:1,chatIds:[],chatTexts:[],momentsDynamic:[],momentsReply:[],momentsDynamicIds:[],momentsReplyIds:[],recentDrawnRepliesV1:[],notificationsEnabled:true});
    await window.__duoBackupV4.restore(archive);
    const mail=window.__duoMailbox.exportData(),cards=window.__duoCardSystem.exportData(),circle=window.__duoCircleApi.exportState();
    return {
      letter:mail.mailbox.items.some(x=>x.title==='浏览器验收信件'),
      recent:cards.recentDrawnRepliesV1.some(x=>x.textSnapshot==='浏览器验收字卡'),
      dynamic:circle.dynamicCards.includes('朋友圈动态验收字卡'),
      reply:circle.replyCards.includes('朋友圈回复验收字卡'),
      chat:state.cardPhrases.includes('浏览器验收字卡'),
      mailMin:mail.mailbox.settings.minIncomingMin,mailMax:mail.mailbox.settings.maxIncomingMin,
      mailReplyMin:mail.mailbox.settings.minReplyMin,mailReplyMax:mail.mailbox.settings.maxReplyMin,
      cardMin:mail.mailbox.settings.cardCountMin,cardMax:mail.mailbox.settings.cardCountMax,
      callFrequency:state.incomingCallSettings.frequency,
      callMin:state.incomingCallSettings.minIntervalSec,callMax:state.incomingCallSettings.maxIntervalSec
    };
  });
  assert.deepEqual(roundTrip,{letter:true,recent:true,dynamic:true,reply:true,chat:true,mailMin:720,mailMax:2160,mailReplyMin:2,mailReplyMax:15,cardMin:3,cardMax:4,callFrequency:'medium',callMin:1800,callMax:5400},'V4 all restore must round-trip letters, cards, call frequency and mailbox settings');
  const paramBackup = await page.evaluate(async () => {const parsed=await window.__duoBackupV4.unzip(await window.__duoBackupV4.build('param'));return {circle:parsed.map.has('circle-settings.json'),mailbox:parsed.map.has('mailbox-data.json'),cards:parsed.map.has('card-system.json')};});
  assert.deepEqual(paramBackup,{circle:true,mailbox:true,cards:true},'parameter backup must include Circle settings, mailbox and card-system data');
  await page.evaluate(() => goto('homePage'));

  console.log(JSON.stringify({
    result: 'passed',
    themePersisted: true,
    cssBeautifyPresets: beautifyBefore.count,
    cssBeautifyBrowserViews: presetRunResults.length,
    cssBeautifyScreenshots: 36,
    cssomPresetRules: cssomAudit.reduce((sum,item)=>sum+item.ruleCount,0),
    resourceAuditFailures: resourceHttpAudit.filter(item=>item.status!==200 || !/^image\//i.test(item.contentType)).length + resourceAudit.filter(item=>!item.browser.loaded).length,
    remoteResourceFailures,
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
    fontResources: backupResult.fonts,
    sevenSettingsCategories: true,
    appearanceCategory,
    circleNotificationToggle: true,
    distinctCardPools: cardAudit,
    mailbox: mailboxAudit,
    extendedBackup: extendedBackup,
    paramBackup,
    roundTrip
  }, null, 2));
} finally {
  await browser.close();
}
