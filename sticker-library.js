/* 上传表情与收藏入口；沿用主应用 IndexedDB 媒体和 mediaId。 */
(function(){
  'use strict';
  if(window.__duoStickerLibraryInstalled)return;
  window.__duoStickerLibraryInstalled=true;
  if(!Array.isArray(state.stickerFavorites))state.stickerFavorites=[];
  let activeTab='builtin',renderGeneration=0;
  const $=s=>document.querySelector(s);
  function ensureTabs(){
    const head=$('#emojiPanel .sticker-head');if(!head)return;
    let bar=$('#duoStickerTabs');
    if(!bar){bar=document.createElement('div');bar.id='duoStickerTabs';bar.className='duo-sticker-tabs';head.insertAdjacentElement('afterend',bar);}
    let manage=head.querySelector('[data-open-sticker-admin]');
    if(!manage){manage=document.createElement('button');manage.type='button';manage.className='mini-btn duo-sticker-manage-btn';manage.dataset.openStickerAdmin='1';manage.textContent='管理';head.appendChild(manage);}
    // Normalize both static and dynamically-created markup to exactly these two tabs.
    bar.innerHTML='<button type="button" data-duo-sticker-tab="builtin" class="active">内置</button><button type="button" data-duo-sticker-tab="uploads">我的上传</button><button type="button" data-duo-sticker-tab="favorites">收藏</button>';
    let style=$('#duoStickerLibraryStyle');
    if(!style){style=document.createElement('style');style.id='duoStickerLibraryStyle';document.head.appendChild(style);}
    style.textContent='.duo-sticker-tabs{display:flex;gap:6px;padding:8px 10px;border-bottom:1px solid var(--line);background:var(--panel)}.duo-sticker-tabs button{flex:1;min-width:0;padding:7px 4px;border:1px solid var(--line);border-radius:9px;background:var(--soft);color:var(--text);font-size:12px}.duo-sticker-tabs button.active{background:var(--accent);border-color:var(--theme-color);color:var(--text);font-weight:700}.duo-sticker-item{position:relative}.duo-sticker-fav{position:absolute;right:7px;top:7px;width:27px;height:27px;border-radius:50%;background:rgba(20,20,20,.58);color:#fff;font-size:15px;display:grid;place-items:center}.duo-sticker-fav.active{color:#ffd36a}.duo-sticker-manage-btn{padding:6px 9px!important;font-size:11px!important}';
  }
  async function render(){
    const generation=++renderGeneration;
    const list=$('#stickerList');if(!list)return;ensureTabs();
    if(!['builtin','uploads','favorites'].includes(activeTab))activeTab='builtin';
    document.querySelectorAll('[data-duo-sticker-tab]').forEach(b=>b.classList.toggle('active',b.dataset.duoStickerTab===activeTab));
    const fav=new Set(state.stickerFavorites||[]);
    const items=(state.stickers||[]).map((s,i)=>({s,i})).filter(x=>{
      if(activeTab==='builtin')return x.s.source==='builtin';
      if(activeTab==='uploads')return x.s.source!=='builtin';
      return fav.has(x.s.id);
    });
    if(!items.length){
      const empty=activeTab==='favorites'?'还没有收藏表情包。':activeTab==='uploads'?'还没有上传表情包，点击“添加图片 / GIF”。':'内置表情包尚未载入，请检查应用资源包。';
      list.innerHTML='<div class="empty-stickers">'+empty+'</div>';return;
    }
    for(const {s} of items){
      if(s.source==='builtin'&&s.assetUrl&&!s.mediaId){stickerObjectUrls.set(s.id,s.assetUrl);continue;}
      if(!stickerObjectUrls.has(s.id)||s.source==='builtin'&&stickerObjectUrls.get(s.id)!==s.assetUrl){
        try{const rec=await getMediaRecord(s.mediaId);if(generation!==renderGeneration)return;const stillPresent=(state.stickers||[]).some(current=>current.id===s.id&&current.mediaId===s.mediaId);if(stillPresent&&rec&&rec.blob)stickerObjectUrls.set(s.id,URL.createObjectURL(rec.blob));}
        catch(_){if(generation!==renderGeneration)return;}
      }
    }
    if(generation!==renderGeneration)return;
    list.innerHTML=items.map(({s,i})=>{const url=stickerObjectUrls.get(s.id)||'';const isFav=fav.has(s.id);return '<div class="sticker-item duo-sticker-item" data-sticker-index="'+i+'"><img src="'+url+'" alt="表情包" loading="lazy" onerror="this.style.opacity=.25;this.alt=\'资源读取失败\'"><button class="sticker-send" type="button" data-sticker-send="'+i+'" data-sticker-send-id="'+String(s.id).replace(/["&<>]/g,'')+'" aria-label="发送表情包">发送</button><button class="sticker-del" type="button" data-sticker-del="'+i+'" data-sticker-del-id="'+String(s.id).replace(/["&<>]/g,'')+'" aria-label="删除表情包">×</button><button class="duo-sticker-fav '+(isFav?'active':'')+'" type="button" data-duo-sticker-fav="'+String(s.id).replace(/["&<>]/g,'')+'" aria-label="'+(isFav?'取消收藏':'收藏')+'">'+(isFav?'★':'☆')+'</button></div>';}).join('');
  }
  window.renderStickerList=render;
  window.__duoStickerLibrary={invalidate(){renderGeneration++;stickerObjectUrls.forEach(url=>{if(url&&url.startsWith('blob:'))URL.revokeObjectURL(url);});stickerObjectUrls.clear();}};
  document.addEventListener('click',function(e){
    const manage=e.target&&e.target.closest?e.target.closest('[data-open-sticker-admin]'):null;
    if(manage){e.preventDefault();e.stopImmediatePropagation();if(window.__duoOpenSettingsCategory)window.__duoOpenSettingsCategory('stickers');else if(typeof showToast==='function')showToast('表情包管理入口尚未加载');return;}
    const tab=e.target&&e.target.closest?e.target.closest('[data-duo-sticker-tab]'):null;
    if(tab){e.preventDefault();e.stopImmediatePropagation();const next=tab.dataset.duoStickerTab;if(!['builtin','uploads','favorites'].includes(next))return;activeTab=next;render();return;}
    const fav=e.target&&e.target.closest?e.target.closest('[data-duo-sticker-fav]'):null;
    if(fav){e.preventDefault();e.stopImmediatePropagation();const id=fav.dataset.duoStickerFav;try{window.__duoStickerState?.toggleFavorite?.(id);save();render();}catch(error){showToast('收藏状态保存失败：'+(error.message||error));}return;}
  },true);
  document.addEventListener('click',function(e){const add=e.target&&e.target.closest?e.target.closest('#addStickerBtn'):null;if(add){activeTab='uploads';setTimeout(render,0);}},true);
  ensureTabs();
  const oldRender=window.renderStickerList;
  if(typeof oldRender==='function')render().catch(e=>console.warn('[双人空间表情包]',e));
  async function loadBuiltinStickerManifest(){
    const response=await fetch('assets/builtin-stickers/manifest.json',{cache:'force-cache'});
    if(!response.ok)throw new Error('manifest HTTP '+response.status);
    const manifest=await response.json();
    if(manifest?.version!==1||manifest.totalCount!==353||!Array.isArray(manifest.items)||manifest.items.length!==353)throw new Error('内置表情包清单数量或版本不匹配');
    const result=window.__duoStickerState?.registerBuiltins?.(manifest.items);
    if(!result)throw new Error('内置表情包索引接口不可用');
    if(result.added||result.updated)save();
    await render();
  }
  loadBuiltinStickerManifest().catch(error=>{console.warn('[双人空间内置表情包]',error);render();});
})();