/* Sticker picker rendering: selection is direct-send; destructive management lives in the parameter area. */
(function(){
  'use strict';
  if(window.__duoStickerLibraryInstalled)return;
  window.__duoStickerLibraryInstalled=true;
  let renderGeneration=0;
  let armedSticker=null;
  let activePointer=null;
  let pressTimer=0;
  let pressStartX=0,pressStartY=0;
  let suppressClickUntil=0;
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
      return '<div class="kb-sticker-item" data-sticker-id="'+escapeAttr(item.id)+'" role="button" tabindex="0" aria-label="发送表情包：'+escapeAttr(item.name||'表情包')+'，长按删除">'+
        '<img src="'+escapeAttr(url)+'" alt="'+escapeAttr(item.name||'表情包')+'" loading="lazy" decoding="async">'+
        '<button type="button" class="kb-sticker-delete" data-sticker-delete="'+escapeAttr(item.id)+'" aria-label="删除这张表情包" tabindex="-1">×</button>'+
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
  function stopPressTimer(){if(pressTimer){clearTimeout(pressTimer);pressTimer=0;}}
  function clearArmedSticker(){
    if(armedSticker?.classList)armedSticker.classList.remove('delete-armed');
    armedSticker=null;
  }
  function armStickerForDelete(item){
    if(!item)return;
    clearArmedSticker();
    armedSticker=item;
    item.classList.add('delete-armed');
  }
  async function deleteSticker(id,item){
    const before=snapshot();
    const sticker=(before.items||[]).find(value=>value.id===id);
    if(!sticker){clearArmedSticker();void render();return;}
    if(!window.confirm('删除这张表情包？删除后不会因重新加载内置清单而恢复。'))return;
    try{
      const removed=window.__duoStickerState?.deleteBatch?.([id])||[];
      if(!Array.isArray(removed)||!removed.length)throw new Error('表情包已不存在或删除失败');
      if(typeof save==='function'&&save()===false){
        window.__duoStickerState?.restoreSnapshot?.(before);
        save();
        throw new Error('保存失败，已恢复这张表情包');
      }
      const objectUrl=stickerObjectUrls.get(id);
      if(objectUrl?.startsWith('blob:'))URL.revokeObjectURL(objectUrl);
      stickerObjectUrls.delete(id);
      clearArmedSticker();
      void render();
      if(sticker.mediaId&&typeof deleteIfUnreferenced==='function'){
        void deleteIfUnreferenced(sticker.mediaId).catch(error=>console.warn('[表情包] 清理未引用图片失败',error));
      }
      if(typeof showToast==='function')showToast('已删除这张表情包');
    }catch(error){
      clearArmedSticker();
      if(typeof showToast==='function')showToast(error.message||'表情包删除失败');
    }
  }
  const stickerGrid=$('#stickerGrid');
  if(stickerGrid&&!stickerGrid.__duoLongPressDeleteBound){
    stickerGrid.__duoLongPressDeleteBound=true;
    stickerGrid.addEventListener('pointerdown',event=>{
      const item=event.target?.closest?.('[data-sticker-id]');
      if(!item||!stickerGrid.contains(item)||event.target?.closest?.('[data-sticker-delete]'))return;
      if(event.pointerType==='mouse'&&event.button!==0)return;
      stopPressTimer();activePointer=event.pointerId;pressStartX=event.clientX;pressStartY=event.clientY;
      pressTimer=setTimeout(()=>{
        pressTimer=0;
        if(activePointer!==event.pointerId)return;
        activePointer=null;
        armStickerForDelete(item);
        suppressClickUntil=Date.now()+900;
      },800);
    },{passive:true});
    stickerGrid.addEventListener('pointermove',event=>{
      if(activePointer!==event.pointerId)return;
      if(Math.abs(event.clientX-pressStartX)>10||Math.abs(event.clientY-pressStartY)>10){
        stopPressTimer();activePointer=null;suppressClickUntil=Date.now()+300;
      }
    },{passive:true});
    const finishPress=event=>{if(activePointer===event.pointerId){stopPressTimer();activePointer=null;}};
    stickerGrid.addEventListener('pointerup',finishPress,{passive:true});
    stickerGrid.addEventListener('pointercancel',finishPress,{passive:true});
    stickerGrid.addEventListener('contextmenu',event=>{if(event.target?.closest?.('[data-sticker-id]'))event.preventDefault();});
    // Capture phase prevents the chat page's normal click-to-send handler from treating a delete tap as a send.
    stickerGrid.addEventListener('click',event=>{
      const deleteButton=event.target?.closest?.('[data-sticker-delete]');
      if(deleteButton){
        event.preventDefault();event.stopImmediatePropagation();
        const item=deleteButton.closest('[data-sticker-id]');
        void deleteSticker(deleteButton.dataset.stickerDelete,item);
        return;
      }
      const item=event.target?.closest?.('[data-sticker-id]');
      if(!item){clearArmedSticker();return;}
      if(Date.now()<suppressClickUntil){event.preventDefault();event.stopImmediatePropagation();return;}
      if(armedSticker){clearArmedSticker();event.preventDefault();event.stopImmediatePropagation();}
    },true);
    document.addEventListener('click',event=>{
      if(!stickerGrid.contains(event.target))clearArmedSticker();
    });
    stickerGrid.addEventListener('scroll',()=>{
      stopPressTimer();activePointer=null;clearArmedSticker();
    },{passive:true});
  }
  document.addEventListener('keydown',event=>{
    const item=event.target?.closest?.('[data-sticker-id]');
    if(!item||!['Enter',' '].includes(event.key))return;
    if(event.target.closest('[data-sticker-delete]'))return;
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