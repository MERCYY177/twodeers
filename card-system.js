/* Unified card library: legacy chat pool + Circle pools + stable IDs/use history. */
(function(){
  'use strict';
  if(window.__duoCardSystemInstalled)return;
  window.__duoCardSystemInstalled=true;
  const KEY='twodeers_card_system_v1';
  const MAX_RECENT=200,MAX_APPLIED_EVENT_IDS=10000,MAX_PENDING_EVENTS=1000,MAX_IMPORT_ITEMS=20000;
  const POOLS={
    chat:{ids:'chatIds',texts:'chatTexts',field:null,label:'主字卡'},
    'moments-dynamic':{ids:'momentsDynamicIds',texts:'momentsDynamicTexts',field:'dynamicCards',label:'朋友圈动态字卡'},
    'moments-reply':{ids:'momentsReplyIds',texts:'momentsReplyTexts',field:'replyCards',label:'朋友圈回复字卡'}
  };
  // KKK word-bank modules with no live Twodeers counterpart are kept as a
  // separately selectable compatibility archive instead of being misrouted.
  const KKK_LEGACY_KEYS=['kaomojiLibrary','customPokes','customIntros','customEmojis','customReplyGroups','customPokeGroups','kaomojiGroups'];
  const KKK_GROUP_KEYS=new Set(['customReplyGroups','customPokeGroups','kaomojiGroups']);
  const clean=v=>String(v==null?'':v).trim().slice(0,1000);
  const norm=v=>clean(v).toLowerCase().replace(/\s+/g,' ');
  const uid=()=>('card_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,9));
  const clone=value=>JSON.parse(JSON.stringify(value));
  let data={version:1,chatIds:[],chatTexts:[],momentsDynamicIds:[],momentsDynamicTexts:[],momentsReplyIds:[],momentsReplyTexts:[],recentDrawnRepliesV1:[],appliedEventIds:[]};
  try{const saved=JSON.parse(localStorage.getItem(KEY)||'null');if(saved&&typeof saved==='object'&&!Array.isArray(saved)){validateData(saved);data={...data,...saved};}else if(saved!==null)throw new Error('字卡库顶层结构无效');}catch(error){window.__duoRuntimeCoordinator?.reportStorageDamage?.(KEY,error);}
  for(const cfg of Object.values(POOLS)){if(!Array.isArray(data[cfg.ids]))data[cfg.ids]=[];if(!Array.isArray(data[cfg.texts]))data[cfg.texts]=[];}
  if(!Array.isArray(data.recentDrawnRepliesV1))data.recentDrawnRepliesV1=[];
  if(!Array.isArray(data.appliedEventIds))data.appliedEventIds=[];
  if(!data.legacyModules||typeof data.legacyModules!=='object'||Array.isArray(data.legacyModules))data.legacyModules={};
  for(const key of KKK_LEGACY_KEYS)if(!Array.isArray(data.legacyModules[key]))data.legacyModules[key]=[];
  function persist(){const coordinator=window.__duoRuntimeCoordinator,access=coordinator?.getStatus?.();if(!access?.ready||!access?.writable)return false;coordinator?.assertWritable?.('保存字卡');const previous=localStorage.getItem(KEY),serialized=JSON.stringify(data);localStorage.setItem(KEY,serialized);if(coordinator?.markDataChanged?.()===false){const error=new Error('字卡数据已写入，但跨标签页版本标记失败');error.name='RevisionMarkerError';try{if(previous===null)localStorage.removeItem(KEY);else localStorage.setItem(KEY,previous);error.rollbackConfirmed=true;}catch(rollbackError){error.rollbackConfirmed=false;error.message+='；原数据回滚失败：'+(rollbackError.message||rollbackError);}throw error;}return true;}
  function getCircle(){try{return window.__duoCircleApi?.exportState?.()||null;}catch(_){return null;}}
  function readPool(poolName){
    const cfg=POOLS[poolName];if(!cfg)throw new Error('未知字卡模块：'+poolName);
    if(poolName==='chat')return Array.isArray(state.cardPhrases)?state.cardPhrases.slice():[];
    const circle=getCircle();if(!circle)throw new Error('朋友圈数据暂不可用');
    return Array.isArray(circle[cfg.field])?circle[cfg.field].slice():[];
  }
  function ensureIds(poolName,pool){
    const cfg=POOLS[poolName],oldIds=Array.isArray(data[cfg.ids])?data[cfg.ids]:[],oldTexts=Array.isArray(data[cfg.texts])?data[cfg.texts]:[];
    const used=new Set(),nextIds=[];
    (pool||[]).forEach((value,index)=>{
      const text=clean(value);
      // Preserve index-aligned IDs first. This is essential when removing one of two legacy duplicate cards.
      if(index<oldIds.length&&oldIds[index]&&clean(oldTexts[index])===text&&!used.has(oldIds[index])){nextIds.push(String(oldIds[index]));used.add(String(oldIds[index]));return;}
      const found=oldTexts.findIndex((oldText,i)=>!used.has(oldIds[i])&&oldIds[i]&&clean(oldText)===text);
      if(found>=0){nextIds.push(String(oldIds[found]));used.add(String(oldIds[found]));}
      else nextIds.push(uid());
    });
    return nextIds;
  }
  function reconcilePool(poolName,pool){
    const cfg=POOLS[poolName],values=(pool||readPool(poolName)).map(clean),ids=ensureIds(poolName,values);
    const changed=JSON.stringify(ids)!==JSON.stringify(data[cfg.ids])||JSON.stringify(values)!==JSON.stringify(data[cfg.texts]);
    data[cfg.ids]=ids;data[cfg.texts]=values;if(changed)persist();
    return ids;
  }
  function reconcile(){reconcilePool('chat',Array.isArray(state.cardPhrases)?state.cardPhrases:[]);}
  function reconcileNamed(idsKey,textsKey,pool){
    const cfg=Object.values(POOLS).find(x=>x.ids===idsKey&&x.texts===textsKey);if(!cfg)return;
    const poolName=Object.keys(POOLS).find(key=>POOLS[key]===cfg);reconcilePool(poolName,pool||[]);
  }
  function reconcileAll(){reconcile();const circle=getCircle()||{};reconcileNamed('momentsDynamicIds','momentsDynamicTexts',circle.dynamicCards||[]);reconcileNamed('momentsReplyIds','momentsReplyTexts',circle.replyCards||[]);}
  function setCircle(next){if(!next)return false;const current=getCircle();if(!current)throw new Error('朋友圈数据暂不可用');const merged={...current,...next};const result=window.__duoCircleApi.importState(merged);if(result===false)throw new Error('朋友圈字卡保存失败');return result;}
  function renderLegacyChat(){if(typeof renderPhraseList==='function')renderPhraseList();if(typeof renderParamPhraseList==='function')renderParamPhraseList();}
  function renderRecent(){
    const host=document.querySelector('[data-recent-cards]');if(!host)return;
    const rows=data.recentDrawnRepliesV1;
    host.innerHTML=rows.length?rows.map(x=>'<div class="duo-recent-row"><div>'+escapeHtml(x.textSnapshot)+'</div><small>'+escapeHtml(x.source||'')+' · '+new Date(Number(x.lastDrawAt)||0).toLocaleString()+' · 使用 '+(Number(x.count)||1)+' 次</small></div>').join(''):'<p class="duo-card-empty">暂无记录</p>';
  }
  function render(){
    reconcileAll();
    const root=document.querySelector('#duoUnifiedCardPanel');if(!root)return;
    if(window.__duoCardManager?.render){window.__duoCardManager.render();return;}
    for(const key of Object.keys(POOLS))renderPool(root,key,readPool(key));
    renderRecent();
    for(const key of Object.keys(POOLS)){const host=root.querySelector('[data-card-preview="'+key+'"]'),item=pendingDraws.get(key);if(host)host.textContent=item?item.text:'';const use=root.querySelector('[data-card-use="'+key+'"]');if(use)use.disabled=!item;}
  }
  function recordUsageEvent(event){
    if(!window.__duoRuntimeCoordinator?.isWritable?.())return false;
    if(!event||typeof event!=='object')return false;
    let previous=null;
    try{
      previous=clone(data);
      const snapshot=clean(event.textSnapshot||event.text);if(!snapshot)return false;
      const eventId=clean(event.eventId||event.id)||uid();if(data.appliedEventIds.includes(eventId))return true;
      if(data.appliedEventIds.length>=MAX_APPLIED_EVENT_IDS){try{showToast('字卡使用记录去重账本已达安全容量上限；旧事件仍保留待处理，请先导出备份并联系维护者处理');}catch(_){}return false;}
      reconcileAll();
      const source=clean(event.source||'chat')||'chat';
      const poolName=source==='moments-dynamic'?'moments-dynamic':source==='moments-reply'?'moments-reply':'chat';
      const pool=readPool(poolName),cfg=POOLS[poolName],index=pool.findIndex(v=>clean(v)===snapshot);
      const inferred=index>=0?data[cfg.ids][index]:null,cardId=clean(event.cardId||inferred)||null;
      const now=Math.max(0,Number(event.usedAt)||Date.now());
      const existing=data.recentDrawnRepliesV1.find(x=>x.cardId===cardId&&x.source===source&&x.textSnapshot===snapshot);
      if(existing){existing.lastDrawAt=now;existing.count=(Number(existing.count)||0)+1;for(const key of ['messageId','letterId','postId','sourceId'])if(event[key])existing[key]=clean(event[key]);}
      else data.recentDrawnRepliesV1.unshift({cardId:cardId||uid(),source,textSnapshot:snapshot,lastDrawAt:now,count:1,messageId:clean(event.messageId)||null,letterId:clean(event.letterId)||null,postId:clean(event.postId)||null,sourceId:clean(event.sourceId)||null});
      data.recentDrawnRepliesV1.sort((a,b)=>(b.lastDrawAt||0)-(a.lastDrawAt||0));data.recentDrawnRepliesV1=data.recentDrawnRepliesV1.slice(0,MAX_RECENT);data.appliedEventIds.push(eventId);persist();
      try{renderRecent();}catch(_){}return true;
    }catch(error){if(previous)data=previous;try{showToast('最近实际使用记录暂不可用，事件保留待重试：'+(error.message||error));}catch(_){}return false;}
  }
  function recordUsed(text,source='chat',id){return recordUsageEvent({eventId:uid(),textSnapshot:text,source,cardId:id,usedAt:Date.now()});}
  function flushOutbox(){
    if(!window.__duoRuntimeCoordinator?.isWritable?.())return false;
    let changed=false;
    if(Array.isArray(state.cardUsageOutbox)&&state.cardUsageOutbox.length){const before=state.cardUsageOutbox.slice(),left=[];for(const event of before){if(recordUsageEvent(event))changed=true;else left.push(event);}state.cardUsageOutbox=left;if(changed&&save()===false)state.cardUsageOutbox=before;}
    const mailbox=window.__duoMailbox;if(mailbox&&typeof mailbox.flushUsageOutbox==='function')mailbox.flushUsageOutbox();
    const circle=window.__duoCircleApi;if(circle&&typeof circle.getUsageOutbox==='function'&&typeof circle.ackUsageOutbox==='function'){const events=circle.getUsageOutbox();if(events.length){const ack=[];for(const event of events)if(recordUsageEvent(event))ack.push(event.eventId);if(ack.length)circle.ackUsageOutbox(ack);}}
  }
  function activeIds(exceptPool){
    const ids=new Set();for(const key of Object.keys(POOLS)){if(key===exceptPool)continue;const cfg=POOLS[key];(data[cfg.ids]||[]).forEach(id=>{if(id)ids.add(String(id));});}return ids;
  }
  function commitPoolTexts(poolName,nextTexts,nextIds){
    const cfg=POOLS[poolName];if(!cfg)throw new Error('未知字卡模块：'+poolName);
    const cleanTexts=(nextTexts||[]).map(clean);if(cleanTexts.length>MAX_IMPORT_ITEMS)throw new Error('字卡数量超过安全上限');
    const cleanIds=cleanTexts.map((_,i)=>String(nextIds?.[i]||uid()));
    if(new Set(cleanIds).size!==cleanIds.length)throw new Error('字卡 ID 重复，无法保存');
    const oldData=clone(data),oldChat=poolName==='chat'?state.cardPhrases.slice():null,oldCircle=poolName==='chat'?null:getCircle();
    data[cfg.ids]=cleanIds;data[cfg.texts]=cleanTexts;
    try{
      persist();
      if(poolName==='chat'){
        state.cardPhrases=cleanTexts.slice();if(save()===false)throw new Error('聊天字卡保存失败');renderLegacyChat();
      }else{
        const nextCircle={...oldCircle,[cfg.field]:cleanTexts.slice()};
        setCircle(nextCircle);
      }
    }catch(error){
      data=oldData;try{persist();}catch(_){}
      if(poolName==='chat'){state.cardPhrases=oldChat;try{save();}catch(_){}renderLegacyChat();}
      else if(oldCircle){try{setCircle(oldCircle);}catch(rollbackError){throw new Error((error.message||error)+'；朋友圈回滚失败：'+(rollbackError.message||rollbackError));}}
      throw error;
    }
    render();return true;
  }
  function add(poolName,text){
    if(String(text==null?'':text).trim().length>1000)throw new Error('字卡内容超过 1000 字，未添加');
    const value=clean(text);if(!value)throw new Error('字卡内容不能为空');
    const pool=readPool(poolName),cfg=POOLS[poolName],ids=reconcilePool(poolName,pool);
    commitPoolTexts(poolName,[...pool,value],[...ids,uid()]);return value;
  }
  function parseLines(raw){
    const lines=String(raw==null?'':raw).split(/\r\n|\n|\r/),items=[];let emptyLines=0;
    if(lines.length>MAX_IMPORT_ITEMS)throw new Error('单次批量添加不能超过 '+MAX_IMPORT_ITEMS+' 行');
    lines.forEach((line,index)=>{const text=String(line).trim();if(!text){emptyLines++;return;}if(text.length>1000)throw new Error('第 '+(index+1)+' 行超过 1000 字，未添加任何内容');items.push(text);});
    return {items,emptyLines};
  }
  function bulkAdd(poolName,rawText){
    const pool=readPool(poolName),ids=reconcilePool(poolName,pool),existing=new Set(pool.map(norm)),seen=new Set(existing),parsed=parseLines(rawText),added=[];let skipped=0;
    parsed.items.forEach(text=>{const key=norm(text);if(!key||seen.has(key)){skipped++;return;}seen.add(key);added.push(text);});
    if(added.length)commitPoolTexts(poolName,[...pool,...added],[...ids,...added.map(()=>uid())]);
    return {added:added.length,skipped,emptyLines:parsed.emptyLines,total:readPool(poolName).length};
  }
  function removeIds(poolName,wantedIds){
    const wanted=new Set((wantedIds||[]).map(String));if(!wanted.size)return {removed:0,total:readPool(poolName).length};
    const pool=readPool(poolName),cfg=POOLS[poolName],ids=reconcilePool(poolName,pool),keepTexts=[],keepIds=[];let removed=0;
    pool.forEach((text,index)=>{if(wanted.has(String(ids[index]))){removed++;return;}keepTexts.push(clean(text));keepIds.push(ids[index]);});
    if(removed)commitPoolTexts(poolName,keepTexts,keepIds);
    return {removed,total:keepTexts.length};
  }
  function bulkRemove(poolName,cardIds){return removeIds(poolName,cardIds);}
  function remove(poolName,index){const pool=readPool(poolName),ids=reconcilePool(poolName,pool),at=Number(index);if(!Number.isInteger(at)||at<0||at>=pool.length)return false;return removeIds(poolName,[ids[at]]).removed>0;}
  function deduplicate(poolName){
    const pool=readPool(poolName),cfg=POOLS[poolName],ids=reconcilePool(poolName,pool),seen=new Set(),nextTexts=[],nextIds=[];let removed=0;
    pool.forEach((text,index)=>{const key=norm(text);if(!key||seen.has(key)){removed++;return;}seen.add(key);nextTexts.push(clean(text));nextIds.push(ids[index]);});
    if(removed)commitPoolTexts(poolName,nextTexts,nextIds);
    return {removed,total:nextTexts.length};
  }
  function getPoolItems(poolName){const pool=readPool(poolName),cfg=POOLS[poolName],ids=reconcilePool(poolName,pool);return pool.map((text,index)=>({id:ids[index],text:clean(text),index}));}
  function renderPool(root,poolName,items){
    const host=root.querySelector('[data-card-list="'+poolName+'"]');if(!host)return;
    host.innerHTML=items.length?items.map((v,i)=>'<div class="duo-card-row"><span>'+escapeHtml(v)+'</span><button type="button" data-card-remove="'+poolName+'" data-card-index="'+i+'">删除</button></div>').join(''):'<p class="duo-card-empty">这个字卡池目前为空。</p>';
  }
  function exportData(){reconcileAll();const c=getCircle()||{};return clone({...data,momentsDynamic:Array.isArray(c.dynamicCards)?c.dynamicCards:[],momentsReply:Array.isArray(c.replyCards)?c.replyCards:[],notificationsEnabled:c.notificationsEnabled!==false});}
  function exportModules(moduleKeys){
    reconcileAll();const selected=[...new Set((moduleKeys||[]).map(String))],valid=['chat','moments-dynamic','moments-reply','usage',...KKK_LEGACY_KEYS.map(key=>'legacy:'+key)];
    if(!selected.length||selected.some(key=>!valid.includes(key)))throw new Error('请选择有效的字卡导出模块');
    const pools={};for(const key of selected){if(key==='usage'||key.startsWith('legacy:'))continue;pools[key]=getPoolItems(key).map(({id,text})=>({id,text}));}
    const out={type:'twodeers-card-library',version:1,exportedAt:new Date().toISOString(),modules:selected,pools};
    // Also expose the main pool in KKK's native field so these files remain cross-importable.
    if(selected.includes('chat'))out.customReplies=pools.chat.map(item=>item.text);
    const legacySelected=selected.filter(key=>key.startsWith('legacy:'));
    if(legacySelected.length){out.legacyModules={};for(const moduleKey of legacySelected){const field=moduleKey.slice(7),rows=clone(data.legacyModules[field]||[]);out.legacyModules[field]=rows;out[field]=clone(rows);}}
    if(selected.includes('usage')){const c=getCircle()||{},mailbox=window.__duoMailbox;out.usage={recentDrawnRepliesV1:clone(data.recentDrawnRepliesV1),appliedEventIds:clone(data.appliedEventIds),chatUsageOutbox:clone(Array.isArray(state.cardUsageOutbox)?state.cardUsageOutbox:[]),circleUsageOutbox:clone(Array.isArray(c.usageOutbox)?c.usageOutbox:[]),mailboxUsageOutbox:clone(typeof mailbox?.getUsageOutbox==='function'?mailbox.getUsageOutbox():[])};}
    return out;
  }
  function getLegacyModules(){return clone(data.legacyModules||{});}
  function cardPoolName(key){return POOLS[key]?.label||key;}
  function validateIncomingRows(rows,label){
    if(!Array.isArray(rows)||rows.length>MAX_IMPORT_ITEMS)throw new Error((label||'字卡')+'数量超过安全上限');
    const ids=new Set();
    rows.forEach((row,index)=>{
      const isObject=row&&typeof row==='object'&&!Array.isArray(row),value=typeof row==='string'?row:(isObject?row.text:undefined);
      if(typeof value!=='string')throw new Error((label||'字卡')+'第 '+(index+1)+' 条格式无效');
      if(value.trim().length>1000)throw new Error((label||'字卡')+'第 '+(index+1)+' 条超过 1000 字，未导入任何内容');
      if(isObject&&row.id!==undefined&&row.id!==null){if(typeof row.id!=='string')throw new Error((label||'字卡')+'第 '+(index+1)+' 条 ID 格式无效');const id=row.id.trim();if(id&&ids.has(id))throw new Error((label||'字卡')+'包含重复 ID，未导入任何内容');if(id)ids.add(id);}
    });
  }
  function validateLegacyModule(key,rows){
    if(!Array.isArray(rows)||rows.length>MAX_IMPORT_ITEMS)throw new Error('旧版模块 '+key+' 数量超过安全上限');
    if(KKK_GROUP_KEYS.has(key)){
      rows.forEach((row,index)=>{if(!row||typeof row!=='object'||Array.isArray(row)||typeof row.name!=='string')throw new Error('旧版分组 '+key+' 第 '+(index+1)+' 项格式无效');if(row.items!==undefined){if(!Array.isArray(row.items)||row.items.length>MAX_IMPORT_ITEMS)throw new Error('旧版分组 '+key+' 的内容列表格式无效');row.items.forEach((item,itemIndex)=>{if(typeof item!=='string'||item.length>1000)throw new Error('旧版分组 '+key+' 第 '+(index+1)+' 项的第 '+(itemIndex+1)+' 条内容格式无效');});}});
    }else validateIncomingRows(rows,key);
  }
  function legacySource(payload){return payload?.type==='twodeers-card-library'?(payload.legacyModules||{}):(payload.cardSystem||payload.cardData||payload);}
  function mergeLegacyModule(key,current,incoming,mode){
    const source=clone(Array.isArray(incoming)?incoming:[]);if(mode==='replace')return source;
    const existing=clone(Array.isArray(current)?current:[]);
    if(KKK_GROUP_KEYS.has(key)){for(const group of source)if(!existing.some(old=>String(old?.name||'')===String(group?.name||'')))existing.push(group);return existing;}
    const seen=new Set(existing.map(value=>key==='customEmojis'?String(value):norm(value)));
    for(const value of source){const compare=key==='customEmojis'?String(value):norm(value);if(!compare||seen.has(compare))continue;seen.add(compare);existing.push(value);}
    return existing;
  }
  function inspectImport(payload){
    if(Array.isArray(payload)){validateIncomingRows(payload,'主字卡');return {available:['chat'],counts:{chat:payload.length},unsupported:[],legacy:true};}
    if(!payload||typeof payload!=='object')throw new Error('字卡文件格式无效');
    const pools={},unsupported=[];
    if(payload.type==='twodeers-card-library'&&payload.pools&&typeof payload.pools==='object'){
      for(const key of ['chat','moments-dynamic','moments-reply'])if(Array.isArray(payload.pools[key])){if(payload.pools[key].length>MAX_IMPORT_ITEMS)throw new Error(cardPoolName(key)+'数量超过安全上限');validateIncomingRows(payload.pools[key],cardPoolName(key));pools[key]=payload.pools[key].length;}
      if(payload.usage&&typeof payload.usage==='object'&&(Array.isArray(payload.usage.recentDrawnRepliesV1)||Array.isArray(payload.usage.appliedEventIds)||Array.isArray(payload.usage.chatUsageOutbox)||Array.isArray(payload.usage.circleUsageOutbox)||Array.isArray(payload.usage.mailboxUsageOutbox)))pools.usage=Array.isArray(payload.usage.recentDrawnRepliesV1)?payload.usage.recentDrawnRepliesV1.length:0;
    }else{
      const card=payload.cardSystem||payload.cardData||payload;
      if(Array.isArray(card.chatTexts)||Array.isArray(card.chatIds)){const rows=card.chatTexts||[];validateIncomingRows(rows,'主字卡');pools.chat=rows.length;}
      else if(Array.isArray(card.cardPhrases)){validateIncomingRows(card.cardPhrases,'主字卡');pools.chat=card.cardPhrases.length;}
      else if(Array.isArray(card.customReplies)){validateIncomingRows(card.customReplies,'主字卡');pools.chat=card.customReplies.length;}
      if(Array.isArray(card.momentsDynamic)||Array.isArray(card.momentsDynamicTexts)){const rows=card.momentsDynamic||card.momentsDynamicTexts;validateIncomingRows(rows,'朋友圈动态字卡');pools['moments-dynamic']=rows.length;}
      if(Array.isArray(card.momentsReply)||Array.isArray(card.momentsReplyTexts)){const rows=card.momentsReply||card.momentsReplyTexts;validateIncomingRows(rows,'朋友圈回复字卡');pools['moments-reply']=rows.length;}
      if(Array.isArray(card.recentDrawnRepliesV1)||Array.isArray(card.appliedEventIds)||Array.isArray(card.chatUsageOutbox)||Array.isArray(card.circleUsageOutbox)||Array.isArray(card.mailboxUsageOutbox))pools.usage=Array.isArray(card.recentDrawnRepliesV1)?card.recentDrawnRepliesV1.length:0;
    }
    const archive=legacySource(payload);
    for(const key of KKK_LEGACY_KEYS)if(Array.isArray(archive?.[key])){validateLegacyModule(key,archive[key]);pools['legacy:'+key]=archive[key].length;}
    if(payload.type!=='twodeers-card-library')for(const key of ['customStatuses','customMottos','customStatusGroups'])if(archive?.[key]!==undefined)unsupported.push(key);
    return {available:Object.keys(pools),counts:pools,unsupported,legacy:payload.type!=='twodeers-card-library'};
  }
  function incomingRows(payload,poolName){
    if(Array.isArray(payload))return payload.map(text=>({id:'',text:clean(text)})).filter(x=>x.text);
    if(payload.type==='twodeers-card-library')return (payload.pools?.[poolName]||[]).map(item=>typeof item==='string'?{id:'',text:clean(item)}:{id:clean(item?.id),text:clean(item?.text)}).filter(x=>x.text);
    const card=payload.cardSystem||payload.cardData||payload;
    let texts=[],ids=[];
    if(poolName==='chat'){
      if(Array.isArray(card.chatTexts)){texts=card.chatTexts;ids=card.chatIds||[];}
      else if(Array.isArray(card.cardPhrases))texts=card.cardPhrases;
      else if(Array.isArray(card.customReplies))texts=card.customReplies;
    }else if(poolName==='moments-dynamic'){texts=card.momentsDynamic||card.momentsDynamicTexts||[];ids=card.momentsDynamicIds||[];}
    else if(poolName==='moments-reply'){texts=card.momentsReply||card.momentsReplyTexts||[];ids=card.momentsReplyIds||[];}
    return (Array.isArray(texts)?texts:[]).map((text,index)=>({id:clean(ids[index]),text:clean(text)})).filter(x=>x.text);
  }
  function mergeUsage(current,incoming,mode,idMap){
    const rows=Array.isArray(incoming?.recentDrawnRepliesV1)?incoming.recentDrawnRepliesV1:[];
    if(rows.length>MAX_RECENT)throw new Error('最近抽取记录超过 '+MAX_RECENT+' 条安全上限');
    for(const [key,label] of [['chatUsageOutbox','聊天使用队列'],['circleUsageOutbox','朋友圈使用队列'],['mailboxUsageOutbox','信箱使用队列']])if(Array.isArray(incoming?.[key])&&incoming[key].length>MAX_PENDING_EVENTS)throw new Error(label+'超过 '+MAX_PENDING_EVENTS+' 条安全容量');
    const normalized=rows.filter(x=>x&&typeof x.textSnapshot==='string').slice(0,MAX_RECENT).map(x=>{const source=String(x.source||'chat'),poolName=source==='moments-dynamic'?'moments-dynamic':source==='moments-reply'?'moments-reply':'chat',cardId=x.cardId||null;return {...x,cardId:cardId?(idMap.get(poolName+'\u0000'+String(cardId))||cardId):null,textSnapshot:clean(x.textSnapshot),count:Math.max(1,Number(x.count)||1),lastDrawAt:Math.max(0,Number(x.lastDrawAt)||Date.now())};});
    const recent=mode==='replace'?normalized:clone(current.recentDrawnRepliesV1||[]);
    if(mode!=='replace')for(const row of normalized){const old=recent.find(x=>x.cardId===row.cardId&&x.source===row.source&&x.textSnapshot===row.textSnapshot);if(old){old.count=Math.max(Number(old.count)||1,row.count);old.lastDrawAt=Math.max(Number(old.lastDrawAt)||0,row.lastDrawAt);}else recent.push(row);}
    recent.sort((a,b)=>(b.lastDrawAt||0)-(a.lastDrawAt||0));
    const eventIds=Array.isArray(incoming?.appliedEventIds)?incoming.appliedEventIds.map(String):[];
    const applied=mode==='replace'?[...new Set(eventIds)].slice(-MAX_APPLIED_EVENT_IDS):[...new Set([...(current.appliedEventIds||[]),...eventIds])].slice(-MAX_APPLIED_EVENT_IDS);
    const chatOut=Array.isArray(incoming?.chatUsageOutbox)?incoming.chatUsageOutbox:[];
    const nextChatOut=mode==='replace'?clone(chatOut):[...(Array.isArray(state.cardUsageOutbox)?state.cardUsageOutbox:[]),...chatOut.filter(x=>!state.cardUsageOutbox?.some(old=>old.eventId===x.eventId))];
    const circleOut=Array.isArray(incoming?.circleUsageOutbox)?incoming.circleUsageOutbox:[];
    const currentCircle=getCircle()||{};
    const existingCircleOut=Array.isArray(currentCircle.usageOutbox)?currentCircle.usageOutbox:[];
    const nextCircleOut=mode==='replace'?clone(circleOut):[...clone(existingCircleOut),...circleOut.filter(x=>!existingCircleOut.some(old=>old.eventId===x.eventId))];
    const mailbox=window.__duoMailbox,existingMailboxOut=typeof mailbox?.getUsageOutbox==='function'?mailbox.getUsageOutbox():[];
    const mailboxOut=Array.isArray(incoming?.mailboxUsageOutbox)?incoming.mailboxUsageOutbox:[];
    const nextMailboxOut=mode==='replace'?clone(mailboxOut):[...clone(existingMailboxOut),...mailboxOut.filter(x=>!existingMailboxOut.some(old=>old.eventId===x.eventId))];
    return {recentDrawnRepliesV1:recent.slice(0,MAX_RECENT),appliedEventIds:applied,chatUsageOutbox:nextChatOut,circleUsageOutbox:nextCircleOut,mailboxUsageOutbox:nextMailboxOut};
  }
  function importModules(payload,options={}){
    const info=inspectImport(payload),selected=[...new Set((options.selectedModules||info.available).map(String))],mode=options.mode==='replace'?'replace':'append';
    if(!selected.length)throw new Error('请至少选择一个字卡模块');
    for(const key of selected)if(!info.available.includes(key))throw new Error('导入文件不包含所选模块：'+key);
    reconcileAll();
    const oldData=clone(data),oldChat=Array.isArray(state.cardPhrases)?state.cardPhrases.slice():[],oldChatOutbox=clone(Array.isArray(state.cardUsageOutbox)?state.cardUsageOutbox:[]),oldCircle=getCircle(),mailbox=window.__duoMailbox,oldMailboxOutbox=typeof mailbox?.getUsageOutbox==='function'?mailbox.getUsageOutbox():[];
    if(selected.some(key=>key==='moments-dynamic'||key==='moments-reply')&&!oldCircle)throw new Error('朋友圈数据暂不可用，无法导入朋友圈字卡');
    if(selected.includes('usage')&&Array.isArray((payload.type==='twodeers-card-library'?payload.usage:(payload.cardSystem||payload.cardData||payload))?.mailboxUsageOutbox)&&!mailbox?.setUsageOutbox)throw new Error('信箱使用队列接口尚未就绪，已停止导入以免丢失待同步记录');
    const nextPools={},addedCounts={},idMap=new Map(),usedIds=activeIds(),legacyKeys=selected.filter(key=>key.startsWith('legacy:'));
    for(const key of selected){if(key==='usage'||key.startsWith('legacy:'))continue;const cfg=POOLS[key];if(!cfg)throw new Error('不支持的字卡模块：'+key);const existing=readPool(key),existingIds=reconcilePool(key,existing),incoming=incomingRows(payload,key);let texts=mode==='replace'?[]:existing.slice(),ids=mode==='replace'?[]:existingIds.slice();const keyForText=value=>(mode==='replace'&&key==='chat'?clean(value):norm(value)),indexByNorm=new Map();texts.forEach((text,index)=>{const k=keyForText(text);if(!indexByNorm.has(k))indexByNorm.set(k,index);});
      const beforeCount=texts.length;
      incoming.slice(0,MAX_IMPORT_ITEMS).forEach(row=>{const value=clean(row.text),k=keyForText(value);if(!k)return;if(indexByNorm.has(k)){const at=indexByNorm.get(k);if(row.id)idMap.set(key+'\u0000'+row.id,ids[at]);return;}let id=row.id||uid();if(usedIds.has(id)||ids.includes(id))id=uid();usedIds.add(id);if(row.id)idMap.set(key+'\u0000'+row.id,id);indexByNorm.set(k,texts.length);texts.push(value);ids.push(id);});nextPools[key]={texts,ids};addedCounts[key]=mode==='replace'?texts.length:texts.length-beforeCount;
    }
    const nextData=clone(data),nextCircle=oldCircle?clone(oldCircle):null;
    nextData.legacyModules=clone(nextData.legacyModules||{});
    const archive=legacySource(payload);
    for(const moduleKey of legacyKeys){const field=moduleKey.slice(7),incoming=archive?.[field];validateLegacyModule(field,incoming);const current=nextData.legacyModules[field]||[],merged=mergeLegacyModule(field,current,incoming,mode);addedCounts[moduleKey]=mode==='replace'?merged.length:Math.max(0,merged.length-current.length);nextData.legacyModules[field]=merged;}
    for(const [key,value] of Object.entries(nextPools)){const cfg=POOLS[key];nextData[cfg.ids]=value.ids.slice();nextData[cfg.texts]=value.texts.slice();if(cfg.field)nextCircle[cfg.field]=value.texts.slice();}
    let nextChatOut=Array.isArray(state.cardUsageOutbox)?state.cardUsageOutbox.slice():[],nextMailboxOut=oldMailboxOutbox.slice();
    if(selected.includes('usage')){const usage=mergeUsage(data,payload.type==='twodeers-card-library'?payload.usage:(payload.cardSystem||payload.cardData||payload),mode,idMap);nextData.recentDrawnRepliesV1=usage.recentDrawnRepliesV1;nextData.appliedEventIds=usage.appliedEventIds;nextChatOut=usage.chatUsageOutbox;nextMailboxOut=usage.mailboxUsageOutbox;if(nextCircle)nextCircle.usageOutbox=usage.circleUsageOutbox;}
    try{
      data=nextData;persist();
      if(selected.includes('chat')){state.cardPhrases=nextPools.chat.texts.slice();if(save()===false)throw new Error('聊天字卡写入失败');}
      if(nextCircle&&selected.some(key=>key==='moments-dynamic'||key==='moments-reply'||key==='usage'))setCircle(nextCircle);
      if(selected.includes('usage')){state.cardUsageOutbox=nextChatOut;if(save()===false)throw new Error('聊天字卡使用队列写入失败');if(typeof mailbox?.setUsageOutbox==='function')mailbox.setUsageOutbox(nextMailboxOut,'replace');}
    }catch(error){
      data=oldData;try{persist();}catch(_){}state.cardPhrases=oldChat;state.cardUsageOutbox=oldChatOutbox;try{save();}catch(_){}if(typeof mailbox?.setUsageOutbox==='function'&&selected.includes('usage')){try{mailbox.setUsageOutbox(oldMailboxOutbox,'replace');}catch(rollbackError){throw new Error((error.message||error)+'；信箱使用队列回滚失败：'+(rollbackError.message||rollbackError));}}if(oldCircle&&selected.some(key=>key==='moments-dynamic'||key==='moments-reply'||key==='usage')){try{setCircle(oldCircle);}catch(rollbackError){throw new Error((error.message||error)+'；朋友圈回滚失败：'+(rollbackError.message||rollbackError));}}throw error;
    }
    pendingDraws.clear();renderLegacyChat();render();
    return {mode,selected,added:addedCounts};
  }
  function validateData(incoming){
    if(!incoming||typeof incoming!=='object'||Array.isArray(incoming))throw new Error('字卡恢复快照格式无效');
    inspectImport(incoming);
    for(const [poolName,cfg] of Object.entries(POOLS)){
      const hasIds=Object.prototype.hasOwnProperty.call(incoming,cfg.ids),hasTexts=Object.prototype.hasOwnProperty.call(incoming,cfg.texts);
      if(!hasIds&&!hasTexts)continue;
      if(!hasIds||!hasTexts||!Array.isArray(incoming[cfg.ids])||!Array.isArray(incoming[cfg.texts]))throw new Error(cardPoolName(poolName)+'恢复快照缺少 ID/文本数组');
      const ids=incoming[cfg.ids],texts=incoming[cfg.texts];
      if(ids.length>MAX_IMPORT_ITEMS||texts.length>MAX_IMPORT_ITEMS||ids.length!==texts.length)throw new Error(cardPoolName(poolName)+'恢复快照数量不一致或超过上限');
      const seen=new Set();
      for(const id of ids){if(typeof id!=='string'||!id||id.length>128||seen.has(id))throw new Error(cardPoolName(poolName)+'恢复快照包含无效或重复 ID');seen.add(id);}
      validateIncomingRows(texts,cardPoolName(poolName));
    }
    for(const [key,limit] of [['recentDrawnRepliesV1',MAX_RECENT],['appliedEventIds',MAX_APPLIED_EVENT_IDS],['cardUsageOutbox',MAX_PENDING_EVENTS],['chatUsageOutbox',MAX_PENDING_EVENTS],['circleUsageOutbox',MAX_PENDING_EVENTS],['mailboxUsageOutbox',MAX_PENDING_EVENTS]]){
      if(incoming[key]!==undefined&&(!Array.isArray(incoming[key])||incoming[key].length>limit))throw new Error('字卡恢复快照字段无效：'+key);
    }
    if(incoming.legacyModules!==undefined){
      if(!incoming.legacyModules||typeof incoming.legacyModules!=='object'||Array.isArray(incoming.legacyModules))throw new Error('旧版字卡兼容归档格式无效');
      for(const key of KKK_LEGACY_KEYS){if(incoming.legacyModules[key]!==undefined){if(!Array.isArray(incoming.legacyModules[key]))throw new Error('旧版字卡归档字段无效：'+key);validateLegacyModule(key,incoming.legacyModules[key]);}}
    }
    return true;
  }

  function importData(incoming){
    if(!incoming||typeof incoming!=='object'||Array.isArray(incoming))throw new Error('字卡系统备份格式无效');
    const oldData=clone(data),oldChat=Array.isArray(state.cardPhrases)?state.cardPhrases.slice():[],oldCircle=getCircle();
    const next={...clone(data),version:1};
    if(incoming.legacyModules!==undefined){if(!incoming.legacyModules||typeof incoming.legacyModules!=='object'||Array.isArray(incoming.legacyModules))throw new Error('旧版字卡兼容归档格式无效');for(const key of KKK_LEGACY_KEYS){const rows=incoming.legacyModules[key];if(rows!==undefined){validateLegacyModule(key,rows);next.legacyModules[key]=clone(rows);}}}
    for(const [poolName,cfg] of Object.entries(POOLS)){
      if(Array.isArray(incoming[cfg.ids])){if(incoming[cfg.ids].length>MAX_IMPORT_ITEMS)throw new Error(cardPoolName(poolName)+' ID 数量超过安全上限');next[cfg.ids]=incoming[cfg.ids].map(String);}
      if(Array.isArray(incoming[cfg.texts])){validateIncomingRows(incoming[cfg.texts],cardPoolName(poolName));next[cfg.texts]=incoming[cfg.texts].map(clean);}
    }
    if(Array.isArray(incoming.recentDrawnRepliesV1))next.recentDrawnRepliesV1=incoming.recentDrawnRepliesV1.filter(x=>x&&typeof x.textSnapshot==='string').slice(0,MAX_RECENT);
    if(Array.isArray(incoming.appliedEventIds))next.appliedEventIds=[...new Set(incoming.appliedEventIds.map(String))].slice(-MAX_APPLIED_EVENT_IDS);
    let circleChanged=false;
    try{
      data=next;persist();
      if(Array.isArray(incoming.chatTexts)){
        state.cardPhrases=incoming.chatTexts.map(clean);
        if(save()===false)throw new Error('聊天字卡恢复失败');
      }
      if(Array.isArray(incoming.momentsDynamic)||Array.isArray(incoming.momentsReply)||typeof incoming.notificationsEnabled==='boolean'){
        const circle=getCircle();if(!circle)throw new Error('朋友圈页面未初始化，无法恢复朋友圈字卡');
        const nextCircle={...circle,...(Array.isArray(incoming.momentsDynamic)?{dynamicCards:incoming.momentsDynamic.map(clean)}:{}),...(Array.isArray(incoming.momentsReply)?{replyCards:incoming.momentsReply.map(clean)}:{}),...(typeof incoming.notificationsEnabled==='boolean'?{notificationsEnabled:incoming.notificationsEnabled}:{})};
        // Mark before invoking the bridge: implementations may mutate state and then throw.
        circleChanged=true;setCircle(nextCircle);
      }
      reconcileAll();persist();renderLegacyChat();render();pendingDraws.clear();return true;
    }catch(error){
      data=oldData;try{persist();}catch(_){}
      state.cardPhrases=oldChat;try{save();}catch(_){}
      if(circleChanged&&oldCircle){try{setCircle(oldCircle);}catch(rollbackError){throw new Error((error.message||error)+'；朋友圈回滚失败：'+(rollbackError.message||rollbackError));}}
      throw error;
    }
  }

  function getCardIdAt(source='chat',index){reconcileAll();const at=Number(index);if(!Number.isInteger(at)||at<0)return null;return data[POOLS[source]?.ids||POOLS.chat.ids][at]||null;}
  function getCardId(text,source='chat'){const key=POOLS[source]?source:'chat';reconcileAll();const pool=readPool(key),index=pool.findIndex(x=>clean(x)===clean(text));return index>=0?data[POOLS[key].ids][index]||null:null;}
  const pendingDraws=new Map();
  function getPool(poolName){return readPool(poolName).map((value,index)=>({text:clean(value),index})).filter(item=>item.text);}
  function draw(poolName){const pool=getPool(poolName);if(!pool.length)return null;const selected=pool[Math.floor(Math.random()*pool.length)],result={text:selected.text,cardId:getCardIdAt(poolName,selected.index)};pendingDraws.set(poolName,result);render();return result;}
  function confirmDraw(poolName){const item=pendingDraws.get(poolName);if(!item)return false;if(recordUsed(item.text,poolName,item.cardId)===false)return false;pendingDraws.delete(poolName);render();return true;}
  function pick(poolName,usageSource=poolName){const pool=getPool(poolName);if(!pool.length)return '';const selected=pool[Math.floor(Math.random()*pool.length)],cardId=getCardIdAt(poolName,selected.index);recordUsed(selected.text,usageSource,cardId);return selected.text;}
  window.__duoCardSystem={reconcile(){reconcileAll();return persist();},exportData,validateData,importData,exportModules,inspectImport,importModules,getLegacyModules,recordUsed,recordUsageEvent,flushOutbox,getCardId,getCardIdAt,getPoolItems,add,bulkAdd,remove,bulkRemove,deduplicate,pick,draw,confirmDraw,render,getRecent:()=>data.recentDrawnRepliesV1.slice()};
  const style=document.createElement('style');style.textContent='.duo-card-row,.duo-recent-row{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;margin:7px 0;border:1px solid var(--line,#e8e2dc);border-radius:12px;background:var(--panel,#fff)}.duo-card-row span,.duo-recent-row div{flex:1;min-width:0;overflow-wrap:anywhere;line-height:1.55}.duo-card-row button{flex:none;padding:6px 10px;border-radius:8px;background:#f8eeee;color:#a33}.duo-recent-row{display:block}.duo-recent-row small{display:block;margin-top:5px;color:var(--sub,#8a8179);font-size:11px}.duo-card-empty{padding:14px;color:var(--sub,#8a8179);text-align:center;font-size:13px}.duo-card-editor{display:flex;gap:8px;margin:10px 0}.duo-card-editor input{flex:1;min-width:0}.duo-card-editor button{padding:8px 12px;border-radius:9px;background:var(--accent,#8aa05f);color:white}';document.head.appendChild(style);
  document.addEventListener('click',e=>{
    const drawBtn=e.target.closest('[data-card-draw]');if(drawBtn){const result=draw(drawBtn.dataset.cardDraw);if(!result)showToast('这个字卡池目前为空');return;}
    const useBtn=e.target.closest('[data-card-use]');if(useBtn){if(confirmDraw(useBtn.dataset.cardUse))showToast('已记录为实际使用');else showToast('请先随机抽取一条字卡');return;}
    const addBtn=e.target.closest('[data-card-add]');if(addBtn){const key=addBtn.dataset.cardAdd;const input=document.querySelector('[data-card-input="'+key+'"]');try{add(key,input?.value||'');if(input)input.value='';showToast('字卡已添加');}catch(err){showToast(err.message||'添加失败');}return;}
    const del=e.target.closest('[data-card-remove]');if(del){remove(del.dataset.cardRemove,Number(del.dataset.cardIndex));showToast('字卡已删除');}
  });
  if(!window.__duoRuntimeCoordinator||window.__duoRuntimeCoordinator.isWritable?.())reconcileAll();
  if(typeof setTimeout==='function')setTimeout(flushOutbox,0);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)flushOutbox();});
})();
