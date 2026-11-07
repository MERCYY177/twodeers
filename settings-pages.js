/* Settings navigation with a consolidated personalization page and page-local settings entry points. */
(function(){
  'use strict';
  if(window.__duoSettingsPagesInstalled)return;
  window.__duoSettingsPagesInstalled=true;

  const $=selector=>document.querySelector(selector);
  const param=()=>$('#settingsParam');
  const directPanels=()=>Array.from(param()?.querySelectorAll(':scope > .panel-card')||[]);
  const heading=element=>element?.querySelector('h3')?.textContent?.trim()||'';

  function setPanelId(title,id){
    const panel=directPanels().find(item=>heading(item)===title);
    if(panel&&!panel.id)panel.id=id;
    return panel||null;
  }

  function buildCardManager(){
    if($('#duoUnifiedCardPanel'))return;
    const card=document.createElement('section');
    card.className='panel-card';
    card.id='duoUnifiedCardPanel';
    card.innerHTML=`
      <h3>字卡管理</h3>
      <div class="duo-card-tabs" role="tablist" aria-label="字卡分类">
        <button type="button" class="active" role="tab" aria-selected="true" data-card-tab="chat">主字卡</button>
        <button type="button" role="tab" aria-selected="false" data-card-tab="recent">最近抽过</button>
        <button type="button" role="tab" aria-selected="false" data-card-tab="moments-dynamic">朋友圈动态</button>
        <button type="button" role="tab" aria-selected="false" data-card-tab="moments-reply">朋友圈回复</button>
      </div>
      <section class="duo-card-pane" data-card-pane="chat">
        <div class="duo-card-editor"><button type="button" data-card-draw="chat">随机抽一条</button><button type="button" data-card-use="chat" disabled>确认使用</button></div>
        <div class="duo-card-preview" data-card-preview="chat"></div>
        <div class="duo-card-editor"><input data-card-input="chat" maxlength="1000" placeholder="添加聊天字卡"><button type="button" data-card-add="chat">添加</button></div><div data-card-list="chat"></div>
      </section>
      <section class="duo-card-pane" data-card-pane="moments-dynamic" hidden>
        <div class="duo-card-editor"><button type="button" data-card-draw="moments-dynamic">随机抽一条</button><button type="button" data-card-use="moments-dynamic" disabled>确认使用</button></div>
        <div class="duo-card-preview" data-card-preview="moments-dynamic"></div>
        <div class="duo-card-editor"><input data-card-input="moments-dynamic" maxlength="1000" placeholder="添加朋友圈动态字卡"><button type="button" data-card-add="moments-dynamic">添加</button></div><div data-card-list="moments-dynamic"></div>
      </section>
      <section class="duo-card-pane" data-card-pane="moments-reply" hidden>
        <div class="duo-card-editor"><button type="button" data-card-draw="moments-reply">随机抽一条</button><button type="button" data-card-use="moments-reply" disabled>确认使用</button></div>
        <div class="duo-card-preview" data-card-preview="moments-reply"></div>
        <div class="duo-card-editor"><input data-card-input="moments-reply" maxlength="1000" placeholder="添加朋友圈回复字卡"><button type="button" data-card-add="moments-reply">添加</button></div><div data-card-list="moments-reply"></div>
      </section>
      <section class="duo-card-pane" data-card-pane="recent" hidden><div data-recent-cards></div></section>`;
    param()?.appendChild(card);
    card.addEventListener('click',event=>{
      const tab=event.target.closest('[data-card-tab]');
      if(!tab||!card.contains(tab))return;
      const key=tab.dataset.cardTab;
      card.querySelectorAll('[data-card-tab]').forEach(button=>{
        const active=button===tab;
        button.classList.toggle('active',active);
        button.setAttribute('aria-selected',String(active));
      });
      card.querySelectorAll('[data-card-pane]').forEach(pane=>pane.hidden=pane.dataset.cardPane!==key);
    });
  }

  function ensureMount(id){
    let host=$('#'+id);
    if(host)return host;
    host=document.createElement('div');
    host.id=id;
    host.className='duo-settings-mount';
    param()?.appendChild(host);
    return host;
  }


  function mountStickerManager(){
    const host=ensureMount('paramStickerAdminMount');
    if(!host.dataset.mounted){
      if(window.__duoStickerAdmin?.mount){
        window.__duoStickerAdmin.mount(host);
        host.dataset.mounted='true';
      }else{
        host.textContent='表情包管理模块尚未加载';
      }
    }
  }

  let appearanceOverlay=null;
  function buildAppearanceSuite(){
    if(appearanceOverlay)return appearanceOverlay;
    const theme=$('#duoAppearancePanel');
    const legacy=$('#paramAppearancePanel');
    const font=$('#duoFontPanel');
    const beautify=$('#duoChatBeautifyPanel');
    const content=document.createElement('div');
    content.className='duo-appearance-overlay-content';
    // Merge the old bubble/accent/button color controls and custom CSS into the same theme card.
    const panels=[];
    if(theme&&legacy){
      legacy.querySelector('h3')?.remove();
      const group=document.createElement('section');
      group.className='duo-appearance-custom-colors';
      const heading=document.createElement('h4');heading.textContent='自定义颜色与 CSS';group.appendChild(heading);
      while(legacy.firstChild)group.appendChild(legacy.firstChild);
      theme.appendChild(group);
      legacy.remove();
    }else if(legacy){
      panels.push(legacy);
    }
    [theme,font,beautify].forEach(panel=>{if(panel&&!panels.includes(panel))panels.push(panel);});
    panels.forEach(panel=>content.appendChild(panel));
    const overlay=document.createElement('section');
    overlay.id='duoAppearanceSettingsOverlay';
    overlay.className='duo-appearance-overlay';
    overlay.setAttribute('aria-hidden','true');
    overlay.innerHTML='<div class="duo-appearance-overlay-head"><button type="button" id="duoAppearanceBack" aria-label="返回参数区">‹</button><strong>显示与个性化</strong></div>';
    overlay.appendChild(content);
    document.body.appendChild(overlay);
    overlay.querySelector('#duoAppearanceBack').addEventListener('click',closeAppearanceSuite);
    overlay.addEventListener('click',event=>{if(event.target===overlay)closeAppearanceSuite();});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&overlay.classList.contains('show'))closeAppearanceSuite();});
    appearanceOverlay=overlay;
    return overlay;
  }
  function openAppearanceSuite(){
    const overlay=buildAppearanceSuite();
    if(!overlay)return false;
    overlay.classList.add('show');overlay.setAttribute('aria-hidden','false');
    return true;
  }
  function closeAppearanceSuite(){
    if(!appearanceOverlay)return;
    appearanceOverlay.classList.remove('show');appearanceOverlay.setAttribute('aria-hidden','true');
  }

  function buildCircleCard(){
    // The category itself is the entry point; do not insert a second placeholder card.
    $('#duoCircleSettingsEntry')?.remove();
  }

  function targetFor(key){
    const selectors={
      chat:'#paramReplySettingsPanel',
      cards:'#duoUnifiedCardPanel',
      appearance:'#duoAppearancePanel, #duoFontPanel, #duoChatBeautifyPanel, .duo-chat-beautify-manager',
      stickers:'#paramStickerAdminMount .duo-sticker-admin',
      privacy:'#paramBackupPanel, .backup-management, .data-management',
    };
    if(key==='profile')return $('#settingsIcon');
    const list=(selectors[key]||'').split(',').map(x=>x.trim()).filter(Boolean);
    for(const selector of list){const found=$(selector);if(found)return found;}
    return null;
  }

  function open(key){
    if(key==='profile'){
      if(typeof setSettingsTab==='function')setSettingsTab('icon');
      const target=$('#settingsIcon');
      target?.scrollIntoView({behavior:'smooth',block:'start'});
      return !!target;
    }
    if(key==='circle'){
      const trigger=window.__duoCircleRoot?.querySelector('#backBtn');
      if(!trigger)return false;
      goto('circlePage');
      requestAnimationFrame(()=>{if(trigger.isConnected)trigger.click();});
      return true;
    }
    if(key==='appearance')return openAppearanceSuite();
    const target=targetFor(key);
    if(!target)return false;
    target.scrollIntoView({behavior:'smooth',block:'start'});
    target.classList.remove('duo-settings-target-flash');
    requestAnimationFrame(()=>target.classList.add('duo-settings-target-flash'));
    return true;
  }

  function boot(){
    const hub=$('#settingsCategoryGrid');
    if(!hub||!param())return;

    // Keep the category hub at the very top even when appearance/font
    // managers injected their own panels before this script booted.
    param().insertBefore(hub,param().firstElementChild);

    buildCardManager();
    if(window.__duoCardSystem?.render)window.__duoCardSystem.render();
    buildCircleCard();
    setPanelId('回复与已读','paramReplySettingsPanel');
    setPanelId('聊天节奏','paramChatRhythmPanel');
    setPanelId('聊天规则','paramChatRulesPanel');
    setPanelId('聊天外观','paramAppearancePanel');
    buildAppearanceSuite();
    setPanelId('备份与恢复','paramBackupPanel');
    const legacyChatPool=$('#paramCardPoolPanel');
    if(legacyChatPool){legacyChatPool.hidden=true;legacyChatPool.style.display='none';legacyChatPool.setAttribute('aria-hidden','true');}
    mountStickerManager();

    hub.addEventListener('click',event=>{
      const button=event.target.closest('[data-settings-category]');
      if(!button||!hub.contains(button))return;
      event.preventDefault();
      open(button.dataset.settingsCategory);
    });

    const style=document.createElement('style');
    style.id='duoSettingsInlineStyles';
    style.textContent=`
      .duo-settings-mount{display:contents}
      .settings-category-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:0 0 14px}
      .settings-category-grid button{display:flex;flex-direction:column;align-items:flex-start;gap:6px;min-height:76px;padding:13px;border:1px solid var(--line);border-radius:14px;background:var(--panel);color:var(--text);text-align:left}
      .settings-category-grid strong{font-size:14px}.settings-category-grid small{font-size:11px;line-height:1.5;color:var(--sub)}
      .settings-category-grid button:active{transform:scale(.99)}
      .duo-settings-target-flash{animation:duo-settings-target-flash 1s ease}
      @keyframes duo-settings-target-flash{0%,100%{box-shadow:var(--shadow)}30%{box-shadow:0 0 0 2px var(--theme-color,#8aa05f),0 8px 24px rgba(0,0,0,.08)}}
      .duo-card-tabs{display:flex;gap:7px;overflow-x:auto;padding:2px 0 12px;margin:0 0 10px;scrollbar-width:none}
      .duo-card-tabs::-webkit-scrollbar{display:none}
      .duo-card-tabs button{flex:0 0 auto;padding:9px 12px;border:1px solid var(--line);border-radius:999px;background:var(--soft);color:var(--sub);font-size:12px;white-space:nowrap}
      .duo-card-tabs button.active{background:var(--text);border-color:var(--text);color:var(--bg)}
      .duo-card-pane[hidden]{display:none!important}
      .duo-card-preview{padding:11px 12px;margin:6px 0 10px;border:1px dashed var(--line);border-radius:10px;color:var(--sub);font-size:13px;line-height:1.6;overflow-wrap:anywhere}
      .duo-card-editor{display:flex;gap:8px;margin:10px 0}.duo-card-editor input{flex:1;min-width:0}
      .duo-card-editor button{padding:8px 12px;border-radius:9px;background:var(--theme-color,#8aa05f);color:white}.duo-card-editor button:disabled{opacity:.45}
      @media(max-width:360px){.settings-category-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);

    window.__duoOpenSettingsCategory=open;
    // Legacy callers now stay on the parameter page; they never create an overlay or detached page.
    window.__duoCloseSettingsCategory=function(){return true;};
    window.__duoSettingsPagesReady=true;
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();
