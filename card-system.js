/* Unified card library: keeps the legacy chat pool intact and tracks actual use separately. */
(function(){
  'use strict';
  if(window.__duoCardSystemInstalled)return;
  window.__duoCardSystemInstalled=true;
  const KEY='twodeers_card_system_v1';
  const MAX_RECENT=200,MAX_APPLIED_EVENT_IDS=10000;
  const clean=v=>String(v==null?'':v).trim().slice(0,1000);
  const uid=()=>('card_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,9));
  let data={version:1,chatIds:[],chatTexts:[],momentsDynamicIds:[],momentsDynamicTexts:[],momentsReplyIds:[],momentsReplyTexts:[],recentDrawnRepliesV1:[],appliedEventIds:[]};
  try{const saved=JSON.parse(localStorage.getItem(KEY)||'null');if(saved&&typeof saved==='object')data={...data,...saved};}catch(_){}
  if(!Array.isArray(data.chatIds))data.chatIds=[];
  if(!Array.isArray(data.chatTexts))data.chatTexts=[];
  for(const k of ['momentsDynamicIds','momentsDynamicTexts','momentsReplyIds','momentsReplyTexts'])if(!Array.isArray(data[k]))data[k]=[];
  if(!Array.isArray(data.recentDrawnRepliesV1))data.recentDrawnRepliesV1=[];
  if(!Array.isArray(data.appliedEventIds))data.appliedEventIds=[];
  function persist(){localStorage.setItem(KEY,JSON.stringify(data));}
  function reconcile(){
    const pool=Array.isArray(state.cardPhrases)?state.cardPhrases:[];
    const old=(data.chatIds||[]).map((id,i)=>({id,text:clean(data.chatTexts?.[i])}));
    const used=new Set();
    const nextIds=pool.map(value=>{
      const text=clean(value);const index=old.findIndex((item,i)=>!used.has(i)&&item.text===text&&item.id);
      if(index>=0){used.add(index);return old[index].id;}return uid();
    });
    const changed=JSON.stringify(nextIds)!==JSON.stringify(data.chatIds)||JSON.stringify(pool.map(clean))!==JSON.stringify(data.chatTexts);
    data.chatIds=nextIds;data.chatTexts=pool.map(clean);if(changed)persist();
  }
  function getCircle(){try{return window.__duoCircleApi?.exportState?.()||null;}catch(_){return null;}}
  function reconcileNamed(idsKey,textsKey,pool){const old=(data[idsKey]||[]).map((id,i)=>({id,text:clean(data[textsKey]?.[i])})),used=new Set();const next=(pool||[]).map(value=>{const text=clean(value),i=old.findIndex((x,j)=>!used.has(j)&&x.text===text&&x.id);if(i>=0){used.add(i);return old[i].id;}return uid();});const texts=(pool||[]).map(clean);if(JSON.stringify(next)!==JSON.stringify(data[idsKey])||JSON.stringify(texts)!==JSON.stringify(data[textsKey])){data[idsKey]=next;data[textsKey]=texts;persist();}}
  function reconcileAll(){reconcile();const c=getCircle()||{};reconcileNamed('momentsDynamicIds','momentsDynamicTexts',c.dynamicCards||[]);reconcileNamed('momentsReplyIds','momentsReplyTexts',c.replyCards||[]);}
  function setCircle(next){if(!next)return false;const current=getCircle();if(!current)return false;const merged={...current};if(Array.isArray(next.dynamicCards))merged.dynamicCards=next.dynamicCards;if(Array.isArray(next.replyCards))merged.replyCards=next.replyCards;if(typeof next.notificationsEnabled==='boolean')merged.notificationsEnabled=next.notificationsEnabled;const result=window.__duoCircleApi.importState(merged);if(result===false)throw new Error('朋友圈字卡或通知设置保存失败');return result;}
  function recordUsageEvent(event){
    if(!event||typeof event!=='object')return false;
    let previous=null;
    try{
      previous=JSON.parse(JSON.stringify(data));
      const snapshot=clean(event.textSnapshot||event.text);
      if(!snapshot)return false;
      const eventId=clean(event.eventId||event.id)||uid();
      if(data.appliedEventIds.includes(eventId))return true;
      if(data.appliedEventIds.length>=MAX_APPLIED_EVENT_IDS){try{showToast('字卡使用记录去重账本已达安全容量上限；旧事件仍保留待处理，请先导出备份并联系维护者处理');}catch(_){}return false;}
      // Reconciliation may itself persist; keep it inside the same failure boundary.
      reconcileAll();
      const source=clean(event.source||'chat')||'chat';
      const pool=Array.isArray(state.cardPhrases)?state.cardPhrases:[];
      const index=pool.findIndex(v=>clean(v)===snapshot);
      let inferred=index>=0?data.chatIds[index]:null;
      if(source==='moments-dynamic'||source==='moments-reply'){
        const isReply=source==='moments-reply',circle=getCircle()||{},values=isReply?(circle.replyCards||[]):(circle.dynamicCards||[]),ids=isReply?data.momentsReplyIds:data.momentsDynamicIds;
        const at=values.findIndex(v=>clean(v)===snapshot);inferred=at>=0?ids[at]:null;
      }
      const cardId=clean(event.cardId||inferred)||null;
      const now=Math.max(0,Number(event.usedAt)||Date.now());
      const existing=data.recentDrawnRepliesV1.find(x=>x.cardId===cardId&&x.source===source&&x.textSnapshot===snapshot);
      if(existing){existing.lastDrawAt=now;existing.count=(Number(existing.count)||0)+1;for(const key of ['messageId','letterId','postId','sourceId'])if(event[key])existing[key]=clean(event[key]);}
      else data.recentDrawnRepliesV1.unshift({cardId:cardId||uid(),source,textSnapshot:snapshot,lastDrawAt:now,count:1,messageId:clean(event.messageId)||null,letterId:clean(event.letterId)||null,postId:clean(event.postId)||null,sourceId:clean(event.sourceId)||null});
      data.recentDrawnRepliesV1.sort((a,b)=>(b.lastDrawAt||0)-(a.lastDrawAt||0));
      data.recentDrawnRepliesV1=data.recentDrawnRepliesV1.slice(0,MAX_RECENT);
      data.appliedEventIds.push(eventId);
      persist();
      try{renderRecent();}catch(_){}
      return true;
    }catch(error){
      if(previous)data=previous;
      try{showToast('最近实际使用记录暂不可用，事件保留待重试：'+(error.message||error));}catch(_){}
      return false;
    }
  }
  function recordUsed(text,source='chat',id){
    return recordUsageEvent({eventId:uid(),textSnapshot:text,source,cardId:id,usedAt:Date.now()});
  }
  function flushOutbox(){
    let changed=false;
    if(Array.isArray(state.cardUsageOutbox)&&state.cardUsageOutbox.length){
      const before=state.cardUsageOutbox.slice();
      const left=[];
      for(const event of before){if(recordUsageEvent(event))changed=true;else left.push(event);}
      state.cardUsageOutbox=left;
      if(changed&&save()===false)state.cardUsageOutbox=before;
    }
    const mailbox=window.__duoMailbox;
    if(mailbox&&typeof mailbox.flushUsageOutbox==='function')mailbox.flushUsageOutbox();
    const circle=window.__duoCircleApi;
    if(circle&&typeof circle.getUsageOutbox==='function'&&typeof circle.ackUsageOutbox==='function'){
      const events=circle.getUsageOutbox();
      if(events.length){const ack=[];for(const event of events)if(recordUsageEvent(event))ack.push(event.eventId);if(ack.length)circle.ackUsageOutbox(ack);}
    }
  }
  function add(poolName,text){
    const value=clean(text);if(!value)throw new Error('字卡内容不能为空');
    if(poolName==='chat'){
      state.cardPhrases=Array.isArray(state.cardPhrases)?state.cardPhrases:[];
      state.cardPhrases.push(value);reconcile();if(save()===false){state.cardPhrases.pop();reconcile();persist();throw new Error('聊天字卡保存失败');}persist();
      if(typeof renderPhraseList==='function')renderPhraseList();if(typeof renderParamPhraseList==='function')renderParamPhraseList();
    }else{
      const c=getCircle();if(!c)throw new Error('朋友圈数据暂不可用');
      const field=poolName==='moments-reply'?'replyCards':'dynamicCards';
      c[field]=Array.isArray(c[field])?c[field]:[];c[field].push(value);setCircle({[field]:c[field]});reconcileAll();
    }
    render();return value;
  }
  function remove(poolName,index){
    if(poolName==='chat'){
      if(!Array.isArray(state.cardPhrases)||index<0||index>=state.cardPhrases.length)return;
      const removed=state.cardPhrases.splice(index,1)[0];reconcile();if(save()===false){state.cardPhrases.splice(index,0,removed);reconcile();persist();throw new Error('聊天字卡删除未能保存');}persist();
      if(typeof renderPhraseList==='function')renderPhraseList();if(typeof renderParamPhraseList==='function')renderParamPhraseList();
    }else{
      const c=getCircle();if(!c)return;const field=poolName==='moments-reply'?'replyCards':'dynamicCards';
      if(!Array.isArray(c[field])||index<0||index>=c[field].length)return;c[field].splice(index,1);setCircle({[field]:c[field]});reconcileAll();
    }
    render();
  }
  function renderPool(root,poolName,items){
    const host=root.querySelector('[data-card-list="'+poolName+'"]');if(!host)return;
    host.innerHTML=items.length?items.map((v,i)=>'<div class="duo-card-row"><span>'+escapeHtml(v)+'</span><button type="button" data-card-remove="'+poolName+'" data-card-index="'+i+'">删除</button></div>').join(''):'<p class="duo-card-empty">这个字卡池目前为空。</p>';
  }
  function renderRecent(){
    const host=document.querySelector('[data-recent-cards]');if(!host)return;
    const rows=data.recentDrawnRepliesV1;
    host.innerHTML=rows.length?rows.map(x=>'<div class="duo-recent-row"><div>'+escapeHtml(x.textSnapshot)+'</div><small>'+escapeHtml(x.source||'')+' · '+new Date(Number(x.lastDrawAt)||0).toLocaleString()+' · 使用 '+(Number(x.count)||1)+' 次</small></div>').join(''):'<p class="duo-card-empty">暂无记录</p>';
  }
  function render(){
    reconcileAll();
    const root=document.querySelector('#duoUnifiedCardPanel');if(!root)return;
    renderPool(root,'chat',Array.isArray(state.cardPhrases)?state.cardPhrases:[]);
    const c=getCircle()||{};renderPool(root,'moments-dynamic',Array.isArray(c.dynamicCards)?c.dynamicCards:[]);renderPool(root,'moments-reply',Array.isArray(c.replyCards)?c.replyCards:[]);renderRecent();
    for(const key of ['chat','moments-dynamic','moments-reply']){const host=root.querySelector('[data-card-preview="'+key+'"]'),item=pendingDraws.get(key);if(host)host.textContent=item?item.text:'';const use=root.querySelector('[data-card-use="'+key+'"]');if(use)use.disabled=!item;}
  }
  function exportData(){reconcileAll();const c=getCircle()||{};return JSON.parse(JSON.stringify({...data,momentsDynamic:Array.isArray(c.dynamicCards)?c.dynamicCards:[],momentsReply:Array.isArray(c.replyCards)?c.replyCards:[],notificationsEnabled:c.notificationsEnabled!==false}));}
  function importData(incoming){
    if(!incoming||typeof incoming!=='object')throw new Error('字卡系统备份格式无效');
    const next={version:1,chatIds:Array.isArray(incoming.chatIds)?incoming.chatIds.map(String):[],chatTexts:Array.isArray(incoming.chatTexts)?incoming.chatTexts.map(clean):[],momentsDynamicIds:Array.isArray(incoming.momentsDynamicIds)?incoming.momentsDynamicIds.map(String):[],momentsDynamicTexts:Array.isArray(incoming.momentsDynamicTexts)?incoming.momentsDynamicTexts.map(clean):[],momentsReplyIds:Array.isArray(incoming.momentsReplyIds)?incoming.momentsReplyIds.map(String):[],momentsReplyTexts:Array.isArray(incoming.momentsReplyTexts)?incoming.momentsReplyTexts.map(clean):[],recentDrawnRepliesV1:Array.isArray(incoming.recentDrawnRepliesV1)?incoming.recentDrawnRepliesV1.filter(x=>x&&typeof x.textSnapshot==='string').slice(0,MAX_RECENT):[],appliedEventIds:Array.isArray(incoming.appliedEventIds)?incoming.appliedEventIds.map(String):[]};
    data=next;pendingDraws.clear();persist();if(Array.isArray(incoming.momentsDynamic)||Array.isArray(incoming.momentsReply)||typeof incoming.notificationsEnabled==='boolean'){const applied=setCircle({dynamicCards:Array.isArray(incoming.momentsDynamic)?incoming.momentsDynamic:undefined,replyCards:Array.isArray(incoming.momentsReply)?incoming.momentsReply:undefined,notificationsEnabled:incoming.notificationsEnabled});if(applied===false)throw new Error('朋友圈页面未初始化，无法恢复朋友圈字卡与通知设置');}reconcileAll();persist();render();return true;
  }
  function getCardIdAt(source='chat',index){
    reconcileAll();const at=Number(index);if(!Number.isInteger(at)||at<0)return null;
    if(source==='moments-dynamic')return data.momentsDynamicIds[at]||null;
    if(source==='moments-reply')return data.momentsReplyIds[at]||null;
    return data.chatIds[at]||null;
  }
  function getCardId(text,source='chat'){
    reconcileAll();const value=clean(text);
    if(source==='moments-dynamic'||source==='moments-reply'){const c=getCircle()||{},pool=source==='moments-reply'?(c.replyCards||[]):(c.dynamicCards||[]),index=pool.findIndex(x=>clean(x)===value);return index>=0?getCardIdAt(source,index):null;}
    const index=(state.cardPhrases||[]).findIndex(x=>clean(x)===value);return index>=0?getCardIdAt('chat',index):null;
  }
  const pendingDraws=new Map();
  function getPool(poolName){const c=getCircle()||{},values=poolName==='chat'?(state.cardPhrases||[]):poolName==='moments-reply'?(c.replyCards||[]):(c.dynamicCards||[]);return values.map((value,index)=>({text:clean(value),index})).filter(item=>item.text);}
  function draw(poolName){const pool=getPool(poolName);if(!pool.length)return null;const selected=pool[Math.floor(Math.random()*pool.length)],source=poolName;const result={text:selected.text,cardId:getCardIdAt(source,selected.index)};pendingDraws.set(poolName,result);render();return result;}
  function confirmDraw(poolName){const item=pendingDraws.get(poolName);if(!item)return false;if(recordUsed(item.text,poolName,item.cardId)===false)return false;pendingDraws.delete(poolName);render();return true;}
  function pick(poolName,usageSource=poolName){
    const pool=getPool(poolName);if(!pool.length)return '';
    const selected=pool[Math.floor(Math.random()*pool.length)],cardId=getCardIdAt(poolName,selected.index);
    recordUsed(selected.text,usageSource,cardId);return selected.text;
  }
  window.__duoCardSystem={exportData,importData,recordUsed,recordUsageEvent,flushOutbox,getCardId,getCardIdAt,add,remove,pick,draw,confirmDraw,render,getRecent:()=>data.recentDrawnRepliesV1.slice()};
  const style=document.createElement('style');style.textContent='.duo-card-row,.duo-recent-row{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;margin:7px 0;border:1px solid var(--line,#e8e2dc);border-radius:12px;background:var(--panel,#fff)}.duo-card-row span,.duo-recent-row div{flex:1;min-width:0;overflow-wrap:anywhere;line-height:1.55}.duo-card-row button{flex:none;padding:6px 10px;border-radius:8px;background:#f8eeee;color:#a33}.duo-recent-row{display:block}.duo-recent-row small{display:block;margin-top:5px;color:var(--sub,#8a8179);font-size:11px}.duo-card-empty{padding:14px;color:var(--sub,#8a8179);text-align:center;font-size:13px}.duo-card-editor{display:flex;gap:8px;margin:10px 0}.duo-card-editor input{flex:1;min-width:0}.duo-card-editor button{padding:8px 12px;border-radius:9px;background:var(--accent,#8aa05f);color:white}';document.head.appendChild(style);
  document.addEventListener('click',e=>{
    const drawBtn=e.target.closest('[data-card-draw]');if(drawBtn){const result=draw(drawBtn.dataset.cardDraw);if(!result)showToast('这个字卡池目前为空');return;}
    const useBtn=e.target.closest('[data-card-use]');if(useBtn){if(confirmDraw(useBtn.dataset.cardUse))showToast('已记录为实际使用');else showToast('请先随机抽取一条字卡');return;}
    const addBtn=e.target.closest('[data-card-add]');if(addBtn){const key=addBtn.dataset.cardAdd;const input=document.querySelector('[data-card-input="'+key+'"]');try{add(key,input?.value||'');if(input)input.value='';showToast('字卡已添加');}catch(err){showToast(err.message||'添加失败');}return;}
    const del=e.target.closest('[data-card-remove]');if(del){remove(del.dataset.cardRemove,Number(del.dataset.cardIndex));showToast('字卡已删除');}
  });
  reconcileAll();
  if(typeof setTimeout==='function')setTimeout(flushOutbox,0);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)flushOutbox();});
})();
