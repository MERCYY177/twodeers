/* Contextual settings pages. Existing DOM nodes are moved, never cloned, so controls keep their data bindings. */
(function(){
  'use strict';
  if(window.__duoSettingsPagesInstalled)return;
  window.__duoSettingsPagesInstalled=true;
  const $=s=>document.querySelector(s);
  const categories={
    profile:{title:'空间资料',match:()=>Array.from($('#settingsIcon')?.querySelectorAll(':scope > .panel-card')||[])},
    chat:{title:'聊天设置',match:()=>panels().filter(p=>['回复与已读','聊天节奏','聊天规则'].includes(heading(p)))},
    cards:{title:'字卡管理',match:()=>panels().filter(p=>p.id==='duoUnifiedCardPanel')},
    circle:{title:'朋友圈设置',match:()=>[]},
    appearance:{title:'显示与个性化',match:()=>panels().filter(p=>heading(p)==='聊天外观'||p.id==='duoAppearancePanel'||p.id==='duoFontPanel'||p.classList.contains('duo-chat-beautify-manager'))},
    calls:{title:'通话设置',match:()=>panels().filter(p=>heading(p)==='通话设置'||heading(p)==='通话与视频设置')},
    stickers:{title:'表情包管理',match:()=>[]},
    privacy:{title:'隐私与数据管理',match:()=>panels().filter(p=>['备份与恢复','数据管理'].includes(heading(p)))}
  };
  const moved=[];
  let returnPage='settingsPage';
  function panels(){return Array.from($('#settingsParam')?.querySelectorAll(':scope > .panel-card')||[]);}
  function heading(el){return el.querySelector('h3')?.textContent?.trim()||'';}
  function buildCardManager(){
    if($('#duoUnifiedCardPanel'))return;
    const card=document.createElement('section');card.className='panel-card';card.id='duoUnifiedCardPanel';
    card.innerHTML=`
      <h3>字卡</h3>
      <div class="duo-card-tabs" role="tablist" aria-label="字卡分类">
        <button type="button" class="active" role="tab" aria-selected="true" data-card-tab="chat">主字卡</button>
        <button type="button" role="tab" aria-selected="false" data-card-tab="recent">最近抽过</button>
        <button type="button" role="tab" aria-selected="false" data-card-tab="moments-dynamic">朋友圈动态</button>
        <button type="button" role="tab" aria-selected="false" data-card-tab="moments-reply">朋友圈回复</button>
      </div>
      <section class="duo-card-pane" data-card-pane="chat">
        <div class="duo-card-editor"><button type="button" data-card-draw="chat">随机抽一条</button><button type="button" data-card-use="chat" disabled>确认使用</button></div>
        <div class="duo-card-preview" data-card-preview="chat"></div>
        <div class="duo-card-editor"><input data-card-input="chat" maxlength="1000" placeholder="添加聊天字卡"/><button type="button" data-card-add="chat">添加</button></div><div data-card-list="chat"></div>
      </section>
      <section class="duo-card-pane" data-card-pane="moments-dynamic" hidden>
        <div class="duo-card-editor"><button type="button" data-card-draw="moments-dynamic">随机抽一条</button><button type="button" data-card-use="moments-dynamic" disabled>确认使用</button></div>
        <div class="duo-card-preview" data-card-preview="moments-dynamic"></div>
        <div class="duo-card-editor"><input data-card-input="moments-dynamic" maxlength="1000" placeholder="添加朋友圈动态字卡"/><button type="button" data-card-add="moments-dynamic">添加</button></div><div data-card-list="moments-dynamic"></div>
      </section>
      <section class="duo-card-pane" data-card-pane="moments-reply" hidden>
        <div class="duo-card-editor"><button type="button" data-card-draw="moments-reply">随机抽一条</button><button type="button" data-card-use="moments-reply" disabled>确认使用</button></div>
        <div class="duo-card-preview" data-card-preview="moments-reply"></div>
        <div class="duo-card-editor"><input data-card-input="moments-reply" maxlength="1000" placeholder="添加朋友圈回复字卡"/><button type="button" data-card-add="moments-reply">添加</button></div><div data-card-list="moments-reply"></div>
      </section>
      <section class="duo-card-pane" data-card-pane="recent" hidden><div data-recent-cards></div></section>`;
    $('#settingsParam').appendChild(card);
    card.addEventListener('click',e=>{
      const tab=e.target.closest('[data-card-tab]');if(!tab)return;
      const key=tab.dataset.cardTab;
      card.querySelectorAll('[data-card-tab]').forEach(b=>{const active=b===tab;b.classList.toggle('active',active);b.setAttribute('aria-selected',String(active));});
      card.querySelectorAll('[data-card-pane]').forEach(p=>p.hidden=p.dataset.cardPane!==key);
    });
  }
  function buildCircleCard(){
    const card=document.createElement('section');card.className='panel-card';card.innerHTML='<h3>朋友圈设置</h3><button class="primary" type="button" id="openCircleSettingsFromCategory">进入朋友圈</button>';
    card.querySelector('#openCircleSettingsFromCategory').addEventListener('click',()=>{restoreMoved();goto('circlePage');});return card;
  }
  function restoreMoved(){
    for(let i=moved.length-1;i>=0;i--){const x=moved[i];if(x.placeholder.parentNode)x.placeholder.parentNode.replaceChild(x.node,x.placeholder);x.node.hidden=!!x.wasHidden;}
    moved.length=0;
  }
  function open(key){
    const cfg=categories[key];if(!cfg)return;
    restoreMoved();
    returnPage=(typeof state!=='undefined'&&state.currentPage)||'settingsPage';
    const content=$('#settingsCategoryContent');content.innerHTML='';
    $('#settingsCategoryTitle').textContent=cfg.title;
    let nodes=cfg.match();
    if(key==='stickers'){if(window.__duoStickerAdmin?.mount)window.__duoStickerAdmin.mount(content);else content.textContent='表情包管理模块尚未加载';goto('settingsCategoryPage');return;}
    if(key==='circle'){content.appendChild(buildCircleCard());nodes=[];}
    nodes.forEach(node=>{const placeholder=document.createComment('settings-slot');node.parentNode.insertBefore(placeholder,node);moved.push({node,placeholder,wasHidden:node.hidden});node.hidden=false;content.appendChild(node);});
    if(window.__duoCardSystem)window.__duoCardSystem.render();
    goto('settingsCategoryPage');
  }
  window.__duoOpenSettingsCategory=open;
  function boot(){
    const hub=$('#settingsCategoryGrid');if(!hub||!$('#settingsCategoryContent'))return;
    buildCardManager();
    hub.addEventListener('click',e=>{const b=e.target.closest('[data-settings-category]');if(b)open(b.dataset.settingsCategory);});
    $('#settingsCategoryBack').addEventListener('click',()=>{restoreMoved();const target=returnPage;goto(target);if(target==='settingsPage')setSettingsTab('param');});
    const style=document.createElement('style');style.textContent=`
      .settings-category-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:0 0 14px}
      .settings-category-grid button{display:flex;flex-direction:column;align-items:flex-start;gap:6px;min-height:86px;padding:14px;border:1px solid var(--line);border-radius:14px;background:var(--panel);color:var(--text);text-align:left}
      .settings-category-grid strong{font-size:14px}.settings-category-grid small{font-size:11px;line-height:1.5;color:var(--sub)}
      #settingsCategoryContent{padding:0 16px 30px}.settings-category-grid button:active{transform:scale(.99)}
      .duo-card-tabs{display:flex;gap:7px;overflow-x:auto;padding:2px 0 12px;margin:0 0 10px;scrollbar-width:none}
      .duo-card-tabs::-webkit-scrollbar{display:none}
      .duo-card-tabs button{flex:0 0 auto;padding:9px 12px;border:1px solid var(--line,#e8e2dc);border-radius:999px;background:var(--soft,#f7f7f7);color:var(--sub,#888);font-size:12px;white-space:nowrap}
      .duo-card-tabs button.active{background:var(--text,#222);border-color:var(--text,#222);color:var(--bg,#fff)}
      .duo-card-pane[hidden]{display:none!important}
      .duo-card-preview{padding:11px 12px;margin:6px 0 10px;border:1px dashed var(--line);border-radius:10px;color:var(--sub);font-size:13px;line-height:1.6;overflow-wrap:anywhere}
      .duo-card-editor{display:flex;gap:8px;margin:10px 0}.duo-card-editor input{flex:1;min-width:0}
      .duo-card-editor button{padding:8px 12px;border-radius:9px;background:var(--accent,#8aa05f);color:white}.duo-card-editor button:disabled{opacity:.45}
      @media(max-width:360px){.settings-category-grid{grid-template-columns:1fr}}
    `;document.head.appendChild(style);
    // The parameter landing page contains only real category entry points; detail panels open contextually.
    panels().forEach(p=>p.hidden=true);
    if($('#duoFontPanel'))$('#duoFontPanel').hidden=true;
    if($('.duo-chat-beautify-manager'))$('.duo-chat-beautify-manager').hidden=true;
    window.__duoSettingsPagesReady=true;
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
