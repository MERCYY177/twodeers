/* Settings navigation: the parameter area is a category home with real in-page second-level views. */
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

  const cardPools=['chat','moments-dynamic','moments-reply'];
  const cardPoolLabels={chat:'主字卡','moments-dynamic':'朋友圈动态字卡','moments-reply':'朋友圈回复字卡'};
  const legacyCardLabels={kaomojiLibrary:'KKK 颜文字库',customPokes:'KKK 拍一拍词库',customIntros:'KKK 开场动画词库',customEmojis:'KKK Emoji 库',customReplyGroups:'KKK 主字卡分组',customPokeGroups:'KKK 拍一拍分组',kaomojiGroups:'KKK 颜文字分组'};
  const cardModuleLabel=key=>cardPoolLabels[key]||(key==='usage'?'最近抽取记录与使用次数':key.startsWith('legacy:')?'兼容归档 · '+(legacyCardLabels[key.slice(7)]||key.slice(7))+'（不参与当前 Twodeers 运行）':key);
  const cardView={active:'chat',search:{chat:'','moments-dynamic':'','moments-reply':''},batch:{chat:false,'moments-dynamic':false,'moments-reply':false},selected:{chat:new Set(),'moments-dynamic':new Set(),'moments-reply':new Set()}};
  const cardApi=()=>window.__duoCardSystem;
  const cardEscape=value=>String(value==null?'':value).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  function filteredCardItems(key){
    const items=cardApi()?.getPoolItems?.(key)||[],query=String(cardView.search[key]||'').trim().toLocaleLowerCase();
    return query?items.filter(item=>item.text.toLocaleLowerCase().includes(query)):items;
  }
  function renderCardList(key){
    const root=$('#duoUnifiedCardPanel');if(!root)return;
    const host=root.querySelector('[data-card-list="'+key+'"]');if(!host)return;
    const allItems=cardApi()?.getPoolItems?.(key)||[],activeIds=new Set(allItems.map(item=>item.id));
    cardView.selected[key].forEach(id=>{if(!activeIds.has(id))cardView.selected[key].delete(id);});
    const items=filteredCardItems(key),selected=cardView.selected[key],batch=cardView.batch[key];
    if(!items.length){host.innerHTML='<p class="duo-card-empty">'+(cardView.search[key]?'没有找到匹配的字卡':'这个字卡池目前为空。')+'</p>';return;}
    host.innerHTML=items.map(item=>{
      const checked=selected.has(item.id);
      return '<div class="duo-card-row'+(batch&&checked?' is-selected':'')+'">'+
        (batch?'<input type="checkbox" class="duo-card-select-check" data-card-select="'+key+'" value="'+cardEscape(item.id)+'" '+(checked?'checked':'')+' aria-label="选择字卡">':'')+
        '<span>'+cardEscape(item.text)+'</span>'+
        (!batch?'<button type="button" data-card-delete-id="'+key+'" data-card-id="'+cardEscape(item.id)+'">删除</button>':'')+
        '</div>';
    }).join('');
  }
  function renderCardSelection(key){
    const root=$('#duoUnifiedCardPanel');if(!root)return;
    const selection=root.querySelector('[data-card-selection="'+key+'"]');if(!selection)return;
    const selected=cardView.selected[key],visible=filteredCardItems(key),allSelected=visible.length>0&&visible.every(item=>selected.has(item.id));
    selection.hidden=!cardView.batch[key];
    const count=selection.querySelector('[data-card-selected-count]');if(count)count.textContent='已选 '+selected.size+' 条';
    const all=selection.querySelector('[data-card-select-all]');if(all)all.textContent=allSelected?'取消全选':'全选当前结果';
    const remove=selection.querySelector('[data-card-bulk-delete]');if(remove)remove.disabled=selected.size===0;
  }
  function renderCardPool(key){renderCardList(key);renderCardSelection(key);}
  function renderCardManager(){
    const root=$('#duoUnifiedCardPanel');if(!root||!cardApi()?.getPoolItems)return;
    cardPools.forEach(renderCardPool);
    const recent=cardApi().getRecent?.()||[],host=root.querySelector('[data-recent-cards]');
    if(host)host.innerHTML=recent.length?recent.map(item=>'<div class="duo-recent-row"><div>'+cardEscape(item.textSnapshot)+'</div><small>'+cardEscape(item.source||'')+' · '+new Date(Number(item.lastDrawAt)||0).toLocaleString()+' · 使用 '+(Number(item.count)||1)+' 次</small></div>').join(''):'<p class="duo-card-empty">暂无记录</p>';
    root.querySelectorAll('[data-card-tab]').forEach(button=>{const active=button.dataset.cardTab===cardView.active;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));});
    root.querySelectorAll('[data-card-pane]').forEach(pane=>pane.hidden=pane.dataset.cardPane!==cardView.active);
  }
  function downloadCardJson(name,payload){
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'});
    if(typeof window.triggerDownloadBlob==='function'){window.triggerDownloadBlob(name,blob);return;}
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);
  }
  function closeCardTransfer(){document.querySelector('#duoCardTransferOverlay')?.remove();}
  function openCardExport(){
    const overlay=document.createElement('div');overlay.id='duoCardTransferOverlay';overlay.className='duo-card-transfer-overlay';
    const legacy=cardApi()?.getLegacyModules?.()||{},legacyOptions=Object.keys(legacyCardLabels).map(key=>'<label><input type="checkbox" data-transfer-module="legacy:'+key+'"><span>'+cardModuleLabel('legacy:'+key)+' · '+(Array.isArray(legacy[key])?legacy[key].length:0)+' 项</span></label>').join('');
    overlay.innerHTML='<section class="duo-card-transfer-sheet" role="dialog" aria-modal="true" aria-label="导出字卡"><header><strong>导出字卡</strong><button type="button" data-card-transfer-close aria-label="关闭">×</button></header><p>选择需要导出的字卡模块。聊天和朋友圈字卡可独立导出；旧版 KKK 词库以兼容归档方式保留，不会被当作当前 Twodeers 运行词库。</p><div class="duo-card-transfer-options">'+
      cardPools.map(key=>'<label><input type="checkbox" data-transfer-module="'+key+'" checked><span>'+cardPoolLabels[key]+'</span></label>').join('')+
      '<label><input type="checkbox" data-transfer-module="usage" checked><span>最近抽取记录、使用次数、聊天/朋友圈/信箱待同步记录</span></label>'+legacyOptions+'</div><footer><button type="button" data-card-transfer-close>取消</button><button type="button" class="primary" data-card-export-confirm>导出所选模块</button></footer></section>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click',event=>{
      if(event.target===overlay||event.target.closest('[data-card-transfer-close]')){closeCardTransfer();return;}
      if(event.target.closest('[data-card-export-confirm]')){
        const keys=[...overlay.querySelectorAll('[data-transfer-module]:checked')].map(el=>el.dataset.transferModule);
        if(!keys.length){showToast('请至少选择一个字卡模块');return;}
        try{const payload=cardApi().exportModules(keys),date=new Date().toISOString().slice(0,10);downloadCardJson('twodeers-card-library-'+date+'.json',payload);closeCardTransfer();showToast('字卡导出成功');}
        catch(error){showToast('字卡导出失败：'+(error.message||error));}
      }
    });
  }
  function showCardImportOptions(payload,fileName){
    const api=cardApi(),info=api.inspectImport(payload);
    if(!info.available.length){showToast('文件中没有可导入的 Twodeers 字卡模块');return;}
    const overlay=document.createElement('div');overlay.id='duoCardTransferOverlay';overlay.className='duo-card-transfer-overlay';
    const unsupported=info.unsupported?.length?'<p class="duo-card-transfer-warning">文件还包含当前 Twodeers 没有对应字卡模块的数据，未选入本次导入：'+info.unsupported.map(cardEscape).join('、')+'</p>':'';
    overlay.innerHTML='<section class="duo-card-transfer-sheet" role="dialog" aria-modal="true" aria-label="导入字卡"><header><strong>导入字卡</strong><button type="button" data-card-transfer-close aria-label="关闭">×</button></header><p>文件：'+cardEscape(fileName)+'。请选择要导入的模块和导入方式。KKK 兼容归档只保存原始词库/分组结构，不会启用不存在的 Twodeers 运行模块。</p><div class="duo-card-transfer-options">'+
      info.available.map(key=>'<label><input type="checkbox" data-transfer-module="'+key+'" checked><span>'+cardModuleLabel(key)+'（'+(info.counts[key]||0)+'）</span></label>').join('')+
      '</div><fieldset class="duo-card-import-modes"><legend>导入方式</legend><label><input type="radio" name="duo-card-import-mode" value="append" checked><span>追加：保留现有内容，按文本去重</span></label><label><input type="radio" name="duo-card-import-mode" value="replace"><span>覆盖：只替换本次勾选的模块</span></label></fieldset>'+unsupported+'<footer><button type="button" data-card-transfer-close>取消</button><button type="button" class="primary" data-card-import-confirm>导入所选模块</button></footer></section>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click',event=>{
      if(event.target===overlay||event.target.closest('[data-card-transfer-close]')){closeCardTransfer();return;}
      if(event.target.closest('[data-card-import-confirm]')){
        const selected=[...overlay.querySelectorAll('[data-transfer-module]:checked')].map(el=>el.dataset.transferModule);
        const mode=overlay.querySelector('input[name="duo-card-import-mode"]:checked')?.value||'append';
        if(!selected.length){showToast('请至少选择一个字卡模块');return;}
        if(mode==='replace'&&!window.confirm('即将覆盖以下模块：'+selected.map(cardModuleLabel).join('、')+'。未勾选的模块不会改变。确定继续吗？'))return;
        try{const result=api.importModules(payload,{selectedModules:selected,mode});cardPools.forEach(key=>{cardView.selected[key].clear();cardView.batch[key]=false;});closeCardTransfer();renderCardManager();const added=Object.values(result.added||{}).reduce((sum,n)=>sum+Number(n||0),0);showToast('字卡导入成功（'+(mode==='replace'?'覆盖':'追加')+'，'+(mode==='replace'?'处理':'新增')+' '+added+' 条）');}
        catch(error){showToast('字卡导入失败：'+(error.message||error));}
      }
    });
  }
  function buildCardManager(){
    if($('#duoUnifiedCardPanel'))return;
    const card=document.createElement('section');card.className='panel-card';card.id='duoUnifiedCardPanel';
    card.innerHTML=`
      <h3>字卡管理</h3>
      <div class="duo-card-tabs" role="tablist" aria-label="字卡分类">
        <button type="button" class="active" role="tab" aria-selected="true" data-card-tab="chat">主字卡</button>
        <button type="button" role="tab" aria-selected="false" data-card-tab="recent">最近抽过</button>
        <button type="button" role="tab" aria-selected="false" data-card-tab="moments-dynamic">朋友圈动态</button>
        <button type="button" role="tab" aria-selected="false" data-card-tab="moments-reply">朋友圈回复</button>
      </div>
      <div class="duo-card-transfer-actions"><button type="button" data-card-import>导入字卡</button><button type="button" data-card-export>导出字卡</button><input type="file" accept=".json,application/json" data-card-file hidden></div>
      <section class="duo-card-pane" data-card-pane="chat">
        <div class="duo-card-editor"><button type="button" data-card-draw="chat">随机抽一条</button><button type="button" data-card-use="chat" disabled>确认使用</button></div>
        <div class="duo-card-preview" data-card-preview="chat"></div>
        <div class="duo-card-editor"><input data-card-input="chat" maxlength="1000" placeholder="添加聊天字卡"><button type="button" data-card-add="chat">添加</button></div>
        <div class="duo-card-search-row"><input type="search" data-card-search="chat" placeholder="搜索主字卡内容"><button type="button" data-card-dedup="chat">一键去重</button><button type="button" data-card-manage="chat">批量管理</button></div>
        <div class="duo-card-bulk-add"><textarea data-card-bulk-input="chat" rows="3" maxlength="200000" placeholder="批量添加主字卡：每行一条，空行自动忽略"></textarea><button type="button" data-card-bulk-add="chat">批量添加</button></div>
        <div class="duo-card-selection" data-card-selection="chat" hidden><button type="button" data-card-select-all="chat">全选当前结果</button><span data-card-selected-count>已选 0 条</span><button type="button" data-card-bulk-delete="chat" disabled>批量删除</button><button type="button" data-card-manage-cancel="chat">取消</button></div>
        <div data-card-list="chat"></div>
      </section>
      <section class="duo-card-pane" data-card-pane="moments-dynamic" hidden>
        <div class="duo-card-editor"><button type="button" data-card-draw="moments-dynamic">随机抽一条</button><button type="button" data-card-use="moments-dynamic" disabled>确认使用</button></div>
        <div class="duo-card-preview" data-card-preview="moments-dynamic"></div>
        <div class="duo-card-editor"><input data-card-input="moments-dynamic" maxlength="1000" placeholder="添加朋友圈动态字卡"><button type="button" data-card-add="moments-dynamic">添加</button></div>
        <div class="duo-card-search-row"><input type="search" data-card-search="moments-dynamic" placeholder="搜索朋友圈动态字卡"><button type="button" data-card-dedup="moments-dynamic">一键去重</button><button type="button" data-card-manage="moments-dynamic">批量管理</button></div>
        <div class="duo-card-bulk-add"><textarea data-card-bulk-input="moments-dynamic" rows="3" maxlength="200000" placeholder="批量添加朋友圈动态字卡：每行一条"></textarea><button type="button" data-card-bulk-add="moments-dynamic">批量添加</button></div>
        <div class="duo-card-selection" data-card-selection="moments-dynamic" hidden><button type="button" data-card-select-all="moments-dynamic">全选当前结果</button><span data-card-selected-count>已选 0 条</span><button type="button" data-card-bulk-delete="moments-dynamic" disabled>批量删除</button><button type="button" data-card-manage-cancel="moments-dynamic">取消</button></div>
        <div data-card-list="moments-dynamic"></div>
      </section>
      <section class="duo-card-pane" data-card-pane="moments-reply" hidden>
        <div class="duo-card-editor"><button type="button" data-card-draw="moments-reply">随机抽一条</button><button type="button" data-card-use="moments-reply" disabled>确认使用</button></div>
        <div class="duo-card-preview" data-card-preview="moments-reply"></div>
        <div class="duo-card-editor"><input data-card-input="moments-reply" maxlength="1000" placeholder="添加朋友圈回复字卡"><button type="button" data-card-add="moments-reply">添加</button></div>
        <div class="duo-card-search-row"><input type="search" data-card-search="moments-reply" placeholder="搜索朋友圈回复字卡"><button type="button" data-card-dedup="moments-reply">一键去重</button><button type="button" data-card-manage="moments-reply">批量管理</button></div>
        <div class="duo-card-bulk-add"><textarea data-card-bulk-input="moments-reply" rows="3" maxlength="200000" placeholder="批量添加朋友圈回复字卡：每行一条"></textarea><button type="button" data-card-bulk-add="moments-reply">批量添加</button></div>
        <div class="duo-card-selection" data-card-selection="moments-reply" hidden><button type="button" data-card-select-all="moments-reply">全选当前结果</button><span data-card-selected-count>已选 0 条</span><button type="button" data-card-bulk-delete="moments-reply" disabled>批量删除</button><button type="button" data-card-manage-cancel="moments-reply">取消</button></div>
        <div data-card-list="moments-reply"></div>
      </section>
      <section class="duo-card-pane" data-card-pane="recent" hidden><div data-recent-cards></div></section>`;
    param()?.appendChild(card);
    card.addEventListener('click',event=>{
      const tab=event.target.closest('[data-card-tab]');
      if(tab&&card.contains(tab)){cardView.active=tab.dataset.cardTab;renderCardManager();return;}
      const manage=event.target.closest('[data-card-manage]');if(manage){const key=manage.dataset.cardManage;cardView.batch[key]=!cardView.batch[key];cardView.selected[key].clear();renderCardPool(key);return;}
      const cancel=event.target.closest('[data-card-manage-cancel]');if(cancel){const key=cancel.dataset.cardManageCancel;cardView.batch[key]=false;cardView.selected[key].clear();renderCardPool(key);return;}
      const all=event.target.closest('[data-card-select-all]');if(all){const key=all.dataset.cardSelectAll,selected=cardView.selected[key],visible=filteredCardItems(key);const every=visible.length>0&&visible.every(item=>selected.has(item.id));if(every)visible.forEach(item=>selected.delete(item.id));else visible.forEach(item=>selected.add(item.id));renderCardPool(key);return;}
      const remove=event.target.closest('[data-card-bulk-delete]');if(remove){const key=remove.dataset.cardBulkDelete,ids=[...cardView.selected[key]];if(!ids.length)return;if(!window.confirm('确定删除选中的 '+ids.length+' 条'+cardPoolLabels[key]+'吗？'))return;try{const result=cardApi().bulkRemove(key,ids);cardView.selected[key].clear();cardView.batch[key]=false;renderCardPool(key);showToast('已删除 '+result.removed+' 条字卡');}catch(error){showToast('批量删除失败：'+(error.message||error));}return;}
      const deleteOne=event.target.closest('[data-card-delete-id]');if(deleteOne){const key=deleteOne.dataset.cardDeleteId,id=deleteOne.dataset.cardId;try{cardApi().bulkRemove(key,[id]);cardView.selected[key].delete(id);}catch(error){showToast('字卡删除失败：'+(error.message||error));}return;}
      const dedup=event.target.closest('[data-card-dedup]');if(dedup){const key=dedup.dataset.cardDedup;try{const result=cardApi().deduplicate(key);showToast(result.removed?'已去除 '+result.removed+' 条重复字卡':'没有重复字卡');}catch(error){showToast('去重失败：'+(error.message||error));}return;}
      const bulkAdd=event.target.closest('[data-card-bulk-add]');if(bulkAdd){const key=bulkAdd.dataset.cardBulkAdd,input=card.querySelector('[data-card-bulk-input="'+key+'"]');try{const result=cardApi().bulkAdd(key,input?.value||'');if(input)input.value='';showToast('新增 '+result.added+' 条，跳过重复 '+result.skipped+' 条，忽略空行 '+(result.emptyLines||0)+' 行');}catch(error){showToast('批量添加失败：'+(error.message||error));}return;}
      if(event.target.closest('[data-card-export]')){openCardExport();return;}
      if(event.target.closest('[data-card-import]')){card.querySelector('[data-card-file]')?.click();return;}
    });
    card.addEventListener('input',event=>{
      const search=event.target.closest('[data-card-search]');if(!search)return;const key=search.dataset.cardSearch;cardView.search[key]=search.value;renderCardList(key);renderCardSelection(key);
    });
    card.addEventListener('change',event=>{
      const check=event.target.closest('[data-card-select]');if(!check)return;const key=check.dataset.cardSelect;if(check.checked)cardView.selected[key].add(check.value);else cardView.selected[key].delete(check.value);renderCardSelection(key);
    });
    card.querySelector('[data-card-file]').addEventListener('change',event=>{
      const file=event.target.files?.[0];event.target.value='';if(!file)return;
      if(file.size>50*1024*1024){showToast('字卡 JSON 文件超过 50 MB，已拒绝读取');return;}
      const reader=new FileReader();reader.onload=()=>{try{const payload=JSON.parse(String(reader.result||''));showCardImportOptions(payload,file.name);}catch(error){showToast('无法解析字卡文件：'+(error.message||error));}};reader.onerror=()=>showToast('读取字卡文件失败');reader.readAsText(file,'UTF-8');
    });
    window.__duoCardManager={render:renderCardManager};
    renderCardManager();
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

  let subpageRoot=null;
  let currentCategory='';
  const categoryPages={};

  function createSubpageRoot(){
    if(subpageRoot)return subpageRoot;
    const root=document.createElement('section');
    root.id='duoSettingsSubpage';
    root.className='duo-settings-subpage';
    root.hidden=true;
    root.innerHTML=`
      <header class="duo-settings-subpage-head">
        <button type="button" data-category-back aria-label="返回参数区"><span aria-hidden="true">‹</span><span>参数区</span></button>
        <strong data-category-title></strong>
      </header>
      <div class="duo-settings-subpage-pages" data-category-pages></div>`;
    param()?.appendChild(root);
    root.querySelector('[data-category-back]').addEventListener('click',closeCategoryPage);
    root.querySelector('[data-category-pages]').addEventListener('click',event=>{
      const button=event.target.closest('[data-category-tab]');
      if(!button)return;
      activateCategoryTab(button.closest('[data-category-page]'),button.dataset.categoryTab);
    });
    subpageRoot=root;
    return root;
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
  }

  function defineCategory(key,title,sections){
    const root=createSubpageRoot();
    const pages=root.querySelector('[data-category-pages]');
    const liveSections=sections.filter(section=>section.nodes.some(node=>node&&node.isConnected));
    if(!liveSections.length)return false;
    const page=document.createElement('section');
    page.className='duo-settings-category-page';
    page.dataset.categoryPage=key;
    page.setAttribute('aria-label',title);
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
        button.type='button';
        button.className='duo-settings-subtab'+(index===0?' active':'');
        button.dataset.categoryTab=tabKey;
        button.setAttribute('role','tab');
        button.setAttribute('aria-selected',String(index===0));
        button.textContent=section.label;
        tabs.appendChild(button);
      }
      const pane=document.createElement('section');
      pane.className='duo-settings-category-pane';
      pane.dataset.categoryPane=tabKey;
      pane.hidden=index!==0;
      section.nodes.forEach(node=>{
        if(!node||!node.isConnected)return;
        const heading=node.querySelector?.('h3');
        if(heading&&heading.textContent.trim()===section.label)heading.remove();
        pane.appendChild(node);
      });
      content.appendChild(pane);
    });
    pages.appendChild(page);
    categoryPages[key]=page;
    return true;
  }

  function buildCategoryPages(){
    const profilePanels=Array.from($('#settingsIcon')?.children||[]).filter(node=>node.classList?.contains('panel-card'));
    const readReceipt=$('#paramReadReceiptPanel');
    const reply=$('#paramReplySettingsPanel');
    const inputSettings=$('#paramChatInputSettingsPanel');
    const rhythm=$('#paramChatRhythmPanel');
    const rules=$('#paramChatRulesPanel');
    const card=$('#duoUnifiedCardPanel');
    const theme=$('#duoAppearancePanel')||$('#paramAppearancePanel');
    const font=$('#duoFontPanel');
    const beautify=$('#duoChatBeautifyPanel');
    const stickerHost=$('#paramStickerAdminMount');
    const backup=$('#paramBackupPanel')||$('.backup-management');
    const data=$('#paramDataManagementPanel')||$('.data-management');

    defineCategory('profile','空间资料',[
      {key:'entrance',label:'首页入口',nodes:[profilePanels[0]]},
      {key:'personal',label:'头像与封面',nodes:[profilePanels[1]]},
      {key:'background',label:'背景图',nodes:[profilePanels[2]]}
    ]);
    defineCategory('chat','聊天设置',[
      {key:'send',label:'消息发送',nodes:[inputSettings]},
      {key:'read-receipt',label:'已读设置',nodes:[readReceipt]},
      {key:'reply',label:'回复设置',nodes:[reply]},
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

  const categoryTitles={
    profile:'空间资料',chat:'聊天设置',cards:'字卡管理',appearance:'显示与个性化',
    stickers:'表情包管理',privacy:'隐私与数据管理'
  };

  function openCategoryPage(key){
    const page=categoryPages[key];
    const hub=$('#settingsCategoryGrid');
    if(!page||!subpageRoot||!hub)return false;
    currentCategory=key;
    hub.hidden=true;
    subpageRoot.hidden=false;
    subpageRoot.querySelector('[data-category-title]').textContent=categoryTitles[key]||'设置';
    subpageRoot.querySelectorAll('[data-category-page]').forEach(item=>item.hidden=item!==page);
    const tabs=page.querySelector('[data-category-tabs]');
    const firstTab=tabs?.querySelector('[data-category-tab]');
    if(firstTab)activateCategoryTab(page,firstTab.dataset.categoryTab);
    else page.querySelectorAll('[data-category-pane]').forEach((pane,index)=>pane.hidden=index!==0);
    const scroll=$('#settingsPage .page-scroll');
    if(scroll)scroll.scrollTop=0;
    return true;
  }

  function closeCategoryPage(){
    if(!subpageRoot)return;
    subpageRoot.hidden=true;
    $('#settingsCategoryGrid')?.removeAttribute('hidden');
    currentCategory='';
    const scroll=$('#settingsPage .page-scroll');
    if(scroll)scroll.scrollTop=0;
  }

  function open(key){
    if(key==='circle'){
      const trigger=window.__duoCircleRoot?.querySelector('#backBtn');
      if(!trigger)return false;
      goto('circlePage');
      requestAnimationFrame(()=>{if(trigger.isConnected)trigger.click();});
      return true;
    }
    return openCategoryPage(key);
  }

  function boot(){
    const hub=$('#settingsCategoryGrid');
    const settingsParam=param();
    if(!hub||!settingsParam)return;

    buildCardManager();
    if(window.__duoCardSystem?.render)window.__duoCardSystem.render();
    setPanelId('回复设置','paramReplySettingsPanel');
    setPanelId('已读设置','paramReadReceiptPanel');
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
    // Remove explanatory copy from settings surfaces; keep field labels, values, statuses and actions.
    settingsParam.querySelectorAll('.data-note,.code-help,.call-settings-note,.desc,.duo-chat-beautify-head p,.duo-chat-beautify-footnote,.duo-chat-beautify-card p,.duo-sticker-admin__sub,.duo-sticker-admin__note').forEach(node=>node.remove());
    document.querySelectorAll('#callSettingsOverlay .desc,#callSettingsOverlay small,#callSettingsOverlay .call-settings-note').forEach(node=>node.remove());
    hub.querySelectorAll('small').forEach(node=>node.remove());

    const tabs=$('#settingsTabs');
    if(tabs)tabs.hidden=true;
    if(typeof setSettingsTab==='function')setSettingsTab('param');

    hub.addEventListener('click',event=>{
      const button=event.target.closest('[data-settings-category]');
      if(!button||!hub.contains(button))return;
      event.preventDefault();
      open(button.dataset.settingsCategory);
    });

    const style=document.createElement('style');
    style.id='duoSettingsInlineStyles';
    style.textContent=`
      #settingsTabs[hidden]{display:none!important}
      .settings-category-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:0}
      .settings-category-grid[hidden]{display:none!important}
      .settings-category-grid button{display:flex;flex-direction:column;align-items:flex-start;gap:6px;min-height:76px;padding:13px;border:1px solid var(--line);border-radius:14px;background:var(--panel);color:var(--text);text-align:left}
      .settings-category-grid strong{font-size:14px}.settings-category-grid small{font-size:11px;line-height:1.5;color:var(--sub)}
      .settings-category-grid button:active{transform:scale(.99)}
      .duo-settings-subpage[hidden]{display:none!important}
      .duo-settings-subpage{display:block;min-width:0}
      .duo-settings-subpage-head{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:12px;min-height:48px;margin:0 0 14px;padding:0 0 12px;border-bottom:1px solid var(--line);background:var(--bg)}
      .duo-settings-subpage-head [data-category-back]{display:inline-flex;align-items:center;gap:5px;min-height:36px;padding:0 10px;border:1px solid var(--line);border-radius:18px;background:var(--panel);color:var(--text);font-size:13px;white-space:nowrap}
      .duo-settings-subpage-head [data-category-back] span:first-child{font-size:25px;line-height:1}
      .duo-settings-subpage-head>strong{min-width:0;font-size:17px;font-weight:650}
      .duo-settings-subpage-pages{min-width:0}
      .duo-settings-category-page[hidden]{display:none!important}
      .duo-settings-subtabs[hidden]{display:none!important}
      .duo-settings-subtabs{display:flex;gap:8px;margin:0 0 14px;padding:0 0 10px;border-bottom:1px solid var(--line);overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch}
      .duo-settings-subtabs::-webkit-scrollbar{display:none}
      .duo-settings-subtab{flex:0 0 auto;min-height:36px;padding:8px 13px;border:1px solid var(--line);border-radius:999px;background:var(--panel);color:var(--sub);font-size:12px;white-space:nowrap}
      .duo-settings-subtab.active{background:var(--text);border-color:var(--text);color:var(--bg)}
      .duo-settings-category-pane[hidden]{display:none!important}
      .duo-settings-category-pane>.panel-card{margin:0 0 14px;padding:14px}
      .duo-settings-category-pane>.duo-settings-mount{display:block}
      .duo-settings-category-pane>.duo-settings-mount>.duo-sticker-admin{margin:0}
      .duo-settings-category-pane>.duo-appearance-custom-colors{margin-top:18px}
      .duo-appearance-custom-colors h4{font-size:14px;margin:0 0 12px;color:var(--text)}
      .duo-settings-category-pane .duo-chat-beautify-manager{margin:0}
      .duo-settings-category-pane .duo-font-list{max-width:100%}
      .duo-settings-category-pane .backup-management,.duo-settings-category-pane .data-management{margin:0 0 14px}
      .duo-card-transfer-actions,.duo-card-search-row,.duo-card-selection{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin:10px 0}
      .duo-card-transfer-actions{justify-content:flex-end}.duo-card-transfer-actions button,.duo-card-search-row button,.duo-card-selection button{min-height:34px;padding:7px 11px;border:1px solid var(--line);border-radius:10px;background:var(--panel);color:var(--text);font-size:12px}
      .duo-card-search-row input{flex:1;min-width:120px;min-height:36px;padding:8px 10px;border:1px solid var(--line);border-radius:10px;background:var(--panel);color:var(--text)}
      .duo-card-bulk-add{display:flex;gap:8px;align-items:stretch;margin:10px 0}.duo-card-bulk-add textarea{flex:1;min-width:0;min-height:76px;padding:9px;border:1px solid var(--line);border-radius:10px;background:var(--panel);color:var(--text);resize:vertical;font:inherit;font-size:13px}.duo-card-bulk-add button{align-self:flex-end;min-height:38px;padding:8px 12px;border-radius:10px;background:var(--button-bg);color:var(--button-text);font-size:12px}
      .duo-card-selection{padding:9px;border:1px solid var(--line);border-radius:11px;background:var(--soft)}.duo-card-selection span{flex:1;min-width:70px;color:var(--sub);font-size:12px}.duo-card-selection button:disabled{opacity:.45}.duo-card-select-check{width:18px;height:18px;flex:0 0 auto;accent-color:var(--theme-color)}.duo-card-row.is-selected{border-color:var(--theme-color);background:var(--soft)}
      .duo-card-transfer-overlay{position:fixed;inset:0;z-index:2147483440;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.48)}.duo-card-transfer-sheet{width:min(100%,480px);max-height:min(88dvh,760px);overflow:auto;padding:16px;border:1px solid var(--line);border-radius:18px;background:var(--panel);color:var(--text);box-shadow:0 16px 48px rgba(0,0,0,.24)}.duo-card-transfer-sheet header,.duo-card-transfer-sheet footer{display:flex;align-items:center;justify-content:space-between;gap:8px}.duo-card-transfer-sheet header strong{font-size:17px}.duo-card-transfer-sheet header button{width:34px;height:34px;border-radius:50%;background:var(--soft);color:var(--text)}.duo-card-transfer-sheet p{font-size:12px;line-height:1.6;color:var(--sub);margin:10px 0}.duo-card-transfer-options,.duo-card-import-modes{display:grid;gap:9px;margin:12px 0}.duo-card-transfer-options label,.duo-card-import-modes label{display:flex;align-items:flex-start;gap:9px;padding:10px;border:1px solid var(--line);border-radius:10px;font-size:13px}.duo-card-transfer-options input,.duo-card-import-modes input{margin-top:2px;accent-color:var(--theme-color)}.duo-card-import-modes{border:1px solid var(--line);border-radius:11px;padding:10px}.duo-card-import-modes legend{padding:0 5px;color:var(--sub);font-size:12px}.duo-card-transfer-sheet footer{justify-content:flex-end;margin-top:14px}.duo-card-transfer-sheet footer button{min-height:38px;padding:8px 13px;border-radius:10px;border:1px solid var(--line);background:var(--soft);color:var(--text)}.duo-card-transfer-sheet footer button.primary{background:var(--button-bg);color:var(--button-text);border-color:var(--button-bg)}.duo-card-transfer-warning{padding:9px;border-radius:9px;background:var(--soft);color:var(--sub)}
      @media(max-width:460px){.duo-card-bulk-add{flex-direction:column}.duo-card-bulk-add button{align-self:stretch}.duo-card-search-row{gap:5px}.duo-card-search-row button{padding:6px 8px}}
      @media(max-width:360px){.settings-category-grid{grid-template-columns:1fr}.duo-settings-subpage-head{gap:8px}}
    `;
    document.head.appendChild(style);

    // Android system Back first closes the currently open settings category.
    // Return false when the category hub is already visible so Android can
    // continue with the normal Activity back/exit behavior.
    window.__duoHandleSystemBack=function(){
      if(!currentCategory)return false;
      closeCategoryPage();
      return true;
    };

    window.__duoOpenSettingsCategory=open;
    window.__duoCloseSettingsCategory=closeCategoryPage;
    window.__duoSettingsPagesReady=true;
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();
