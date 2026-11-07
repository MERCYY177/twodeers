/* Sticker picker rendering: selection is direct-send; destructive management lives in the parameter area. */
(function(){
  'use strict';
  if(window.__duoStickerLibraryInstalled)return;
  window.__duoStickerLibraryInstalled=true;
  let renderGeneration=0;
  const $=selector=>document.querySelector(selector);
  const escapeAttr=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  function snapshot(){
    try{
      const value=window.__duoStickerState?.exportSnapshot?.();
      if(value&&Array.isArray(value.items))return value;
    }catch(error){console.warn('[表情包] 读取独立表情包库失败',error);}
    return {items:Array.isArray(state.stickers)?state.stickers:[],favorites:Array.isArray(state.stickerFavorites)?state.stickerFavorites:[]};
  }
  async function render(){
    const generation=++renderGeneration;
    const grid=$('#stickerGrid');if(!grid)return;
    const data=snapshot(),items=(data.items||[]).filter(item=>item&&typeof item.id==='string'&&!data.tombstones?.some(t=>t.id===item.id));
    const favorites=new Set(data.favorites||state.stickerFavorites||[]);
    if(!items.length){grid.innerHTML='<div class="kb-sticker-empty">暂无表情包，点击左上角＋添加图片或 GIF。</div>';return;}
    for(const item of items){
      if(item.source==='builtin'&&item.assetUrl){stickerObjectUrls.set(item.id,item.assetUrl);continue;}
      const current=stickerObjectUrls.get(item.id);
      if(current&&current.startsWith('blob:'))continue;
      if(!item.mediaId)continue;
      try{
        const record=await getMediaRecord(item.mediaId);
        if(generation!==renderGeneration)return;
        const latest=snapshot().items.find(value=>value.id===item.id&&value.mediaId===item.mediaId);
        if(latest&&record?.blob)stickerObjectUrls.set(item.id,URL.createObjectURL(record.blob));
      }catch(error){console.warn('[表情包] 图片读取失败',item.name||item.id,error);}
    }
    if(generation!==renderGeneration)return;
    grid.innerHTML=items.map(item=>{
      const url=stickerObjectUrls.get(item.id)||'';
      const favorite=favorites.has(item.id);
      return '<div class="kb-sticker-item" data-sticker-id="'+escapeAttr(item.id)+'" role="button" tabindex="0" aria-label="发送表情包：'+escapeAttr(item.name||'表情包')+'">'+
        '<img src="'+escapeAttr(url)+'" alt="'+escapeAttr(item.name||'表情包')+'" loading="lazy" decoding="async">'+
        '<button type="button" class="kb-sticker-favorite'+(favorite?' active':'')+'" data-sticker-favorite="'+escapeAttr(item.id)+'" aria-label="'+(favorite?'取消收藏':'收藏')+'">'+(favorite?'★':'☆')+'</button>'+
      '</div>';
    }).join('');
  }
  function invalidate(){
    renderGeneration++;
    stickerObjectUrls.forEach(url=>{if(url&&url.startsWith('blob:'))URL.revokeObjectURL(url);});
    stickerObjectUrls.clear();
  }
  window.renderStickerList=render;
  window.__duoStickerLibrary={invalidate,render};
  document.addEventListener('click',event=>{
    const favorite=event.target?.closest?.('[data-sticker-favorite]');
    if(!favorite)return;
    event.preventDefault();event.stopImmediatePropagation();
    const id=favorite.dataset.stickerFavorite;
    try{
      const result=window.__duoStickerState?.toggleFavorite?.(id);
      if(!result)throw new Error('表情包已不存在');
      if(save()===false)throw new Error('收藏状态镜像未能保存');
      void render();
    }catch(error){showToast('收藏状态保存失败：'+(error.message||error));}
  },true);
  document.addEventListener('keydown',event=>{
    const item=event.target?.closest?.('[data-sticker-id]');
    if(!item||!['Enter',' '].includes(event.key))return;
    if(event.target.closest('[data-sticker-favorite]'))return;
    event.preventDefault();const id=item.dataset.stickerId;if(id)void sendSticker(id);
  });
  async function loadBuiltinStickerManifest(){
    const response=await fetch('assets/builtin-stickers/manifest.json',{cache:'force-cache'});
    if(!response.ok)throw new Error('manifest HTTP '+response.status);
    const manifest=await response.json();
    if(manifest?.version!==1||manifest.totalCount!==352||!Array.isArray(manifest.items)||manifest.items.length!==352)throw new Error('内置表情包清单数量或版本不匹配');
    const result=window.__duoStickerState?.registerBuiltins?.(manifest.items);
    if(!result)throw new Error('内置表情包索引接口不可用');
    if(result.added||result.updated)save();
    await render();
  }
  loadBuiltinStickerManifest().catch(error=>{console.warn('[双人空间内置表情包]',error);void render();});
  const initial=snapshot();
  if(initial.items.length)void render();
  window.addEventListener('storage',event=>{
    if(event.key!==STICKER_LIBRARY_STORAGE_KEY)return;
    invalidate();void render();
  });
})();