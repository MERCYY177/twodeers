/* Real second-level settings pages: move existing controls without cloning or changing their data bindings. */
(function(){
  'use strict';
  if(window.__duoSettingsPagesInstalled)return;
  window.__duoSettingsPagesInstalled=true;
  const $=s=>document.querySelector(s);
  const categories={
    profile:{title:'空间资料',match:()=>Array.from($('#settingsIcon')?.querySelectorAll(':scope > .panel-card')||[])},
    chat:{title:'聊天设置',match:()=>panels().filter(p=>['回复与已读','聊天节奏','聊天规则'].includes(heading(p)))},
    cards:{title:'信件与字卡',match:()=>panels().filter(p=>heading(p)==='字卡池管理'||p.id==='duoUnifiedCardPanel')},
    circle:{title:'朋友圈设置',match:()=>[]},
    appearance:{title:'显示与个性化',match:()=>panels().filter(p=>heading(p)==='聊天外观'||p.id==='duoAppearancePanel'||p.id==='duoFontPanel'||p.classList.contains('duo-chat-beautify-manager'))},
    calls:{title:'通知与通话',match:()=>panels().filter(p=>heading(p)==='通话与视频设置')},
    privacy:{title:'隐私与数据管理',match:()=>panels().filter(p=>['备份与恢复','数据管理'].includes(heading(p)))}
  };
  const moved=[];
  function panels(){return Array.from($('#settingsParam')?.querySelectorAll(':scope > .panel-card')||[]);}
  function heading(el){return el.querySelector('h3')?.textContent?.trim()||'';}
  function buildCardManager(){
    if($('#duoUnifiedCardPanel'))return;
    const card=document.createElement('section');card.className='panel-card';card.id='duoUnifiedCardPanel';
    card.innerHTML='<h3>统一字卡管理</h3><p class="data-note">聊天字卡继续使用原 state.cardPhrases；朋友圈动态字卡和朋友圈回复字卡仍保存在朋友圈自己的数据中。这里只提供统一入口，不合并不同字卡池。</p>'+ 
      '<h4>聊天字卡池</h4><div class="duo-card-editor"><button type="button" data-card-draw="chat">随机抽一条</button><button type="button" data-card-use="chat" disabled>确认已使用</button></div><div class="duo-card-preview" data-card-preview="chat"></div><div class="duo-card-editor"><input data-card-input="chat" maxlength="1000" placeholder="添加聊天自动回复字卡"/><button type="button" data-card-add="chat">添加</button></div><div data-card-list="chat"></div>'+ 
      '<h4>朋友圈动态字卡</h4><div class="duo-card-editor"><button type="button" data-card-draw="moments-dynamic">随机抽一条</button><button type="button" data-card-use="moments-dynamic" disabled>确认已使用</button></div><div class="duo-card-preview" data-card-preview="moments-dynamic"></div><div class="duo-card-editor"><input data-card-input="moments-dynamic" maxlength="1000" placeholder="添加朋友圈动态字卡"/><button type="button" data-card-add="moments-dynamic">添加</button></div><div data-card-list="moments-dynamic"></div>'+ 
      '<h4>朋友圈回复字卡</h4><div class="duo-card-editor"><button type="button" data-card-draw="moments-reply">随机抽一条</button><button type="button" data-card-use="moments-reply" disabled>确认已使用</button></div><div class="duo-card-preview" data-card-preview="moments-reply"></div><div class="duo-card-editor"><input data-card-input="moments-reply" maxlength="1000" placeholder="添加朋友圈回复字卡"/><button type="button" data-card-add="moments-reply">添加</button></div><div data-card-list="moments-reply"></div>'+ 
      '<h4>最近实际使用</h4><p class="data-note">只记录已经真正发出或展示的字卡，不记录仅仅选中、预览或打开。</p><div data-recent-cards></div>';
    $('#settingsParam').appendChild(card);
  }
  function buildCircleCard(){
    const card=document.createElement('section');card.className='panel-card';card.innerHTML='<h3>朋友圈独立设置</h3><p class="data-note">朋友圈仍使用独立 Shadow DOM 和独立存储。动态字卡、回复字卡、自动动态间隔、头像封面等设置请在朋友圈页面的设置入口中管理；这里不会把它们复制到聊天字卡池。</p><button class="primary" type="button" id="openCircleSettingsFromCategory">进入朋友圈</button>';
    card.querySelector('#openCircleSettingsFromCategory').addEventListener('click',()=>{restoreMoved();goto('circlePage');});return card;
  }
  function restoreMoved(){
    for(let i=moved.length-1;i>=0;i--){const x=moved[i];if(x.placeholder.parentNode)x.placeholder.parentNode.replaceChild(x.node,x.placeholder);x.node.hidden=!!x.wasHidden;}
    moved.length=0;
  }
  function open(key){
    const cfg=categories[key];if(!cfg)return;
    restoreMoved();
    const content=$('#settingsCategoryContent');content.innerHTML='';
    $('#settingsCategoryTitle').textContent=cfg.title;
    let nodes=cfg.match();
    if(key==='cards'){
      const mail=document.createElement('section');mail.className='panel-card';mail.innerHTML='<h3>独立信箱</h3><p class="data-note">信件列表、写信、收信、自动来信、自动回信和草稿均独立于聊天记录。</p><button type="button" class="primary" id="openMailboxFromCategory">打开信箱</button>';mail.querySelector('button').addEventListener('click',()=>{restoreMoved();goto('mailPage');});content.appendChild(mail);
    }
    if(key==='circle'){content.appendChild(buildCircleCard());nodes=[];}
    if(key==='calls'){
      const notice=document.createElement('section');notice.className='panel-card';
      const enabled=window.__duoCircleApi?.exportState?.()?.notificationsEnabled!==false;
      notice.innerHTML='<h3>应用内通知</h3><div class="item-row"><div><div class="lab">朋友圈互动通知</div><div class="desc">记录对方对你动态的点赞与评论，并在朋友圈显示未读提示</div></div><input id="circleNoticeEnabled" type="checkbox" '+(enabled?'checked':'')+'/></div><p class="data-note">这是应用内通知开关，不等同于 Android 系统推送通知；系统级推送当前未实现。</p>';
      notice.querySelector('#circleNoticeEnabled').addEventListener('change',event=>{const current=window.__duoCircleApi.exportState(),next=!!event.target.checked;current.notificationsEnabled=next;try{window.__duoCircleApi.importState(current);}catch(error){event.target.checked=!next;showToast('通知设置保存失败：'+(error.message||error));}});
      content.appendChild(notice);
    }
    nodes.forEach(node=>{const placeholder=document.createComment('settings-slot');node.parentNode.insertBefore(placeholder,node);moved.push({node,placeholder,wasHidden:node.hidden});node.hidden=false;content.appendChild(node);});
    if(window.__duoCardSystem)window.__duoCardSystem.render();
    goto('settingsCategoryPage');
  }
  function boot(){
    const hub=$('#settingsCategoryGrid');if(!hub||!$('#settingsCategoryContent'))return;
    buildCardManager();
    hub.addEventListener('click',e=>{const b=e.target.closest('[data-settings-category]');if(b)open(b.dataset.settingsCategory);});
    $('#settingsCategoryBack').addEventListener('click',()=>{restoreMoved();goto('settingsPage');setSettingsTab('param');});
    const style=document.createElement('style');style.textContent='.settings-category-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:0 0 14px}.settings-category-grid button{display:flex;flex-direction:column;align-items:flex-start;gap:6px;min-height:86px;padding:14px;border:1px solid var(--line);border-radius:14px;background:var(--panel);color:var(--text);text-align:left}.settings-category-grid strong{font-size:14px}.settings-category-grid small{font-size:11px;line-height:1.5;color:var(--sub)}#settingsCategoryContent{padding:0 16px 30px}.settings-category-grid button:active{transform:scale(.99)}.duo-card-preview{padding:11px 12px;margin:6px 0 10px;border:1px dashed var(--line);border-radius:10px;color:var(--sub);font-size:13px;line-height:1.6;overflow-wrap:anywhere}.duo-card-editor button:disabled{opacity:.45}@media(max-width:360px){.settings-category-grid{grid-template-columns:1fr}}';document.head.appendChild(style);
    // Replace the old long scrolling parameter list with the seven category entry points.
    panels().forEach(p=>p.hidden=true);
    if($('#duoFontPanel'))$('#duoFontPanel').hidden=true;
    if($('.duo-chat-beautify-manager'))$('.duo-chat-beautify-manager').hidden=true;
    window.__duoSettingsPagesReady=true;
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
