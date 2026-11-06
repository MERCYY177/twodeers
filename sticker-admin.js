/* Dedicated sticker inventory and batch-management page. */
(function(){
  'use strict';
  if(window.__duoStickerAdminInstalled)return;
  window.__duoStickerAdminInstalled=true;

  const $=s=>document.querySelector(s);
  let root=null,filter='all',query='',selected=new Set(),renderGeneration=0;
  const previewUrls=new Map();

  function ensureStyles(){
    if($('#duoStickerAdminStyle'))return;
    const style=document.createElement('style');
    style.id='duoStickerAdminStyle';
    style.textContent=[
      '.duo-sticker-admin{display:block;margin:0 0 18px}',
      '.duo-sticker-admin__top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}',
      '.duo-sticker-admin__top h3{margin:0 0 6px}',
      '.duo-sticker-admin__sub,.duo-sticker-admin__note{font-size:12px;line-height:1.65;color:var(--sub,#888)}',
      '.duo-sticker-admin__count{flex:0 0 auto;padding:7px 10px;border:1px solid var(--line);border-radius:999px;font-size:12px;color:var(--sub)}',
      '.duo-sticker-admin__search{display:flex;gap:8px;margin:14px 0 10px}',
      '.duo-sticker-admin__search input{flex:1;min-width:0;border:1px solid var(--line);border-radius:10px;padding:10px 12px;background:var(--panel);color:var(--text)}',
      '.duo-sticker-admin__filters,.duo-sticker-admin__toolbar,.duo-sticker-admin__exports{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin:10px 0}',
      '.duo-sticker-admin button{border:1px solid var(--line);border-radius:10px;padding:8px 11px;background:var(--panel);color:var(--text);font-size:12px;font-weight:650}',
      '.duo-sticker-admin button.active{background:var(--text);border-color:var(--text);color:var(--bg)}',
      '.duo-sticker-admin button:disabled{opacity:.4;cursor:not-allowed}',
      '.duo-sticker-admin button.danger{background:#fff1f0;border-color:#ffc9c4;color:#c62828}',
      '.duo-sticker-admin__selected{font-size:12px;color:var(--sub);margin-right:auto}',
      '.duo-sticker-admin__note{padding:9px 11px;border-radius:10px;background:var(--soft,#f7f7f7);margin:12px 0}',
      '.duo-sticker-admin__grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:10px;margin-top:12px}',
      '.duo-sticker-admin__item{min-width:0;border:1px solid var(--line);border-radius:13px;padding:8px;background:var(--panel)}',
      '.duo-sticker-admin__item.selected{border-color:var(--theme-color,#8aa05f);box-shadow:0 0 0 1px var(--theme-color,#8aa05f)}',
      '.duo-sticker-admin__item-head{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:7px}',
      '.duo-sticker-admin__item-head input{width:17px;height:17px;accent-color:var(--theme-color,#8aa05f)}',
      '.duo-sticker-admin__source{font-size:10px;color:var(--sub)}',
      '.duo-sticker-admin__preview{width:100%;aspect-ratio:1/1;border-radius:9px;background:var(--soft,#f7f7f7);display:grid;place-items:center;overflow:hidden}',
      '.duo-sticker-admin__preview img{width:100%;height:100%;object-fit:contain;display:block}',
      '.duo-sticker-admin__preview span{font-size:11px;color:var(--sub)}',
      '.duo-sticker-admin__name{font-size:12px;font-weight:700;line-height:1.45;margin-top:8px;overflow-wrap:anywhere}',
      '.duo-sticker-admin__meta{font-size:10px;line-height:1.55;color:var(--sub);margin-top:4px;overflow-wrap:anywhere}',
      '.duo-sticker-admin__empty{padding:34px 12px;text-align:center;color:var(--sub);font-size:13px;border:1px dashed var(--line);border-radius:12px}',
      '@media(max-width:360px){.duo-sticker-admin__grid{grid-template-columns:repeat(2,minmax(0,1fr))}.duo-sticker-admin button{padding:8px 9px}}'
    ].join('');
    document.head.appendChild(style);
  }

  function snapshot(){
    try{return window.__duoStickerState?.exportSnapshot?.()||{items:[],favorites:[],tombstones:[],revision:0};}
    catch(error){throw new Error('读取表情包库失败：'+(error.message||error));}
  }
  function formatSize(value){
    const size=Math.max(0,Number(value)||0);
    if(size<1024)return size+' B';
    if(size<1024*1024)return (size/1024).toFixed(1)+' KB';
    return (size/1024/1024).toFixed(2)+' MB';
  }
  function visibleItems(data){
    const favorites=new Set(data.favorites||[]);
    const needle=query.trim().toLocaleLowerCase();
    return (data.items||[]).filter(item=>{
      if(filter==='favorites'&&!favorites.has(item.id))return false;
      if(filter==='uploads'&& !item.id)return false;
      if(!needle)return true;
      return [item.name,item.id,item.mediaId,item.mimeType].some(value=>String(value||'').toLocaleLowerCase().includes(needle));
    });
  }
  function updateToolbar(data,visible){
    if(!root)return;
    const count=root.querySelector('[data-sticker-admin-count]');
    const selectedCount=root.querySelector('[data-sticker-admin-selected]');
    if(count)count.textContent=(data.items||[]).length+' 张';
    if(selectedCount)selectedCount.textContent='已选 '+selected.size+' 张';
    const hasSelected=selected.size>0;
    ['delete','export-selected-json','export-selected-csv'].forEach(key=>{
      const button=root.querySelector('[data-sticker-admin-'+key+']');
      if(button)button.disabled=!hasSelected;
    });
    const clear=root.querySelector('[data-sticker-admin-clear-selection]');
    if(clear)clear.disabled=!hasSelected;
    const selectAll=root.querySelector('[data-sticker-admin-select-all]');
    if(selectAll)selectAll.disabled=!visible.length;
    const clearAll=root.querySelector('[data-sticker-admin-clear-all]');
    if(clearAll)clearAll.disabled=!(data.items||[]).length;
    root.querySelectorAll('[data-sticker-admin-filter]').forEach(button=>button.classList.toggle('active',button.dataset.stickerAdminFilter===filter));
  }
  function prunePreviewUrls(data){
    const live=new Set((data.items||[]).map(item=>item.mediaId).filter(Boolean));
    for(const [id,url] of previewUrls){
      if(live.has(id))continue;
      if(url&&url.startsWith('blob:'))URL.revokeObjectURL(url);
      previewUrls.delete(id);
    }
  }
  async function loadPreview(item,image,generation){
    if(previewUrls.has(item.mediaId)){image.src=previewUrls.get(item.mediaId);return;}
    try{
      if(typeof getMediaRecord!=='function')throw new Error('媒体读取接口不可用');
      const record=await getMediaRecord(item.mediaId);
      if(generation!==renderGeneration)return;
      if(!record?.blob)throw new Error('图片文件不存在');
      const url=URL.createObjectURL(record.blob);
      previewUrls.set(item.mediaId,url);
      image.src=url;
    }catch(error){
      if(generation!==renderGeneration)return;
      image.alt='图片读取失败';
      const wrap=image.parentElement;
      if(wrap){wrap.textContent='图片读取失败';}
    }
  }
  async function render(){
    if(!root)return;
    const generation=++renderGeneration;
    let data;
    try{data=snapshot();}
    catch(error){const grid=root.querySelector('[data-sticker-admin-grid]');if(grid)grid.textContent=error.message;return;}
    const live=new Set((data.items||[]).map(item=>item.id));
    for(const id of selected)if(!live.has(id))selected.delete(id);
    prunePreviewUrls(data);
    const visible=visibleItems(data);
    const grid=root.querySelector('[data-sticker-admin-grid]');
    if(!grid)return;
    grid.replaceChildren();
    if(!visible.length){
      const empty=document.createElement('div');
      empty.className='duo-sticker-admin__empty';
      empty.textContent=query?'没有符合搜索条件的表情包。':(filter==='favorites'?'还没有收藏表情包。':'表情包库目前为空。');
      grid.appendChild(empty);
    }else{
      const fragment=document.createDocumentFragment();
      const previewJobs=[];
      const favorites=new Set(data.favorites||[]);
      visible.forEach(item=>{
        const card=document.createElement('article');
        card.className='duo-sticker-admin__item'+(selected.has(item.id)?' selected':'');
        const head=document.createElement('div');head.className='duo-sticker-admin__item-head';
        const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=selected.has(item.id);checkbox.dataset.stickerAdminSelect=item.id;checkbox.setAttribute('aria-label','选择 '+(item.name||item.id));
        const source=document.createElement('span');source.className='duo-sticker-admin__source';source.textContent='我的上传';
        head.append(checkbox,source);
        const preview=document.createElement('div');preview.className='duo-sticker-admin__preview';
        const image=document.createElement('img');image.alt=item.name||'表情包';image.loading='lazy';
        const placeholder=document.createElement('span');placeholder.textContent='读取中…';
        preview.append(image,placeholder);
        image.addEventListener('load',()=>placeholder.remove(),{once:true});
        const name=document.createElement('div');name.className='duo-sticker-admin__name';name.textContent=item.name||'未命名表情包';
        const meta=document.createElement('div');meta.className='duo-sticker-admin__meta';
        meta.textContent=(item.mimeType||'未知格式')+' · '+formatSize(item.size)+' · '+(favorites.has(item.id)?'已收藏':'未收藏');
        card.append(head,preview,name,meta);
        if(item.id&&item.mediaId)previewJobs.push(loadPreview(item,image,generation));
        fragment.appendChild(card);
      });
      grid.appendChild(fragment);
      void Promise.all(previewJobs);
    }
    updateToolbar(data,visible);
  }
  function payloadFor(items,data){
    const favorites=new Set(data.favorites||[]);
    return {
      type:'twodeers-sticker-library-list',
      version:1,
      exportedAt:new Date().toISOString(),
      count:items.length,
      items:items.map(item=>({
        id:item.id,
        mediaId:item.mediaId,
        name:item.name||'',
        mimeType:item.mimeType||'application/octet-stream',
        size:Math.max(0,Number(item.size)||0),
        source:'upload',
        favorite:favorites.has(item.id)
      }))
    };
  }
  function csvCell(value){
    const text=String(value??'');
    return '"'+text.replace(/"/g,'""')+'"';
  }
  function download(name,blob){
    if(typeof triggerDownloadBlob==='function'){triggerDownloadBlob(name,blob);return;}
    const url=URL.createObjectURL(blob),anchor=document.createElement('a');
    anchor.href=url;anchor.download=name;document.body.appendChild(anchor);anchor.click();anchor.remove();
    setTimeout(()=>URL.revokeObjectURL(url),5000);
  }
  function exportList(format,scope){
    let data;
    try{data=snapshot();}catch(error){if(typeof showToast==='function')showToast(error.message);return;}
    const items=scope==='selected'?(data.items||[]).filter(item=>selected.has(item.id)):(data.items||[]);
    if(!items.length){if(typeof showToast==='function')showToast('没有可导出的表情包');return;}
    const payload=payloadFor(items,data);
    if(format==='json'){
      download('twodeers-sticker-list-'+scope+'.json',new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'}));
    }else{
      const rows=[['id','name','mediaId','mimeType','sizeBytes','source','favorite']];
      payload.items.forEach(item=>rows.push([item.id,item.name,item.mediaId,item.mimeType,item.size,item.source,item.favorite?'true':'false']));
      const csv='\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n');
      download('twodeers-sticker-list-'+scope+'.csv',new Blob([csv],{type:'text/csv;charset=utf-8'}));
    }
    if(typeof showToast==='function')showToast('已导出 '+items.length+' 张表情包清单；清单不包含图片原文件');
  }
  async function deleteItems(ids,label){
    const unique=[...new Set((ids||[]).filter(id=>typeof id==='string'&&id))];
    if(!unique.length){if(typeof showToast==='function')showToast('请先选择表情包');return;}
    if(!window.confirm('确定永久删除 '+unique.length+' 张上传表情包吗？历史聊天消息中已经发送的图片会保留。'))return;
    let removed=[];
    try{
      if(!window.__duoStickerState?.deleteBatch)throw new Error('批量删除接口尚未加载');
      removed=window.__duoStickerState.deleteBatch(unique)||[];
    }catch(error){if(typeof showToast==='function')showToast('批量删除失败，未清理图片：'+(error.message||error));return;}
    if(!removed.length){if(typeof showToast==='function')showToast('所选表情包已不存在，列表已刷新');await render();return;}
    selected.clear();
    let mirrorOk=true;
    try{if(typeof save==='function')mirrorOk=save()!==false;}catch(_){mirrorOk=false;}
    window.__duoStickerLibrary?.invalidate?.();
    if(typeof window.renderStickerList==='function')await window.renderStickerList();
    let cleaned=0,retained=0,failed=0;
    for(const item of removed){
      try{
        if(typeof deleteIfUnreferenced==='function'){
          const didDelete=await deleteIfUnreferenced(item.mediaId);
          if(didDelete)cleaned++;else retained++;
        }else retained++;
      }catch(_){failed++;}
    }
    await render();
    const parts=['已从表情包库删除 '+removed.length+' 张'];
    if(cleaned)parts.push('清理未被引用的图片 '+cleaned+' 张');
    if(retained)parts.push('保留仍被历史消息等引用的图片 '+retained+' 张');
    if(failed)parts.push('图片清理失败 '+failed+' 张，可稍后检查');
    if(!mirrorOk)parts.push('主状态镜像同步未完成，独立表情包索引已保存');
    if(typeof showToast==='function')showToast(parts.join('；'));
  }
  function onClick(event){
    const button=event.target.closest('button');
    if(!button||!root.contains(button))return;
    const filterButton=button.closest('[data-sticker-admin-filter]');
    if(filterButton){filter=filterButton.dataset.stickerAdminFilter||'all';render();return;}
    if(button.hasAttribute('data-sticker-admin-refresh')){render();return;}
    if(button.hasAttribute('data-sticker-admin-select-all')){
      let data;try{data=snapshot();}catch(error){if(typeof showToast==='function')showToast(error.message);return;}
      visibleItems(data).forEach(item=>selected.add(item.id));render();return;
    }
    if(button.hasAttribute('data-sticker-admin-clear-selection')){selected.clear();render();return;}
    if(button.hasAttribute('data-sticker-admin-delete')){void deleteItems([...selected],'selected');return;}
    if(button.hasAttribute('data-sticker-admin-clear-all')){
      let data;try{data=snapshot();}catch(error){if(typeof showToast==='function')showToast(error.message);return;}
      void deleteItems((data.items||[]).map(item=>item.id),'all');return;
    }
    if(button.hasAttribute('data-sticker-admin-export-all-json')){exportList('json','all');return;}
    if(button.hasAttribute('data-sticker-admin-export-all-csv')){exportList('csv','all');return;}
    if(button.hasAttribute('data-sticker-admin-export-selected-json')){exportList('json','selected');return;}
    if(button.hasAttribute('data-sticker-admin-export-selected-csv')){exportList('csv','selected');return;}
  }
  function onChange(event){
    const checkbox=event.target.closest('[data-sticker-admin-select]');
    if(!checkbox||!root.contains(checkbox))return;
    if(checkbox.checked)selected.add(checkbox.dataset.stickerAdminSelect);
    else selected.delete(checkbox.dataset.stickerAdminSelect);
    const card=checkbox.closest('.duo-sticker-admin__item');
    if(card)card.classList.toggle('selected',checkbox.checked);
    let data;try{data=snapshot();}catch(_){data={items:[],favorites:[]};}
    updateToolbar(data,visibleItems(data));
  }
  function onInput(event){
    if(!event.target.matches('[data-sticker-admin-search]'))return;
    query=event.target.value||'';
    render();
  }
  function mount(container){
    if(!container)return;
    ensureStyles();
    selected.clear();filter='all';query='';
    container.innerHTML='<section class="panel-card duo-sticker-admin"><div class="duo-sticker-admin__top"><div><h3>表情包管理</h3><div class="duo-sticker-admin__sub">集中查看、筛选、批量删除和导出表情包清单。</div></div><span class="duo-sticker-admin__count" data-sticker-admin-count>0 张</span></div><div class="duo-sticker-admin__search"><input type="search" data-sticker-admin-search placeholder="搜索名称、ID、格式或媒体编号"><button type="button" data-sticker-admin-refresh>刷新</button></div><div class="duo-sticker-admin__filters"><button type="button" class="active" data-sticker-admin-filter="all">全部</button><button type="button" data-sticker-admin-filter="uploads">我的上传</button><button type="button" data-sticker-admin-filter="favorites">收藏</button></div><div class="duo-sticker-admin__toolbar"><button type="button" data-sticker-admin-select-all>全选当前结果</button><button type="button" data-sticker-admin-clear-selection disabled>取消选择</button><span class="duo-sticker-admin__selected" data-sticker-admin-selected>已选 0 张</span><button type="button" class="danger" data-sticker-admin-delete disabled>删除已选</button><button type="button" class="danger" data-sticker-admin-clear-all>清空全部上传</button></div><div class="duo-sticker-admin__exports"><button type="button" data-sticker-admin-export-all-json>导出全部 JSON</button><button type="button" data-sticker-admin-export-all-csv>导出全部 CSV</button><button type="button" data-sticker-admin-export-selected-json disabled>导出已选 JSON</button><button type="button" data-sticker-admin-export-selected-csv disabled>导出已选 CSV</button></div><div class="duo-sticker-admin__note">当前项目的管理范围是已上传表情包。旧版内置表情图片资源尚未迁入，因此内置表情隐藏 / 恢复暂不可用。导出清单只包含元数据，不包含图片原文件；图片备份请使用聊天 V4 备份。</div><div class="duo-sticker-admin__grid" data-sticker-admin-grid></div></section>';
    root=container.querySelector('.duo-sticker-admin');
    root.addEventListener('click',onClick);
    root.addEventListener('change',onChange);
    root.addEventListener('input',onInput);
    void render();
  }
  window.__duoStickerAdmin={mount,refresh:render};
})();