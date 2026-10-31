/* 上传表情、收藏与内置表情入口。内置资源尚未复制时明确显示缺失状态，不使用参考站点外链。 */
(function(){
  'use strict';
  if(window.__duoStickerLibraryInstalled)return;
  window.__duoStickerLibraryInstalled=true;
  if(!Array.isArray(state.stickerFavorites))state.stickerFavorites=[];
  let activeTab='uploads';
  const $=s=>document.querySelector(s);
  function ensureTabs(){
    const head=$('#emojiPanel .sticker-head');if(!head||$('#duoStickerTabs'))return;
    const bar=document.createElement('div');bar.id='duoStickerTabs';bar.className='duo-sticker-tabs';
    bar.innerHTML='<button type="button" data-duo-sticker-tab="uploads" class="active">我的上传</button><button type="button" data-duo-sticker-tab="favorites">收藏</button><button type="button" data-duo-sticker-tab="builtin" aria-label="内置表情资源尚未迁入">内置表情</button>';
    head.insertAdjacentElement('afterend',bar);
    const style=document.createElement('style');style.id='duoStickerLibraryStyle';style.textContent='.duo-sticker-tabs{display:flex;gap:6px;padding:8px 10px;border-bottom:1px solid var(--line);background:var(--panel)}.duo-sticker-tabs button{flex:1;min-width:0;padding:7px 4px;border:1px solid var(--line);border-radius:9px;background:var(--soft);color:var(--text);font-size:12px}.duo-sticker-tabs button.active{background:var(--accent);border-color:var(--theme-color);color:var(--text);font-weight:700}.duo-sticker-item{position:relative}.duo-sticker-fav{position:absolute;right:7px;top:7px;width:27px;height:27px;border-radius:50%;background:rgba(20,20,20,.58);color:#fff;font-size:15px;display:grid;place-items:center}.duo-sticker-fav.active{color:#ffd36a}.duo-sticker-notice{margin:12px;padding:13px;border:1px dashed var(--line);border-radius:12px;color:var(--sub);font-size:12px;line-height:1.7;background:var(--soft)}';
    document.head.appendChild(style);
  }
  async function render(){
    const list=$('#stickerList');if(!list)return;ensureTabs();
    document.querySelectorAll('[data-duo-sticker-tab]').forEach(b=>b.classList.toggle('active',b.dataset.duoStickerTab===activeTab));
    if(activeTab==='builtin'){
      list.innerHTML='<div class="duo-sticker-notice"><b>内置表情资源尚未迁入</b><br>已重新核对参考仓库最新的 embedded 目录：53 个文件（GIF 9、JPG 41、PNG 3）。当前 GitHub 文件接口未能提供这些图片的二进制内容，因此没有写入伪造资源，也没有依赖参考站点的在线图片地址。完成二进制资源同步后，此处才会显示内置表情。</div>';
      return;
    }
    const fav=new Set(state.stickerFavorites||[]);
    const items=(state.stickers||[]).map((s,i)=>({s,i})).filter(x=>activeTab==='favorites'?fav.has(x.s.id):true);
    if(!items.length){list.innerHTML='<div class="empty-stickers">'+(activeTab==='favorites'?'还没有收藏表情包。':'还没有表情包，点击“添加图片 / GIF”。')+'</div>';return;}
    for(const {s} of items){if(!stickerObjectUrls.has(s.id)){try{const rec=await getMediaRecord(s.mediaId);if(rec&&rec.blob)stickerObjectUrls.set(s.id,URL.createObjectURL(rec.blob));}catch(_){}}}
    list.innerHTML=items.map(({s,i})=>{const url=stickerObjectUrls.get(s.id)||'';const isFav=fav.has(s.id);return '<div class="sticker-item duo-sticker-item" data-sticker-index="'+i+'"><img src="'+url+'" alt="表情包" loading="lazy" onerror="this.style.opacity=.25;this.alt=\'资源读取失败\'"><button class="sticker-send" type="button" data-sticker-send="'+i+'" aria-label="发送表情包">发送</button><button class="sticker-del" type="button" data-sticker-del="'+i+'" aria-label="删除表情包">×</button><button class="duo-sticker-fav '+(isFav?'active':'')+'" type="button" data-duo-sticker-fav="'+String(s.id).replace(/["&<>]/g,'')+'" aria-label="'+(isFav?'取消收藏':'收藏')+'">'+(isFav?'★':'☆')+'</button></div>';}).join('');
  }
  window.renderStickerList=render;
  document.addEventListener('click',function(e){
    const tab=e.target&&e.target.closest?e.target.closest('[data-duo-sticker-tab]'):null;
    if(tab){e.preventDefault();e.stopImmediatePropagation();activeTab=tab.dataset.duoStickerTab;render();return;}
    const fav=e.target&&e.target.closest?e.target.closest('[data-duo-sticker-fav]'):null;
    if(fav){e.preventDefault();e.stopImmediatePropagation();const id=fav.dataset.duoStickerFav;const set=new Set(state.stickerFavorites||[]);if(set.has(id))set.delete(id);else if((state.stickers||[]).some(x=>x.id===id))set.add(id);state.stickerFavorites=[...set];save();render();return;}
  },true);
  document.addEventListener('click',function(e){const add=e.target&&e.target.closest?e.target.closest('#addStickerBtn'):null;if(add){activeTab='uploads';setTimeout(render,0);}},true);
  ensureTabs();
  const oldRender=window.renderStickerList;
  if(typeof oldRender==='function')render().catch(e=>console.warn('[双人空间表情包]',e));
})();