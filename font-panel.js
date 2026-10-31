/* 双人空间字体管理 UI 与 Circle Shadow DOM 字体同步。 */
(function(){
  'use strict';
  function bytes(n){return n>=1048576?(n/1048576).toFixed(1)+' MB':Math.max(1,Math.round(n/1024))+' KB';}
  function refresh(){
    const api=window.ChuanXunFontManager;if(!api)return;
    const host=document.getElementById('circleMount');
    const family=getComputedStyle(document.documentElement).getPropertyValue('--chuanxun-local-font-family').trim();
    if(host&&family)host.style.setProperty('font-family',family,'important');
    const list=document.getElementById('duoFontList');if(!list)return;
    api.listFonts().then(items=>{
      const current=api.getCurrentFontId();
      list.innerHTML=items.length?items.map(x=>'<div class="duo-font-item"><span><b>'+String(x.name).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))+'</b><small>'+String(x.format||'').toUpperCase()+' · '+bytes(x.size||0)+'</small></span><span>'+(x.id===current?'正在使用':'已保存')+'</span></div>').join(''):'<div class="empty-stickers">尚未导入字体。</div>';
    }).catch(e=>{list.textContent='无法读取字体库：'+(e.message||e);});
  }
  function boot(){
    const target=document.getElementById('settingsParam'),api=window.ChuanXunFontManager;
    if(!target||!api||document.getElementById('duoFontPanel'))return;
    const card=document.createElement('section');card.className='panel-card';card.id='duoFontPanel';
    card.innerHTML='<h3>字体管理</h3><p class="data-note">支持 TTF、OTF、WOFF、WOFF2；单个文件最大 50 MB。字体 Blob 保存于独立 IndexedDB，不占用 localStorage。</p><div class="data-actions"><button type="button" class="primary" id="duoFontOpen">导入 / 应用 / 预览字体</button><button type="button" class="mini-btn" id="duoFontDefault">恢复系统默认</button></div><div id="duoFontList" class="duo-font-list">正在读取本地字体库…</div>';
    target.insertBefore(card,target.children[1]||null);
    card.querySelector('#duoFontOpen').addEventListener('click',()=>api.openSettings());
    card.querySelector('#duoFontDefault').addEventListener('click',()=>api.restoreDefault().then(()=>{refresh();if(typeof showToast==='function')showToast('已恢复系统默认字体');}).catch(e=>{if(typeof showToast==='function')showToast(e.message||'字体设置失败');}));
    const style=document.createElement('style');style.textContent='.duo-font-list{display:grid;gap:7px;margin-top:12px}.duo-font-item{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 12px;border:1px solid var(--line);border-radius:11px;color:var(--text);font-size:12px}.duo-font-item span:first-child{min-width:0}.duo-font-item small{display:block;color:var(--sub);margin-top:3px}';document.head.appendChild(style);
    window.addEventListener('chuanxunfontchange',refresh);
    refresh();
    api.restoreCurrent().then(refresh).catch(e=>console.warn('[双人空间] 字体恢复失败，继续使用系统默认字体',e));
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();