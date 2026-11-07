/* Independent mailbox with durable drafts, scheduled arrivals/replies and backup API. */
(function(){
  'use strict';
  if(window.__duoMailboxInstalled)return;
  window.__duoMailboxInstalled=true;
  const KEY='twodeers_mailbox_letters_v1',DRAFT_KEY='twodeers_mailbox_drafts_v1';
  const defaults={version:1,items:[],pending:[],usageOutbox:[],nextIncomingAt:0,settings:{autoIncoming:true,autoReply:true,minIncomingMin:720,maxIncomingMin:2160,minReplyMin:2,maxReplyMin:15,cardCountMin:2,cardCountMax:4}};
  let box=defaults,drafts=[],activeDraftId=null,activeReplyToId=null,composeCardFragments=[],activeComposeImages=[],tasksPaused=false,composeGeneration=0,readGeneration=0,addingComposeImages=false;
  const imageUrls=new Map(),MAX_IMAGES=6,MAX_IMAGE_BYTES=8*1024*1024,MAX_TOTAL_IMAGE_BYTES=24*1024*1024,MAX_PENDING_USAGE_EVENTS=1000;
  const clone=value=>JSON.parse(JSON.stringify(value));
  const $=s=>document.querySelector(s),uid=()=>('letter_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8));
  const clean=s=>String(s||'').trim().slice(0,12000);
  function normalize(raw){const x={...defaults,...(raw&&typeof raw==='object'?raw:{})};x.items=Array.isArray(x.items)?x.items.filter(v=>v&&typeof v==='object').slice(-5000).map(v=>({...v,id:clean(v.id).slice(0,128)||uid(),type:v.type==='outgoing'?'outgoing':'incoming',title:clean(v.title).slice(0,120),content:clean(v.content),createdAt:Math.max(0,Number(v.createdAt)||Date.now()),read:!!v.read,cardFragments:Array.isArray(v.cardFragments)?v.cardFragments.filter(f=>f&&typeof f.textSnapshot==='string').slice(0,100):[],images:normalizeImages(v.images)})):[];x.usageOutbox=Array.isArray(x.usageOutbox)?x.usageOutbox.filter(v=>v&&typeof v.textSnapshot==='string'):[];x.pending=Array.isArray(x.pending)?x.pending.filter(v=>v&&v.type==='reply'&&typeof v.sourceId==='string').slice(0,1000).map(v=>({...v,id:clean(v.id).slice(0,128)||uid(),due:Math.max(0,Number(v.due)||0)})):[];x.settings={...defaults.settings,...(x.settings||{})};for(const k of ['minIncomingMin','maxIncomingMin','minReplyMin','maxReplyMin'])x.settings[k]=Math.max(1,Math.min(10080,Number(x.settings[k])||defaults.settings[k]));const cardMin=Number(x.settings.cardCountMin),cardMax=Number(x.settings.cardCountMax);x.settings.cardCountMin=Number.isInteger(cardMin)&&cardMin>=1&&cardMin<=10?cardMin:defaults.settings.cardCountMin;x.settings.cardCountMax=Number.isInteger(cardMax)&&cardMax>=1&&cardMax<=10?cardMax:defaults.settings.cardCountMax;if(x.settings.cardCountMin>x.settings.cardCountMax)x.settings.cardCountMax=x.settings.cardCountMin;if(x.settings.maxIncomingMin<x.settings.minIncomingMin)x.settings.maxIncomingMin=x.settings.minIncomingMin;if(x.settings.maxReplyMin<x.settings.minReplyMin)x.settings.maxReplyMin=x.settings.minReplyMin;x.nextIncomingAt=Math.max(0,Number(x.nextIncomingAt)||0);return x;}
  try{box=normalize(JSON.parse(localStorage.getItem(KEY)||'null'));}catch(_){box=normalize(null);}try{const d=JSON.parse(localStorage.getItem(DRAFT_KEY)||'[]');drafts=Array.isArray(d)?d.filter(x=>x&&typeof x==='object').map(x=>({...x,images:normalizeImages(x.images)})):[];}catch(_){drafts=[];}
  function normalizeImages(images){return Array.isArray(images)?images.filter(x=>x&&typeof x.id==='string').slice(0,MAX_IMAGES).map((x,i)=>({id:x.id,name:clean(x.name).slice(0,180)||'图片 '+(i+1),mimeType:clean(x.mimeType).slice(0,100)||'image/jpeg',size:Math.max(0,Number(x.size)||0),order:Number.isFinite(Number(x.order))?Number(x.order):i})):[];}
  async function compressMailJpeg(file){
    if(!file||file.type!=='image/jpeg'||file.size<512*1024||typeof createImageBitmap!=='function')return file;
    let bitmap=null,canvas=null;
    try{
      bitmap=await createImageBitmap(file);
      const longest=Math.max(bitmap.width||0,bitmap.height||0);if(!longest)return file;
      const scale=Math.min(1,2400/longest),width=Math.max(1,Math.round(bitmap.width*scale)),height=Math.max(1,Math.round(bitmap.height*scale));
      if(scale===1&&file.size<900*1024)return file;
      canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
      const context=canvas.getContext('2d',{alpha:false});if(!context)return file;
      context.drawImage(bitmap,0,0,width,height);
      const compressed=await new Promise(resolve=>canvas.toBlob(blob=>resolve(blob||null),'image/jpeg',0.84));
      return compressed&&compressed.size>0&&compressed.size<file.size?compressed:file;
    }catch(_){return file;}
    finally{try{bitmap?.close?.();}catch(_){}if(canvas){canvas.width=1;canvas.height=1;}}
  }
  function persist(){localStorage.setItem(KEY,JSON.stringify(box));}
  function persistDrafts(){localStorage.setItem(DRAFT_KEY,JSON.stringify(drafts));}
  function restoreStorageKey(key,value){if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value);}
  function commitBoth(){const oldBox=localStorage.getItem(KEY),oldDrafts=localStorage.getItem(DRAFT_KEY);try{persist();persistDrafts();}catch(error){try{restoreStorageKey(KEY,oldBox);restoreStorageKey(DRAFT_KEY,oldDrafts);}catch(_){}throw error;}}
  function esc(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function scheduleIncoming(shouldPersist=true){if(!box.settings.autoIncoming){box.nextIncomingAt=0;if(shouldPersist)persist();return;}if(!box.nextIncomingAt||box.nextIncomingAt<Date.now())box.nextIncomingAt=Date.now()+random(box.settings.minIncomingMin,box.settings.maxIncomingMin)*60000;if(shouldPersist)persist();}
  function chooseChatCards(){
    const pool=(state.cardPhrases||[]).map((text,index)=>({text:clean(text),index})).filter(x=>x.text);
    if(!pool.length)return [];
    for(let i=pool.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}
    const count=Math.min(random(box.settings.cardCountMin,box.settings.cardCountMax),pool.length);
    return pool.slice(0,count).map(item=>({text:item.text,cardId:window.__duoCardSystem?.getCardIdAt?.('chat',item.index)||window.__duoCardSystem?.getCardId?.(item.text,'chat')||null}));
  }
  function fragmentsForCards(cards){return cards.map(card=>({cardId:card.cardId,textSnapshot:card.text}));}
  function contentForCards(cards,fallback){return cards.length?cards.map(card=>card.text).join(String.fromCharCode(10)):fallback;}
  function random(a,b){a=Math.max(1,Number(a)||1);b=Math.max(a,Number(b)||a);return Math.floor(Math.random()*(b-a+1))+a;}
  function makeLetter(type,title,content,extra={}){return {id:uid(),type,title:clean(title)|| (type==='incoming'?'一封来信':'寄出的信'),content:clean(content),createdAt:Date.now(),read:type!=='incoming',originalContent:clean(content),replyToId:extra.replyToId||null,cardFragments:Array.isArray(extra.cardFragments)?extra.cardFragments:[],images:normalizeImages(extra.images)};}
  function render(){const list=$('#mailLetterList');if(!list)return;const rows=box.items.slice().sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));list.innerHTML=rows.length?rows.map(x=>'<button type="button" class="mail-letter-row" data-mail-open="'+esc(x.id)+'"><span class="mail-letter-type">'+(x.type==='incoming'?'收到':'已寄出')+'</span><strong>'+esc(x.title)+'</strong><small>'+new Date(x.createdAt||0).toLocaleString()+(x.read?'':' · 未读')+' · '+normalizeImages(x.images).length+' 张图片</small><span>'+esc(x.content.slice(0,90))+'</span></button>').join(''):'<div class="mail-empty">信箱还是空的。你可以写一封信，或开启自动来信。</div>';const unread=box.items.filter(x=>x.type==='incoming'&&!x.read).length;const count=$('#mailUnreadCount');if(count)count.textContent=unread?'未读 '+unread+' 封':'暂无未读';const settings=$('#mailAutoStatus');if(settings)settings.textContent=box.settings.autoIncoming?(box.nextIncomingAt?'下一封预计：'+new Date(box.nextIncomingAt).toLocaleString():'自动来信已开启'):'自动来信已关闭';const draftHost=$('#mailDraftList');if(draftHost)draftHost.innerHTML=drafts.length?drafts.map(d=>'<div class="mail-draft-row"><button type="button" data-mail-draft="'+esc(d.id)+'"><strong>'+esc(d.title||'未命名草稿')+'</strong><small>'+new Date(d.updatedAt||0).toLocaleString()+'</small></button><button type="button" data-mail-draft-delete="'+esc(d.id)+'">删除</button></div>').join(''):'<div class="mail-empty">暂无草稿。</div>'; }
  function revokeImageUrl(id){const url=imageUrls.get(id);if(url){try{URL.revokeObjectURL(url);}catch(_){}imageUrls.delete(id);}}
  function getImageUrl(id){return imageUrls.get(id)||'';}
  function revokeUrlsNotVisible(){
    const visible=new Set();
    const compose=$('#mailComposeModal');if(typeof compose?.classList?.contains==='function'&&compose.classList.contains('show'))for(const item of normalizeImages(activeComposeImages))visible.add(item.id);
    const read=$('#mailReadModal');if(typeof read?.classList?.contains==='function'&&read.classList.contains('show')){const item=box.items.find(x=>x.id===read.dataset.letterId);for(const image of normalizeImages(item?.images))visible.add(image.id);}
    for(const id of [...imageUrls.keys()])if(!visible.has(id))revokeImageUrl(id);
  }
  async function renderComposeImages(generation=composeGeneration,draftId=activeDraftId){
    const host=$('#mailComposeImagesPreview');if(!host)return;
    const items=normalizeImages(activeComposeImages);const html=[];
    for(const item of items){
      let url=getImageUrl(item.id);
      if(!url){try{const rec=await getMediaRecord(item.id);if(generation!==composeGeneration||draftId!==activeDraftId)return;if(rec?.blob){url=URL.createObjectURL(rec.blob);imageUrls.set(item.id,url);}}catch(_){}}
      if(generation!==composeGeneration||draftId!==activeDraftId)return;
      html.push('<div class="mail-image-thumb">'+(url?'<img src="'+url+'" alt="'+esc(item.name)+'">':'<span>附件缺失</span>')+'<button type="button" data-mail-image-remove="'+esc(item.id)+'" aria-label="移除图片">×</button></div>');
    }
    if(generation!==composeGeneration||draftId!==activeDraftId)return;
    host.innerHTML=html.join('');
    const hint=$('#mailImageHint');if(hint)hint.textContent=items.length+' / '+MAX_IMAGES+' 张图片 · 单张不超过 8 MB';
  }
  async function openCompose(draft){
    const title=$('#mailComposeTitle'),content=$('#mailComposeContent');if(!title||!content)return;
    const generation=++composeGeneration;
    activeDraftId=draft?.id||null;activeReplyToId=draft?.replyToId||null;composeCardFragments=Array.isArray(draft?.cardFragments)?draft.cardFragments.slice():[];activeComposeImages=normalizeImages(draft?.images);
    title.value=draft?.title||'';content.value=draft?.content||'';const preview=$('#mailComposeImagesPreview');if(preview)preview.innerHTML='';$('#mailComposeModal')?.classList.add('show');revokeUrlsNotVisible();
    await renderComposeImages(generation,activeDraftId);
    if(generation===composeGeneration)content.focus();
  }
  function reconcileComposeCardFragments(){
    const body=String($('#mailComposeContent')?.value||''),claimed=[],kept=[];
    for(const fragment of composeCardFragments){
      const phrase=clean(fragment?.textSnapshot);if(!phrase)continue;let from=0,found=-1;
      while((found=body.indexOf(phrase,from))>=0){const end=found+phrase.length;if(!claimed.some(range=>found<range[1]&&end>range[0])){claimed.push([found,end]);kept.push({...fragment,textSnapshot:phrase});break;}from=found+1;}
    }
    composeCardFragments=kept;
  }
  function insertCard(){const pool=(state.cardPhrases||[]).map((text,index)=>({text:clean(text),index})).filter(x=>x.text);if(!pool.length){showToast('聊天字卡池为空');return;}const selected=pool[Math.floor(Math.random()*pool.length)],text=selected.text;const input=$('#mailComposeContent');if(!input)return;input.value=(input.value?'\n':'')+text;composeCardFragments.push({cardId:window.__duoCardSystem?.getCardIdAt?.('chat',selected.index)||window.__duoCardSystem?.getCardId?.(text,'chat')||null,textSnapshot:text});saveDraft();}
  async function addImages(files){
    const selected=[...(files||[])].filter(Boolean);if(!selected.length)return;
    if(addingComposeImages){showToast('图片正在处理，请稍后再添加');return;}
    const generation=composeGeneration,draftId=activeDraftId,baseImages=activeComposeImages.slice();
    if(baseImages.length+selected.length>MAX_IMAGES){showToast('一封信最多添加 '+MAX_IMAGES+' 张图片');return;}
    addingComposeImages=true;
    const currentBytes=baseImages.reduce((n,x)=>n+(Number(x.size)||0),0);let added=[];
    try{
      for(const file of selected){
        if(!/^image\/(jpeg|png|webp|gif|avif)$/i.test(file.type||''))throw new Error('仅支持 JPG、PNG、WebP、GIF 和 AVIF 图片');
        if(file.size>MAX_IMAGE_BYTES)throw new Error('单张图片不能超过 8 MB：'+(file.name||'未命名图片'));
        if(currentBytes+added.reduce((n,x)=>n+(Number(x.size)||0),0)+file.size>MAX_TOTAL_IMAGE_BYTES)throw new Error('一封信的图片附件总大小不能超过 24 MB');
        if(typeof putMediaBlob!=='function')throw new Error('媒体存储尚未就绪');
        const stored=await compressMailJpeg(file);
        if(generation!==composeGeneration||draftId!==activeDraftId)throw new Error('草稿已切换，已取消旧草稿的图片添加');
        const id=await putMediaBlob(stored,'mail-image',file.name||'letter-image');
        added.push({id,name:file.name||'图片 '+(baseImages.length+added.length+1),mimeType:stored.type||file.type,size:stored.size||file.size,order:baseImages.length+added.length});
        if(generation!==composeGeneration||draftId!==activeDraftId)throw new Error('草稿已切换，已取消旧草稿的图片添加');
      }
      if(generation!==composeGeneration||draftId!==activeDraftId)throw new Error('草稿已切换，已取消旧草稿的图片添加');
      activeComposeImages=baseImages.concat(added);
      if(saveDraft()===false){activeComposeImages=baseImages;throw new Error('图片已读取，但草稿未能保存');}
      await renderComposeImages(generation,activeDraftId);showToast('已添加 '+added.length+' 张图片');
    }catch(error){
      for(const item of added){if(!getReferencedMediaIds().has(item.id))await deleteMediaRecord(item.id);}
      if(!String(error.message||'').includes('草稿已切换'))showToast(error.message||'图片添加失败');
    }finally{addingComposeImages=false;const input=$('#mailImageInput');if(input)input.value='';}
  }
  function getReferencedMediaIds(){const ids=new Set();for(const item of box.items||[])for(const image of normalizeImages(item.images))ids.add(image.id);for(const draft of drafts||[])for(const image of normalizeImages(draft.images))ids.add(image.id);for(const image of activeComposeImages||[])ids.add(image.id);return ids;}
  async function removeComposeImage(id){if(addingComposeImages){showToast('图片正在处理，请稍后再移除');return;}const generation=++composeGeneration,draftId=activeDraftId,before=activeComposeImages.slice();activeComposeImages=activeComposeImages.filter(x=>x.id!==id);if(saveDraft()===false){activeComposeImages=before;showToast('移除未能保存');await renderComposeImages(generation,activeDraftId);return;}await renderComposeImages(generation,activeDraftId);if(!getReferencedMediaIds().has(id)){await deleteMediaRecord(id);revokeImageUrl(id);}}
  async function cleanupUnreferencedImages(images){const refs=getReferencedMediaIds();for(const item of normalizeImages(images)){if(!refs.has(item.id)){await deleteMediaRecord(item.id);revokeImageUrl(item.id);}}}

  function closeCompose(){composeGeneration++;const modal=$('#mailComposeModal');if(modal)modal.classList.remove('show');revokeUrlsNotVisible();}
  function saveDraft(){
    reconcileComposeCardFragments();
    const title=clean($('#mailComposeTitle')?.value),content=clean($('#mailComposeContent')?.value),images=normalizeImages(activeComposeImages);
    if(!title&&!content&&!images.length&&!activeDraftId)return true;
    const before=clone(drafts),beforeId=activeDraftId;let existing=drafts.find(x=>x.id===activeDraftId);
    if(existing){existing.title=title;existing.content=content;existing.cardFragments=composeCardFragments.slice();existing.images=images;existing.replyToId=activeReplyToId;existing.updatedAt=Date.now();}
    else{existing={id:uid(),title,content,cardFragments:composeCardFragments.slice(),images,replyToId:activeReplyToId,updatedAt:Date.now()};drafts.unshift(existing);activeDraftId=existing.id;}
    drafts=drafts.slice(0,50);
    const evicted=before.filter(item=>!drafts.some(current=>current.id===item.id));
    try{persistDrafts();render();if(evicted.length)void cleanupUnreferencedImages(evicted.flatMap(item=>item.images||[]));return true;}catch(error){drafts=before;activeDraftId=beforeId;showToast('草稿保存失败：'+(error.message||error));return false;}
  }
  function makeUsageEvent(fragment,source,letterId=null,sourceId=null){return {eventId:uid('use'),cardId:fragment.cardId||null,source,textSnapshot:clean(fragment.textSnapshot),letterId:letterId||null,sourceId:sourceId||null,usedAt:Date.now()};}
  function flushUsageOutbox(){
    const api=window.__duoCardSystem;if(!api||typeof api.recordUsageEvent!=='function'||!Array.isArray(box.usageOutbox)||!box.usageOutbox.length)return false;
    const before=box.usageOutbox.slice(),left=[];let processed=0;
    for(const event of before){if(api.recordUsageEvent(event))processed++;else left.push(event);}
    if(processed){box.usageOutbox=left;try{persist();}catch(error){box.usageOutbox=before;showToast('最近使用记录待重试：'+(error.message||error));}}
    return processed>0;
  }
  function send(){
    const title=clean($('#mailComposeTitle')?.value),content=clean($('#mailComposeContent')?.value);
    if(!content&&!activeComposeImages.length){showToast('信件内容不能为空');return false;}
    reconcileComposeCardFragments();
    flushUsageOutbox();
    const oldBox=clone(box),oldDrafts=clone(drafts),used=composeCardFragments.slice(),images=normalizeImages(activeComposeImages);
    if(box.usageOutbox.length+used.length>MAX_PENDING_USAGE_EVENTS){showToast('最近字卡使用记录队列已满；旧记录尚未安全写入，请稍后重试寄信');return false;}
    const letter=makeLetter('outgoing',title,content,{replyToId:activeReplyToId,cardFragments:used,images});box.items.push(letter);
    const evictedLetters=box.items.length>5000?box.items.splice(0,box.items.length-5000):[];
    if(box.settings.autoReply)box.pending.push({id:uid(),type:'reply',sourceId:letter.id,due:Date.now()+random(box.settings.minReplyMin,box.settings.maxReplyMin)*60000});
    used.forEach(fragment=>{const event=makeUsageEvent(fragment,'mail',letter.id,letter.replyToId);if(event.textSnapshot)box.usageOutbox.push(event);});
    drafts=drafts.filter(x=>x.id!==activeDraftId);
    try{commitBoth();}catch(error){box=normalize(oldBox);drafts=oldDrafts;showToast('信件寄出失败，原草稿已保留：'+(error.message||error));return false;}
    if(evictedLetters.length)void cleanupUnreferencedImages(evictedLetters.flatMap(item=>item.images||[]));
    flushUsageOutbox();composeCardFragments=[];activeComposeImages=[];activeReplyToId=null;activeDraftId=null;closeCompose();render();showToast('信件已寄出');return true;
  }
  async function openLetter(id){
    const item=box.items.find(x=>x.id===id);if(!item)return;
    const generation=++readGeneration;
    const wasRead=item.read;item.read=true;try{persist();}catch(error){item.read=wasRead;showToast('信件已打开，但已读状态保存失败：'+(error.message||error));return;}
    render();const modal=$('#mailReadModal');if(!modal)return;
    modal.dataset.letterId=id;modal.classList.add('show');
    $('#mailReadTitle').textContent=item.title;$('#mailReadMeta').textContent=(item.type==='incoming'?'收到的信':'寄出的信')+' · '+new Date(item.createdAt).toLocaleString();$('#mailReadContent').textContent=item.content;
    const host=$('#mailReadImages');if(host){host.innerHTML='';revokeUrlsNotVisible();for(const image of normalizeImages(item.images)){
      let url=getImageUrl(image.id);
      if(!url){try{const rec=await getMediaRecord(image.id);if(generation!==readGeneration||modal.dataset.letterId!==id||!modal.classList.contains('show'))return;if(rec?.blob){url=URL.createObjectURL(rec.blob);imageUrls.set(image.id,url);}}catch(_){}}
      if(generation!==readGeneration||modal.dataset.letterId!==id||!modal.classList.contains('show'))return;
      const wrap=document.createElement('div');wrap.className='mail-read-image';if(url){const img=document.createElement('img');img.src=url;img.alt=image.name||'信件图片';wrap.appendChild(img);}else wrap.textContent='图片附件缺失：'+(image.name||'图片');host.appendChild(wrap);
    }}
    if(generation!==readGeneration||modal.dataset.letterId!==id||!modal.classList.contains('show'))return;
    const replyBtn=$('#mailReplyBtn');if(replyBtn)replyBtn.hidden=item.type!=='incoming';const delBtn=$('#mailDeleteBtn');if(delBtn)delBtn.hidden=false;
  }
  async function deleteLetter(id){const old=clone(box);const item=box.items.find(x=>x.id===id);if(!item)return false;box.items=box.items.filter(x=>x.id!==id);box.pending=box.pending.filter(x=>x.sourceId!==id);try{persist();}catch(error){box=normalize(old);showToast('删除信件失败：'+(error.message||error));return false;}closeRead();render();await cleanupUnreferencedImages(item.images);showToast('信件已删除');return true;}
  function closeRead(){readGeneration++;const modal=$('#mailReadModal');modal?.classList.remove('show');if(modal)modal.dataset.letterId='';const host=$('#mailReadImages');if(host)host.innerHTML='';revokeUrlsNotVisible();}
  function replyToCurrent(){const id=$('#mailReadModal')?.dataset.letterId,item=box.items.find(x=>x.id===id);if(!item)return;closeRead();openCompose({title:'回复：'+item.title,content:'',replyToId:item.id});}
  function processDue(){
    if(tasksPaused)return;
    const now=Date.now(),oldBox=clone(box),used=[];let changed=false;const evictedLetters=[];
    const due=box.pending.filter(x=>Number(x.due)<=now);
    const actionableDue=due.map(task=>({task,source:box.items.find(item=>item.id===task.sourceId)})).filter(item=>item.source);
    const incomingDue=!!(box.settings.autoIncoming&&box.nextIncomingAt&&box.nextIncomingAt<=now);
    const plans=actionableDue.map(item=>({kind:'reply',source:item.source,cards:chooseChatCards()}));
    if(incomingDue)plans.push({kind:'incoming',source:null,cards:chooseChatCards()});
    const requiredUsageEvents=plans.reduce((sum,plan)=>sum+plan.cards.length,0);
    if(box.usageOutbox.length+requiredUsageEvents>MAX_PENDING_USAGE_EVENTS){showToast('最近字卡使用记录队列已满；自动来信与回信暂缓处理，待队列清空后会自动重试');return;}
    if(due.length){box.pending=box.pending.filter(x=>Number(x.due)>now);changed=true;}
    for(const plan of plans){
      const fragments=fragmentsForCards(plan.cards);
      const fallback=plan.kind==='reply'?'我收到你的信啦，等我慢慢回你。':'今天想给你写一封信。';
      const title=plan.kind==='reply'?'回信：'+plan.source.title:'一封新来信';
      const letter=makeLetter('incoming',title,contentForCards(plan.cards,fallback),{
        replyToId:plan.source?.id||null,cardFragments:fragments
      });
      box.items.push(letter);
      for(const card of plan.cards)used.push({
        textSnapshot:card.text,cardId:card.cardId,
        source:plan.kind==='reply'?'mail-auto-reply':'mail-auto-incoming',
        letterId:letter.id,sourceId:plan.source?.id||null
      });
      changed=true;
    }
    if(incomingDue)scheduleIncoming(false);
    if(changed){
      if(box.items.length>5000)evictedLetters.push(...box.items.splice(0,box.items.length-5000));
      try{used.forEach(x=>box.usageOutbox.push({...x,eventId:uid('use'),usedAt:Date.now()}));persist();}
      catch(error){box=normalize(oldBox);showToast('自动信件未能保存，已保留原信箱数据：'+(error.message||error));return;}
      render();if(evictedLetters.length)void cleanupUnreferencedImages(evictedLetters.flatMap(item=>item.images||[]));flushUsageOutbox();
    }
  }
  function syncSettings(){
    const s=box.settings;
    [['mailAutoIncoming','autoIncoming'],['mailAutoReply','autoReply']].forEach(([id,key])=>{const field=$('#'+id);if(field)field.checked=!!s[key];});
    [['mailIncomingMin','minIncomingMin',60],['mailIncomingMax','maxIncomingMin',60],['mailReplyMin','minReplyMin',1],['mailReplyMax','maxReplyMin',1],['mailCardCountMin','cardCountMin',1],['mailCardCountMax','cardCountMax',1]].forEach(([id,key,divisor])=>{
      const field=$('#'+id);if(field)field.value=divisor===60?Number((s[key]/60).toFixed(2)):s[key];
    });
    const status=$('#mailAutoStatus');if(status)status.textContent=s.autoIncoming?(box.nextIncomingAt?'下一封预计：'+new Date(box.nextIncomingAt).toLocaleString():'主动来信已开启'):'主动来信已关闭';
    render();
  }
  function readSettingsForm(){
    const incomingMinHours=Number($('#mailIncomingMin')?.value),incomingMaxHours=Number($('#mailIncomingMax')?.value);
    const replyMin=Number($('#mailReplyMin')?.value),replyMax=Number($('#mailReplyMax')?.value);
    const cardMinRaw=String($('#mailCardCountMin')?.value??''),cardMaxRaw=String($('#mailCardCountMax')?.value??'');
    if(!Number.isFinite(incomingMinHours)||!Number.isFinite(incomingMaxHours)||incomingMinHours<1||incomingMaxHours>168||incomingMinHours>incomingMaxHours)throw new Error('主动来信间隔请输入 1～168 小时，且最短不能大于最长');
    if(!Number.isFinite(replyMin)||!Number.isFinite(replyMax)||replyMin<1||replyMax>1440||replyMin>replyMax)throw new Error('自动回信等待请输入 1～1440 分钟，且最短不能大于最长');
    if(!/^(?:10|[1-9])$/.test(cardMinRaw)||!/^(?:10|[1-9])$/.test(cardMaxRaw))throw new Error('每封信最少和最多使用字卡数量都必须为 1～10 的整数');
    const cardMin=Number(cardMinRaw),cardMax=Number(cardMaxRaw);
    if(cardMin>cardMax)throw new Error('最少字卡数不能大于最多字卡数');
    return {
      autoIncoming:!!$('#mailAutoIncoming')?.checked,autoReply:!!$('#mailAutoReply')?.checked,
      minIncomingMin:Math.round(incomingMinHours*60),maxIncomingMin:Math.round(incomingMaxHours*60),
      minReplyMin:Math.round(replyMin),maxReplyMin:Math.round(replyMax),
      cardCountMin:cardMin,cardCountMax:cardMax
    };
  }
  function restoreDefaultSettings(){
    const s=defaults.settings;
    if($('#mailAutoIncoming'))$('#mailAutoIncoming').checked=!!s.autoIncoming;
    if($('#mailAutoReply'))$('#mailAutoReply').checked=!!s.autoReply;
    if($('#mailIncomingMin'))$('#mailIncomingMin').value=Number((s.minIncomingMin/60).toFixed(2));
    if($('#mailIncomingMax'))$('#mailIncomingMax').value=Number((s.maxIncomingMin/60).toFixed(2));
    if($('#mailReplyMin'))$('#mailReplyMin').value=s.minReplyMin;
    if($('#mailReplyMax'))$('#mailReplyMax').value=s.maxReplyMin;
    if($('#mailCardCountMin'))$('#mailCardCountMin').value=s.cardCountMin;
    if($('#mailCardCountMax'))$('#mailCardCountMax').value=s.cardCountMax;
    const error=$('#mailSettingsError');if(error)error.textContent='';
  }
  function saveSettings(){
    const error=$('#mailSettingsError');
    try{
      const next=readSettingsForm(),old=clone(box);
      const incomingChanged=next.autoIncoming!==box.settings.autoIncoming||next.minIncomingMin!==box.settings.minIncomingMin||next.maxIncomingMin!==box.settings.maxIncomingMin;
      box.settings={...box.settings,...next};
      if(incomingChanged)box.nextIncomingAt=0;
      try{scheduleIncoming(false);persist();}
      catch(storageError){box=normalize(old);throw storageError;}
      render();if(error)error.textContent='';
      showToast('信箱设置已保存');
      window.__duoCloseSettingsCategory?.();
      return true;
    }catch(failure){
      if(error)error.textContent=failure.message||'设置保存失败';
      else showToast(failure.message||'信箱设置保存失败');
      return false;
    }
  }
  function mountSettings(root){
    if(!root)return false;
    root.innerHTML=`<section class="panel-card duo-mail-settings" data-mail-settings-form>
      <h3>信箱设置</h3>
      <p class="data-note">设置只影响以后新生成的主动来信和自动回信。</p>
      <div class="item-row"><label for="mailAutoIncoming">允许主动来信</label><input id="mailAutoIncoming" type="checkbox"></div>
      <label class="duo-mail-setting-row"><span>主动来信间隔</span><span><input id="mailIncomingMin" type="number" min="1" max="168" step="0.01" inputmode="decimal"> ～ <input id="mailIncomingMax" type="number" min="1" max="168" step="0.01" inputmode="decimal"> 小时</span></label>
      <div class="item-row"><label for="mailAutoReply">自动回信</label><input id="mailAutoReply" type="checkbox"></div>
      <label class="duo-mail-setting-row"><span>自动回信等待</span><span><input id="mailReplyMin" type="number" min="1" max="1440" step="1" inputmode="numeric"> ～ <input id="mailReplyMax" type="number" min="1" max="1440" step="1" inputmode="numeric"> 分钟</span></label>
      <label class="duo-mail-setting-row"><span>每封信最少使用</span><span><input id="mailCardCountMin" type="number" min="1" max="10" step="1"> 张字卡</span></label>
      <label class="duo-mail-setting-row"><span>每封信最多使用</span><span><input id="mailCardCountMax" type="number" min="1" max="10" step="1"> 张字卡</span></label>
      <div id="mailSettingsError" class="duo-mail-settings-error" aria-live="polite"></div>
      <div class="duo-mail-settings-actions"><button type="button" id="mailSettingsSave" class="primary">保存</button><button type="button" id="mailSettingsDefault" class="mini-btn">恢复默认值</button><button type="button" id="mailSettingsCancel" class="mini-btn">取消</button></div>
    </section>`;
    syncSettings();return true;
  }
  function exportData(){return {mailbox:clone(box),drafts:clone(drafts)};}
  function importData(raw){if(!raw||typeof raw!=='object')throw new Error('信件备份格式无效');const oldBox=JSON.parse(JSON.stringify(box)),oldDrafts=JSON.parse(JSON.stringify(drafts));const previousImages=[...(oldBox.items||[]).flatMap(item=>item.images||[]),...oldDrafts.flatMap(item=>item.images||[])];const next=normalize(raw.mailbox||raw);const nextDrafts=Array.isArray(raw.drafts)?raw.drafts.filter(x=>x&&typeof x==='object').slice(0,50).map(x=>({...x,id:clean(x.id).slice(0,128)||uid(),title:clean(x.title).slice(0,120),content:clean(x.content),cardFragments:Array.isArray(x.cardFragments)?x.cardFragments.filter(f=>f&&typeof f.textSnapshot==='string').slice(0,100):[],images:normalizeImages(x.images),updatedAt:Math.max(0,Number(x.updatedAt)||Date.now())})):[];box=next;drafts=nextDrafts;try{if(box.settings.autoIncoming&&!box.nextIncomingAt)scheduleIncoming(false);commitBoth();syncSettings();if(previousImages.length)void cleanupUnreferencedImages(previousImages);return true;}catch(error){box=normalize(oldBox);drafts=oldDrafts;throw error;}}
  function showPage(){render();syncSettings();processDue();}
  window.__duoMailbox={exportData,importData,render,processDue,openCompose,openLetter,flushUsageOutbox,getReferencedMediaIds,mountSettings,pauseTasks(){tasksPaused=true;},resumeTasks(){tasksPaused=false;flushUsageOutbox();processDue();}};
  const style=document.createElement('style');style.textContent='.duo-mail-settings .data-note{margin:0 0 14px}.duo-mail-setting-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:13px 0;border-bottom:1px solid var(--line);font-size:13px;color:var(--text)}.duo-mail-setting-row>span:last-child{display:flex;align-items:center;gap:6px;white-space:nowrap}.duo-mail-setting-row input{width:72px;min-width:0;padding:8px 6px;border:1px solid var(--line);border-radius:8px;background:var(--soft);color:var(--text);text-align:center}.duo-mail-settings-actions{display:flex;gap:8px;margin-top:16px}.duo-mail-settings-actions button{flex:1;min-height:40px}.duo-mail-settings-error{min-height:18px;color:#b94b4b;font-size:12px;padding-top:8px}@media(max-width:380px){.duo-mail-setting-row{align-items:flex-start;flex-direction:column}.duo-mail-setting-row>span:last-child{max-width:100%}}.mail-actions{display:flex;gap:8px;flex-wrap:wrap}.mail-letter-row{display:flex;flex-direction:column;align-items:flex-start;gap:5px;width:100%;padding:13px;margin:8px 0;border:1px solid var(--line);border-radius:14px;background:var(--panel);color:var(--text);text-align:left}.mail-letter-row strong{font-size:15px}.mail-letter-row small,.mail-letter-type{color:var(--sub);font-size:11px}.mail-letter-row>span:last-child{font-size:13px;line-height:1.5;color:var(--sub)}.mail-empty{padding:25px 12px;text-align:center;color:var(--sub);font-size:13px}.mail-modal{position:absolute;inset:0;z-index:80;display:none;align-items:flex-end;background:#0006}.mail-modal.show{display:flex}.mail-sheet{width:100%;max-height:88%;overflow:auto;padding:18px;border-radius:20px 20px 0 0;background:var(--panel);color:var(--text)}.mail-sheet input,.mail-sheet textarea{width:100%;margin:8px 0;padding:12px;border:1px solid var(--line);border-radius:10px;background:var(--soft);color:var(--text)}.mail-sheet textarea{min-height:220px;resize:vertical}.mail-read-content{white-space:pre-wrap;line-height:1.8;overflow-wrap:anywhere;padding:12px 0}.mail-setting-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.mail-setting-grid label{display:flex;flex-direction:column;gap:5px;font-size:12px}.mail-setting-grid input{width:100%}.mail-draft-row{display:flex;align-items:center;gap:8px;margin:7px 0;padding:10px;border:1px solid var(--line);border-radius:11px}.mail-draft-row>button:first-child{flex:1;display:flex;flex-direction:column;align-items:flex-start;gap:4px;background:transparent;color:var(--text);text-align:left}.mail-draft-row small{color:var(--sub);font-size:10px}.mail-image-grid{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.mail-image-thumb{position:relative;width:76px;height:76px;border-radius:10px;overflow:hidden;background:var(--soft);border:1px solid var(--line)}.mail-image-thumb img,.mail-read-image img{width:100%;height:100%;object-fit:cover;display:block}.mail-image-thumb button{position:absolute;right:3px;top:3px;width:22px;height:22px;border:0;border-radius:50%;background:#0009;color:white}.mail-read-images{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0}.mail-read-image{width:min(42vw,180px);height:180px;border-radius:12px;overflow:hidden;background:var(--soft);display:flex;align-items:center;justify-content:center;color:var(--sub);font-size:12px}.mail-image-hint{font-size:11px;color:var(--sub)}.mail-draft-row>button:last-child{padding:7px 10px;border-radius:8px;background:#f8eeee;color:#a33}';document.head.appendChild(style);
  document.addEventListener('click',e=>{if(e.target.closest('#mailComposeBtn'))openCompose();if(e.target.closest('#mailDraftOpenBtn')){if(drafts.length)openCompose(drafts[0]);else showToast('当前没有草稿');}const draft=e.target.closest('[data-mail-draft]');if(draft)openCompose(drafts.find(x=>x.id===draft.dataset.mailDraft));const draftDel=e.target.closest('[data-mail-draft-delete]');if(draftDel){const before=clone(drafts),removed=drafts.find(x=>x.id===draftDel.dataset.mailDraftDelete);drafts=drafts.filter(x=>x.id!==draftDel.dataset.mailDraftDelete);try{persistDrafts();render();cleanupUnreferencedImages(removed?.images||[]);}catch(error){drafts=before;showToast('草稿删除失败：'+(error.message||error));}}if(e.target.closest('#mailComposeCancel')){saveDraft();closeCompose();}if(e.target.closest('#mailComposeSend'))send();if(e.target.closest('#mailInsertCardBtn'))insertCard();if(e.target.closest('#mailImagePickBtn'))$('#mailImageInput')?.click();const imageDel=e.target.closest('[data-mail-image-remove]');if(imageDel)removeComposeImage(imageDel.dataset.mailImageRemove);if(e.target.closest('#mailReadClose'))closeRead();if(e.target.closest('#mailReplyBtn'))replyToCurrent();if(e.target.closest('#mailDeleteBtn')){const id=$('#mailReadModal')?.dataset.letterId;if(id)deleteLetter(id);}const row=e.target.closest('[data-mail-open]');if(row)openLetter(row.dataset.mailOpen);if(e.target.closest('#mailSettingsSave'))saveSettings();if(e.target.closest('#mailSettingsDefault'))restoreDefaultSettings();if(e.target.closest('#mailSettingsCancel'))window.__duoCloseSettingsCategory?.();if(e.target.closest('#mailDraftBtn')){saveDraft();showToast('草稿已保存');}});
  document.addEventListener('input',e=>{if(e.target.matches('#mailComposeTitle,#mailComposeContent'))saveDraft();});
  document.addEventListener('change',e=>{if(e.target&&e.target.id==='mailImageInput')addImages(e.target.files);});
  document.addEventListener('click',e=>{if(e.target.closest('[data-go="mailPage"]'))setTimeout(showPage,0);});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)processDue();});window.addEventListener('focus',processDue);setInterval(()=>{if(!document.hidden)processDue();},15000);
  if(box.settings.autoIncoming&&!box.nextIncomingAt){try{scheduleIncoming();}catch(error){showToast('自动来信计划保存失败：'+(error.message||error));}}
  syncSettings();
})();
