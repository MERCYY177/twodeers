/* Settings navigation: the parameter home is a category hub; each category opens its own page. */
(function(){
  'use strict';
  if(window.__duoSettingsPagesInstalled)return;
  window.__duoSettingsPagesInstalled=true;

  const $=selector=>document.querySelector(selector);
  const param=()=>$('#settingsParam');
  const directPanels=()=>Array.from(param()?.querySelectorAll(':scope > .panel-card')||[]);
  const panelHeading=element=>element?.querySelector('h3')?.textContent?.trim()||'';

  function setPanelId(title,id){
    const panel=directPanels().find(item=>panelHeading(item)===title);
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
      }else host.textContent='表情包管理模块尚未加载';
    }
    return host;
  }

  function mergeAppearanceControls(){
    const theme=$('#duoAppearancePanel');
    const legacy=$('#paramAppearancePanel');
    if(theme&&legacy){
      legacy.querySelector('h3')?.remove();
      const group=document.createElement('section');
      group.className='duo-appearance-custom-colors';
      const heading=document.createElement('h4');
      heading.textContent='自定义颜色与 CSS';
      group.appendChild(heading);
      while(legacy.firstChild)group.appendChild(legacy.firstChild);
      theme.appendChild(group);
      legacy.remove();
    }else if(legacy){
      const heading=legacy.querySelector('h3');
      if(heading)heading.textContent='主题与配色';
    }
  }

  let categoryOverlay=null;
  const categoryNodes={};
  const categoryPages={};

  function createCategoryOverlay(){
    if(categoryOverlay)return categoryOverlay;
    const overlay=document.createElement('section');
    overlay.id='duoSettingsCategoryOverlay';
    overlay.className='duo-settings-category-overlay';
    overlay.setAttribute('aria-hidden','true');
    overlay.innerHTML=`
      <header class="duo-settings-category-head">
        <button type="button" data-category-back aria-label="返回参数区">‹</button>
        <strong data-category-title></strong>
      </header>
      <div class="duo-settings-category-pages" data-category-pages></div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('[data-category-back]').addEventListener('click',closeCategoryPage);
    overlay.addEventListener('click',event=>{if(event.target===overlay)closeCategoryPage();});
    document.addEventListener('keydown',event=>{
      if(event.key==='Escape'&&overlay.classList.contains('show'))closeCategoryPage();
    });
    overlay.querySelector('[data-category-pages]').addEventListener('click',event=>{
      const button=event.target.closest('[data-category-tab]');
      if(!button)return;
      activateCategoryTab(button.closest('[data-category-page]'),button.dataset.categoryTab);
    });
    categoryOverlay=overlay;
    return overlay;
  }

  function activateCategoryTab(page,key){
    if(!page)return;
    const tabs=page.querySelector('[data-category-tabs]');
    const content=page.querySelector('[data-category-content]');
    tabs?.querySelectorAll('[data-category-tab]').forEach(button=>{
      const active=button.dataset.categoryTab===key;
      button.classList.toggle('active',active);
      button.setAttribute('aria-selected',String(active));
    });
    content?.querySelectorAll('[data-category-pane]').forEach(pane=>pane.hidden=pane.dataset.categoryPane!==key);
    if(content)content.scrollTop=0;
  }

  function defineCategory(key,title,sections){
    const overlay=createCategoryOverlay();
    const pages=overlay.querySelector('[data-category-pages]');
    const liveSections=sections.filter(section=>section.nodes.some(node=>node&&node.isConnected));
    if(!liveSections.length)return false;
    const page=document.createElement('section');
    page.className='duo-settings-category-page';
    page.dataset.categoryPage=key;
    page.hidden=true;
    const tabs=document.createElement('nav');
    tabs.className='duo-settings-subtabs';
    tabs.dataset.categoryTabs='';
    tabs.setAttribute('role','tablist');
    tabs.setAttribute('aria-label',title+'分类');
    tabs.hidden=liveSections.length<2;
    const content=document.createElement('main');
    content.className='duo-settings-category-content';
    content.dataset.categoryContent='';
    page.append(tabs,content);
    liveSections.forEach((section,index)=>{
      const tabKey=section.key||('section-'+index);
      if(liveSections.length>1){
        const button=document.createElement('button');
        button.type='button';button.className='duo-settings-subtab'+(index===0?' active':'');
        button.dataset.categoryTab=tabKey;button.setAttribute('role','tab');
        button.setAttribute('aria-selected',String(index===0));button.textContent=section.label;
        tabs.appendChild(button);
      }
      const pane=document.createElement('section');
      pane.className='duo-settings-category-pane';
      pane.dataset.categoryPane=tabKey;
      pane.hidden=index!==0;
      section.nodes.forEach(node=>{if(node&&node.isConnected)pane.appendChild(node);});
      content.appendChild(pane);
    });
    pages.appendChild(page);
    categoryPages[key]=page;
    categoryNodes[key]=true;
    return true;
  }

  function buildCategoryPages(){
    const reply=$('#paramReplySettingsPanel');
    const rhythm=$('#paramChatRhythmPanel');
    const rules=$('#paramChatRulesPanel');
    const card=$('#duoUnifiedCardPanel');
    const theme=$('#duoAppearancePanel')||$('#paramAppearancePanel');
    const font=$('#duoFontPanel');
    const beautify=$('#duoChatBeautifyPanel');
    const stickerHost=$('#paramStickerAdminMount');
    const backup=$('#paramBackupPanel')||$('.backup-management');
    const data=$('.data-management');

    defineCategory('chat','聊天设置',[
      {key:'reply',label:'回复与已读',nodes:[reply]},
      {key:'rhythm',label:'聊天节奏',nodes:[rhythm]},
      {key:'rules',label:'聊天规则',nodes:[rules]}
    ]);
    defineCategory('cards','字卡管理',[
      {key:'cards',label:'字卡管理',nodes:[card]}
    ]);
    defineCategory('appearance','显示与个性化',[
      {key:'theme',label:'主题配色',nodes:[theme]},
      {key:'font',label:'字体',nodes:[font]},
      {key:'beautify',label:'聊天美化',nodes:[beautify]}
    ]);
    defineCategory('stickers','表情包管理',[
      {key:'stickers',label:'表情包管理',nodes:[stickerHost]}
    ]);
    defineCategory('privacy','隐私与数据管理',[
      {key:'backup',label:'备份与恢复',nodes:[backup]},
      {key:'data',label:'数据管理',nodes:[data]}
    ]);
  }

  function openCategoryPage(key){
    const page=categoryPages[key];
    if(!categoryNodes[key]||!categoryOverlay||!page)return false;
    categoryOverlay.querySelector('[data-category-title]').textContent=(
      {chat:'聊天设置',cards:'字卡管理',appearance:'显示与个性化',stickers:'表情包管理',privacy:'隐私与数据管理'}[key]||'设置'
    );
    categoryOverlay.querySelectorAll('[data-category-page]').forEach(item=>item.hidden=item!==page);
    const tabs=page.querySelector('[data-category-tabs]');
    const firstTab=tabs?.querySelector('[data-category-tab]');
    if(firstTab)activateCategoryTab(page,firstTab.dataset.categoryTab);
    else page.querySelectorAll('[data-category-pane]').forEach((pane,index)=>pane.hidden=index!==0);
    categoryOverlay.classList.add('show');
    categoryOverlay.setAttribute('aria-hidden','false');
    categoryOverlay.querySelector('[data-category-back]')?.focus({preventScroll:true});
    return true;
  }

  function closeCategoryPage(){
    if(!categoryOverlay)return;
    categoryOverlay.classList.remove('show');
    categoryOverlay.setAttribute('aria-hidden','true');
  }

  function open(key){
    if(key==='profile'){
      closeCategoryPage();
      if(typeof setSettingsTab==='function')setSettingsTab('icon');
      $('#settingsIcon')?.scrollTo?.({top:0,behavior:'instant'});
      return !!$('#settingsIcon');
    }
    if(key==='circle'){
      const trigger=window.__duoCircleRoot?.querySelector('#backBtn');
      if(!trigger)return false;
      closeCategoryPage();
      goto('circlePage');
      requestAnimationFrame(()=>{if(trigger.isConnected)trigger.click();});
      return true;
    }
    return openCategoryPage(key);
  }

  function boot(){
    const hub=$('#settingsCategoryGrid');
    if(!hub||!param())return;

    // The parameter home is deliberately only a category grid. All setting panels move to their own second-level page.
    param().insertBefore(hub,param().firstElementChild);
    buildCardManager();
    if(window.__duoCardSystem?.render)window.__duoCardSystem.render();
    setPanelId('回复与已读','paramReplySettingsPanel');
    setPanelId('聊天节奏','paramChatRhythmPanel');
    setPanelId('聊天规则','paramChatRulesPanel');
    setPanelId('聊天外观','paramAppearancePanel');
    setPanelId('备份与恢复','paramBackupPanel');
    setPanelId('数据管理','paramDataManagementPanel');

    const oldCardPool=$('#paramCardPoolPanel');
    if(oldCardPool){oldCardPool.hidden=true;oldCardPool.style.display='none';oldCardPool.setAttribute('aria-hidden','true');}
    mergeAppearanceControls();
    mountStickerManager();
    buildCategoryPages();

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
      .settings-category-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:0}
      .settings-category-grid button{display:flex;flex-direction:column;align-items:flex-start;gap:6px;min-height:76px;padding:13px;border:1px solid var(--line);border-radius:14px;background:var(--panel);color:var(--text);text-align:left}
      .settings-category-grid strong{font-size:14px}.settings-category-grid small{font-size:11px;line-height:1.5;color:var(--sub)}
      .settings-category-grid button:active{transform:scale(.99)}
      .duo-settings-category-overlay{position:fixed;inset:0;z-index:2147481000;display:none;flex-direction:column;background:var(--bg);color:var(--text)}
      .duo-settings-category-overlay.show{display:flex}
      .duo-settings-category-head{display:flex;align-items:center;gap:12px;flex:0 0 auto;min-height:58px;padding:calc(8px + env(safe-area-inset-top,0px)) 14px 8px;border-bottom:1px solid var(--line);background:var(--panel)}
      .duo-settings-category-head button{width:38px;height:38px;flex:0 0 38px;border:1px solid var(--line);border-radius:50%;background:var(--soft);color:var(--text);font-size:25px;line-height:1}
      .duo-settings-category-head strong{font-size:17px}
      .duo-settings-category-pages{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;overflow:hidden}
      .duo-settings-category-page{flex:1 1 auto;min-height:0;display:flex;flex-direction:column}
      .duo-settings-category-page[hidden]{display:none!important}
      .duo-settings-subtabs{display:flex;flex:0 0 auto;gap:8px;padding:10px 14px;border-bottom:1px solid var(--line);background:var(--panel);overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch}
      .duo-settings-subtabs::-webkit-scrollbar{display:none}
      .duo-settings-subtab{flex:0 0 auto;min-height:36px;padding:8px 13px;border:1px solid var(--line);border-radius:999px;background:var(--soft);color:var(--sub);font-size:12px;white-space:nowrap}
      .duo-settings-subtab.active{background:var(--text);border-color:var(--text);color:var(--bg)}
      .duo-settings-category-content{flex:1 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:14px 14px calc(20px + env(safe-area-inset-bottom,0px))}
      .duo-settings-category-pane[hidden]{display:none!important}
      .duo-settings-category-pane>.panel-card{margin:0;padding:14px}
      .duo-settings-category-pane>.duo-settings-mount{display:block}
      .duo-settings-category-pane>.duo-settings-mount>.duo-sticker-admin{margin:0}
      .duo-settings-category-pane>.duo-appearance-custom-colors{margin-top:18px}
      .duo-appearance-custom-colors h4{font-size:14px;margin:0 0 12px;color:var(--text)}
      .duo-settings-category-pane .duo-chat-beautify-manager{margin:0}
      .duo-settings-category-pane .duo-font-list{max-width:100%}
      .duo-settings-category-pane .backup-management,.duo-settings-category-pane .data-management{margin:0}
      .duo-settings-category-overlay [hidden]{display:none!important}
      @media(max-width:360px){.settings-category-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);

    window.__duoOpenSettingsCategory=open;
    window.__duoCloseSettingsCategory=closeCategoryPage;
    window.__duoSettingsPagesReady=true;
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();
