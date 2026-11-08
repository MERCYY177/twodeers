/* KKK-aligned mailbox: received/sent tabs, transient composition, scheduled card-based letters. */
(function(){
  'use strict';
  if(window.__duoMailboxInstalled)return;
  window.__duoMailboxInstalled=true;
  const KEY='twodeers_mailbox_letters_v1',LEGACY_DRAFT_KEY='twodeers_mailbox_drafts_v1';
  const defaults={version:1,items:[],pending:[],usageOutbox:[],recentCardKeys:[],nextIncomingAt:0,settings:{autoIncoming:true,autoReply:true,minIncomingMin:720,maxIncomingMin:2160,minReplyMin:2,maxReplyMin:15,cardCountMin:2,cardCountMax:4}};
  let box=defaults,activeReplyToId=null,activeComposeImages=[],activeTab='in',tasksPaused=false,composeGeneration=0,readGeneration=0,addingComposeImages=false;
  const imageUrls=new Map(),MAX_IMAGES=6,MAX_COMPOSE_IMAGES=4,MAX_IMAGE_BYTES=8*1024*1024,MAX_TOTAL_IMAGE_BYTES=24*1024*1024,MAX_PENDING_USAGE_EVENTS=1000;
  const clone=value=>JSON.parse(JSON.stringify(value));
  const $=s=>document.querySelector(s),uid=()=>('letter_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8));
  const clean=s=>String(s||'').trim().slice(0,12000);
  function isLegacyPresetLetter(item){
    if(!item||item.type!=='incoming'||(Array.isArray(item.images)&&item.images.length))return false;
    if(Array.isArray(item.cardFragments)&&item.cardFragments.length)return false;
    const content=clean(item.content),title=clean(item.title);
    if(content==='今天想给你写一封信。'&&title==='一封新来信'&&!item.replyToId)return true;
    if(content==='我收到你的信啦，等我慢慢回你。'&&title.startsWith('回信：')&&typeof item.replyToId==='string'&&item.replyToId)return true;
    return false;
  }
  function normalize(raw){const x={...defaults,...(raw&&typeof raw==='object'?raw:{})};delete x.drafts;delete x.draft; x.items=Array.isArray(x.items)?x.items.filter(v=>v&&typeof v==='object'&&!isLegacyPresetLetter(v)).slice(-5000).map(v=>({...v,id:clean(v.id).slice(0,128)||uid(),type:v.type==='outgoing'?'outgoing':'incoming',title:clean(v.title).slice(0,120),content:clean(v.content),createdAt:Math.max(0,Number(v.createdAt)||Date.now()),read:!!v.read,cardFragments:Array.isArray(v.cardFragments)?v.cardFragments.filter(f=>f&&typeof f.textSnapshot==='string').slice(0,100):[],images:normalizeImages(v.images)})):[];x.usageOutbox=Array.isArray(x.usageOutbox)?x.usageOutbox.filter(v=>v&&typeof v.textSnapshot==='string'):[];x.recentCardKeys=Array.isArray(x.recentCardKeys)?x.recentCardKeys.filter(v=>typeof v==='string').slice(-24):[];x.pending=Array.isArray(x.pending)?x.pending.filter(v=>v&&v.type==='reply'&&typeof v.sourceId==='string').slice(0,1000).map(v=>({...v,id:clean(v.id).slice(0,128)||uid(),due:Math.max(0,Number(v.due)||0)})):[];x.settings={...defaults.settings,...(x.settings||{})};for(const k of ['minIncomingMin','maxIncomingMin','minReplyMin','maxReplyMin'])x.settings[k]=Math.max(1,Math.min(10080,Number(x.settings[k])||defaults.settings[k]));const cardMin=Number(x.settings.cardCountMin),cardMax=Number(x.settings.cardCountMax);x.settings.cardCountMin=Number.isInteger(cardMin)&&cardMin>=1&&cardMin<=10?cardMin:defaults.settings.cardCountMin;x.settings.cardCountMax=Number.isInteger(cardMax)&&cardMax>=1&&cardMax<=10?cardMax:defaults.settings.cardCountMax;if(x.settings.cardCountMin>x.settings.cardCountMax)x.settings.cardCountMax=x.settings.cardCountMin;if(x.settings.maxIncomingMin<x.settings.minIncomingMin)x.settings.maxIncomingMin=x.settings.minIncomingMin;if(x.settings.maxReplyMin<x.settings.minReplyMin)x.settings.maxReplyMin=x.settings.minReplyMin;x.nextIncomingAt=Math.max(0,Number(x.nextIncomingAt)||0);return x;}
  try{const stored=JSON.parse(localStorage.getItem(KEY)||'null');box=normalize(stored);if(stored&&Array.isArray(stored.items)&&stored.items.length!==box.items.length)persist();}catch(_){box=normalize(null);}try{localStorage.removeItem(LEGACY_DRAFT_KEY);}catch(_){}
  function normalizeImages(images){return Array.isArray(images)?images.filter(x=>x&&typeof x.id==='string').slice(0,MAX_IMAGES).map((x,i)=>({id:x.id,name:clean(x.name).slice(0,180)||'图片 '+(i+1),mimeType:clean(x.mimeType).slice(0,100)||'image/jpeg',size:Math.max(0,Number(x.size)||0),order:Number.isFinite(Number(x.order))?Number(x.order):i})):[];}
  function persist(){localStorage.setItem(KEY,JSON.stringify(box));}
  function esc(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function scheduleIncoming(shouldPersist=true){if(!box.settings.autoIncoming){box.nextIncomingAt=0;if(shouldPersist)persist();return;}if(!box.nextIncomingAt||box.nextIncomingAt<Date.now())box.nextIncomingAt=Date.now()+random(box.settings.minIncomingMin,box.settings.maxIncomingMin)*60000;if(shouldPersist)persist();}
  function chooseChatCards(sourceText=''){
    const seen=new Set(),pool=(state.cardPhrases||[]).map((raw,index)=>({text:clean(raw),index})).filter(item=>item.text&&!seen.has(item.text)&&seen.add(item.text));
    if(!pool.length)return [];
    const source=String(sourceText||''),topics=[['想念',['想你','想念','惦记','挂念','见面','陪伴','陪你','抱你','抱抱']],['情绪',['累','困','疲惫','难过','委屈','想哭','哭','疼']],['开心',['开心','高兴','快乐','喜欢','幸福','笑']],['日常',['今天','最近','吃饭','睡觉','工作','学习','天气']],['亲密',['喜欢你','爱你','爱','在意','亲亲','抱抱']]];
    const ignored=/[\s，。！？、；：“”‘’的了我你他她它是在有和就也都而很]/g,chars=new Set(source.replace(ignored,'').split(''));
    pool.forEach(item=>{let score=Math.random()*1.5;topics.forEach(group=>{const sourceHit=group[1].some(term=>source.includes(term)),cardHit=group[1].some(term=>item.text.includes(term));if(sourceHit&&cardHit)score+=4;});chars.forEach(ch=>{if(ch&&item.text.includes(ch))score+=.35;});if(box.recentCardKeys.includes(item.text))score-=5;if(item.text.length>=6&&item.text.length<=70)score+=1;item.score=score;});
    pool.sort((a,b)=>b.score-a.score);
    const count=Math.min(random(box.settings.cardCountMin,box.settings.cardCountMax),pool.length),shortlist=pool.slice(0,Math.min(pool.length,Math.max(8,count*3))),selected=[];
    while(selected.length<count&&shortlist.length){const ceiling=Math.min(shortlist.length,Math.max(3,Math.ceil(shortlist.length/2))),index=Math.floor(Math.random()*ceiling);selected.push(shortlist.splice(index,1)[0]);}
    box.recentCardKeys=box.recentCardKeys.concat(selected.map(item=>item.text)).slice(-24);
    return selected.map(item=>({text:item.text,cardId:window.__duoCardSystem?.getCardIdAt?.('chat',item.index)||window.__duoCardSystem?.getCardId?.(item.text,'chat')||null}));
  }
  function fragmentsForCards(cards){return cards.map(card=>({cardId:card.cardId,textSnapshot:card.text}));}
  function contentForCards(cards){
    if(!cards.length)return '';
    const lines=cards.map(card=>{const text=String(card.text||'').trim();return text&&/[。！？!?….]$/.test(text)?text:(text?text+(Math.random()<.2?'！':(Math.random()<.2?'...':'。')):'');}).filter(Boolean);
    const paragraphs=[];let buffer='';
    lines.forEach(line=>{if(line.length>55){if(buffer){paragraphs.push(buffer);buffer='';}paragraphs.push(line);return;}if(buffer&&buffer.length+line.length>70){paragraphs.push(buffer);buffer=line;}else buffer+=line;});
    if(buffer)paragraphs.push(buffer);return paragraphs.join('\n\n');
  }
  function random(a,b){a=Math.max(1,Number(a)||1);b=Math.max(a,Number(b)||a);return Math.floor(Math.random()*(b-a+1))+a;}
  function makeLetter(type,title,content,extra={}){return {id:uid(),type,title:clean(title)|| (type==='incoming'?'一封来信':'寄出的信'),content:clean(content),createdAt:Date.now(),read:type!=='incoming',originalContent:clean(content),replyToId:extra.replyToId||null,cardFragments:Array.isArray(extra.cardFragments)?extra.cardFragments:[],images:normalizeImages(extra.images)};}
  function render(){
    const list=$('#mailLetterList');if(!list)return;
    document.querySelectorAll('[data-mail-tab]').forEach(button=>{const active=button.dataset.mailTab===activeTab;button.classList.toggle('active',active);button.setAttribute('aria-selected',active?'true':'false');});
    const rows=box.items.filter(item=>activeTab==='in'?item.type==='incoming':item.type==='outgoing').slice().sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
    list.innerHTML=rows.length?rows.map(item=>{
      const direction=item.type==='incoming'?'收到':'寄出',preview=String(item.content||'').replace(/\s+/g,' ').slice(0,90),imageCount=normalizeImages(item.images).length;
      return '<button type=\"button\" class=\"mail-letter-row\" data-mail-open=\"'+esc(item.id)+'\"><span class=\"mail-letter-type\">'+direction+'</span><strong>'+esc(item.title||'一封没有标题的信')+'</strong><small>'+new Date(item.createdAt||0).toLocaleString()+(item.type==='incoming'&&!item.read?' · 未读':'')+(imageCount?' · '+imageCount+' 张图片':'')+'</small><span>'+esc(preview||(imageCount?'[图片]':'（空白）'))+'</span></button>';
    }).join(''):'<div class=\"mail-empty\">'+(activeTab==='in'?'还没有收到信':'还没有寄出信件')+'</div>';
    const unread=box.items.filter(item=>item.type==='incoming'&&!item.read).length,count=$('#mailUnreadCount');
    if(count)count.textContent=unread?'未读 '+unread+' 封':'暂无未读';
  }
  function revokeImageUrl(id){const url=imageUrls.get(id);if(url){try{URL.revokeObjectURL(url);}catch(_){}imageUrls.delete(id);}}
  function getImageUrl(id){return imageUrls.get(id)||'';}
  function revokeUrlsNotVisible(){
    const visible=new Set();
    const compose=$('#mailComposeModal');if(typeof compose?.classList?.contains==='function'&&compose.classList.contains('show'))for(const item of normalizeImages(activeComposeImages))visible.add(item.id);
    const read=$('#mailReadModal');if(typeof read?.classList?.contains==='function'&&read.classList.contains('show')){const item=box.items.find(x=>x.id===read.dataset.letterId);for(const image of normalizeImages(item?.images))visible.add(image.id);}
    for(const id of [...imageUrls.keys()])if(!visible.has(id))revokeImageUrl(id);
  }
  async function renderComposeImages(generation=composeGeneration){
    const host=$('#mailComposeImagesPreview');if(!host)return;
    const items=normalizeImages(activeComposeImages),html=[];
    for(const item of items){
      let url=getImageUrl(item.id);
      if(!url){try{const rec=await getMediaRecord(item.id);if(generation!==composeGeneration)return;if(rec?.blob){url=URL.createObjectURL(rec.blob);imageUrls.set(item.id,url);}}catch(_){}}
      if(generation!==composeGeneration)return;
      html.push('<div class=\"mail-image-thumb\">'+(url?'<img src=\"'+esc(url)+'\" alt=\"'+esc(item.name)+'\">':'<span>附件缺失</span>')+'<button type=\"button\" data-mail-image-remove=\"'+esc(item.id)+'\" aria-label=\"移除图片\">×</button></div>');
    }
    if(generation!==composeGeneration)return;host.innerHTML=html.join('');
  }
  async function openCompose(replyToId=null,replyTitle=''){
    const title=$('#mailComposeTitle'),content=$('#mailComposeContent');if(!title||!content)return;
    const generation=++composeGeneration,abandonedImages=activeComposeImages.slice();activeReplyToId=replyToId||null;activeComposeImages=[];if(abandonedImages.length)void cleanupUnreferencedImages(abandonedImages);
    title.value=replyTitle||'';content.value='';const preview=$('#mailComposeImagesPreview');if(preview)preview.innerHTML='';
    $('#mailComposeModal')?.classList.add('show');revokeUrlsNotVisible();await renderComposeImages(generation);
    if(generation===composeGeneration)content.focus();
  }
  async function addImages(files){
    const requested=[...(files||[])].filter(Boolean);if(!requested.length)return;
    if(addingComposeImages){showToast('图片正在处理，请稍后再添加');return;}
    const generation=composeGeneration,baseImages=activeComposeImages.slice(),remaining=Math.max(0,MAX_COMPOSE_IMAGES-baseImages.length);
    if(!remaining){showToast('一封信最多添加 '+MAX_COMPOSE_IMAGES+' 张图片');return;}
    const selected=requested.slice(0,remaining);if(requested.length>remaining)showToast('最多还能添加 '+remaining+' 张图片');
    addingComposeImages=true;const currentBytes=baseImages.reduce((n,x)=>n+(Number(x.size)||0),0);let added=[];
    try{
      for(const file of selected){
        if(!/^image\/(jpeg|png|webp|gif|avif)$/i.test(file.type||''))throw new Error('仅支持 JPG、PNG、WebP、GIF 和 AVIF 图片');
        if(file.size>MAX_IMAGE_BYTES)throw new Error('单张图片不能超过 8 MB：'+(file.name||'未命名图片'));
        if(currentBytes+added.reduce((n,x)=>n+(Number(x.size)||0),0)+file.size>MAX_TOTAL_IMAGE_BYTES)throw new Error('一封信的图片附件总大小不能超过 24 MB');
        if(typeof putMediaBlob!=='function')throw new Error('媒体存储尚未就绪');
        if(generation!==composeGeneration)throw new Error('写信窗口已关闭，已取消图片添加');
        const id=await putMediaBlob(file,'mail-image',file.name||'letter-image');
        added.push({id,name:file.name||'图片 '+(baseImages.length+added.length+1),mimeType:file.type||'image/jpeg',size:file.size||0,order:baseImages.length+added.length});
        if(generation!==composeGeneration)throw new Error('写信窗口已关闭，已取消图片添加');
      }
      if(generation!==composeGeneration)throw new Error('写信窗口已关闭，已取消图片添加');
      activeComposeImages=baseImages.concat(added);await renderComposeImages(generation);showToast('已添加 '+added.length+' 张图片');
    }catch(error){for(const item of added){if(!getReferencedMediaIds().has(item.id))await deleteMediaRecord(item.id);}if(!String(error.message||'').includes('写信窗口已关闭'))showToast(error.message||'图片添加失败');}
    finally{addingComposeImages=false;const input=$('#mailImageInput');if(input)input.value='';}
  }
  function getReferencedMediaIds(){const ids=new Set();for(const item of box.items||[])for(const image of normalizeImages(item.images))ids.add(image.id);for(const image of activeComposeImages||[])ids.add(image.id);return ids;}
  async function removeComposeImage(id){if(addingComposeImages){showToast('图片正在处理，请稍后再移除');return;}const generation=++composeGeneration,before=activeComposeImages.slice();activeComposeImages=activeComposeImages.filter(x=>x.id!==id);await renderComposeImages(generation);if(!getReferencedMediaIds().has(id)){await deleteMediaRecord(id);revokeImageUrl(id);}}
  async function cleanupUnreferencedImages(images){const refs=getReferencedMediaIds();for(const item of normalizeImages(images)){if(!refs.has(item.id)){await deleteMediaRecord(item.id);revokeImageUrl(item.id);}}}
  function closeCompose(){
    composeGeneration++;const modal=$('#mailComposeModal');if(modal)modal.classList.remove('show');
    const discarded=activeComposeImages.slice();activeComposeImages=[];activeReplyToId=null;
    const title=$('#mailComposeTitle'),content=$('#mailComposeContent');if(title)title.value='';if(content)content.value='';const preview=$('#mailComposeImagesPreview');if(preview)preview.innerHTML='';
    revokeUrlsNotVisible();if(discarded.length)void cleanupUnreferencedImages(discarded);
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
    const oldBox=clone(box),images=normalizeImages(activeComposeImages),replyToId=activeReplyToId;
    const letter=makeLetter('outgoing',title,content,{replyToId,images});box.items.push(letter);
    const evicted=box.items.length>5000?box.items.splice(0,box.items.length-5000):[];
    if(box.settings.autoReply)box.pending.push({id:uid(),type:'reply',sourceId:letter.id,due:Date.now()+random(box.settings.minReplyMin,box.settings.maxReplyMin)*60000});
    try{persist();}catch(error){box=normalize(oldBox);showToast('信件寄出失败：'+(error.message||error));return false;}
    activeTab='out';activeComposeImages=[];activeReplyToId=null;closeCompose();if(evicted.length)void cleanupUnreferencedImages(evicted.flatMap(item=>item.images||[]));render();showToast('信件已寄出');return true;
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
  function replyToCurrent(){const id=$('#mailReadModal')?.dataset.letterId,item=box.items.find(x=>x.id===id);if(!item)return;closeRead();openCompose(item.id,'回复：'+item.title);}
  function processDue(){
    if(tasksPaused)return;
    const now=Date.now(),oldBox=clone(box),used=[];let changed=false;const evicted=[];
    const due=box.pending.filter(item=>Number(item.due)<=now),actionable=due.map(task=>({task,source:box.items.find(item=>item.id===task.sourceId&&item.type==='outgoing')})).filter(item=>item.source);
    const incomingDue=!!(box.settings.autoIncoming&&box.nextIncomingAt&&box.nextIncomingAt<=now);
    const plans=actionable.map(item=>({kind:'reply',source:item.source,cards:chooseChatCards(item.source.content)}));
    if(incomingDue)plans.push({kind:'incoming',source:null,cards:chooseChatCards('')});
    const requiredUsageEvents=plans.reduce((sum,plan)=>sum+plan.cards.length,0);
    if(box.usageOutbox.length+requiredUsageEvents>MAX_PENDING_USAGE_EVENTS){showToast('最近字卡使用记录队列已满；自动来信与回信暂缓处理，待队列清空后会自动重试');return;}
    if(due.length){box.pending=box.pending.filter(item=>Number(item.due)>now);changed=true;}
    for(const plan of plans){
      const content=contentForCards(plan.cards);
      if(!content)continue;
      const fragments=fragmentsForCards(plan.cards),title=plan.kind==='reply'?'回信：'+plan.source.title:'一封新来信';
      const letter=makeLetter('incoming',title,content,{replyToId:plan.source?.id||null,cardFragments:fragments});
      box.items.push(letter);
      for(const card of plan.cards)used.push({textSnapshot:card.text,cardId:card.cardId,source:plan.kind==='reply'?'mail-auto-reply':'mail-auto-incoming',letterId:letter.id,sourceId:plan.source?.id||null});
      changed=true;
    }
    if(incomingDue){scheduleIncoming(false);changed=true;}
    if(changed){
      if(box.items.length>5000)evicted.push(...box.items.splice(0,box.items.length-5000));
      try{used.forEach(item=>box.usageOutbox.push({...item,...{eventId:uid('use'),usedAt:Date.now()}}));persist();}
      catch(error){box=normalize(oldBox);showToast('自动信件未能保存，已保留原信箱数据：'+(error.message||error));return;}
      render();if(evicted.length)void cleanupUnreferencedImages(evicted.flatMap(item=>item.images||[]));flushUsageOutbox();
    }
  }
  function syncSettings(){
    const s=box.settings;
    [['mailAutoIncoming','autoIncoming'],['mailAutoReply','autoReply']].forEach(([id,key])=>{const field=$('#'+id);if(field)field.checked=!!s[key];});
    [['mailIncomingMin','minIncomingMin',60],['mailIncomingMax','maxIncomingMin',60],['mailReplyMin','minReplyMin',1],['mailReplyMax','maxReplyMin',1],['mailCardCountMin','cardCountMin',1],['mailCardCountMax','cardCountMax',1]].forEach(([id,key,divisor])=>{
      const field=$('#'+id);if(field)field.value=divisor===60?Math.round(s[key]/60):s[key];
    });
    const status=$('#mailAutoStatus');if(status)status.textContent=s.autoIncoming?(box.nextIncomingAt?'下一封预计：'+new Date(box.nextIncomingAt).toLocaleString():'主动来信已开启'):'主动来信已关闭';
    render();
  }
  function readSettingsForm(){
    const incomingMinHours=Number($('#mailIncomingMin')?.value),incomingMaxHours=Number($('#mailIncomingMax')?.value);
    const replyMin=Number($('#mailReplyMin')?.value),replyMax=Number($('#mailReplyMax')?.value);
    const cardMinRaw=String($('#mailCardCountMin')?.value??''),cardMaxRaw=String($('#mailCardCountMax')?.value??'');
    if(!Number.isInteger(incomingMinHours)||!Number.isInteger(incomingMaxHours)||incomingMinHours<1||incomingMaxHours>168||incomingMinHours>incomingMaxHours)throw new Error('主动来信间隔请输入 1～168 小时，且最短不能大于最长');
    if(!Number.isFinite(replyMin)||!Number.isFinite(replyMax)||replyMin<1||replyMax>1440||replyMin>replyMax)throw new Error('自动回信等待请输入 1～1440 分钟，且最短不能大于最长');
    if(!/^(?:10|[1-9])$/.test(cardMinRaw)||!/^(?:10|[1-9])$/.test(cardMaxRaw))throw new Error('每封信最少和最多使用字卡数量都必须为 1～10 的整数');
    const cardMin=Number(cardMinRaw),cardMax=Number(cardMaxRaw);
    if(cardMin>cardMax)throw new Error('最少字卡数不能大于最多字卡数');
    return {
      autoIncoming:!!$('#mailAutoIncoming')?.checked,autoReply:!!$('#mailAutoReply')?.checked,
      minIncomingMin:incomingMinHours*60,maxIncomingMin:incomingMaxHours*60,
      minReplyMin:Math.round(replyMin),maxReplyMin:Math.round(replyMax),
      cardCountMin:cardMin,cardCountMax:cardMax
    };
  }
  function restoreDefaultSettings(){
    const s=defaults.settings;
    if($('#mailAutoIncoming'))$('#mailAutoIncoming').checked=!!s.autoIncoming;
    if($('#mailAutoReply'))$('#mailAutoReply').checked=!!s.autoReply;
    if($('#mailIncomingMin'))$('#mailIncomingMin').value=Math.round(s.minIncomingMin/60);
    if($('#mailIncomingMax'))$('#mailIncomingMax').value=Math.round(s.maxIncomingMin/60);
    if($('#mailReplyMin'))$('#mailReplyMin').value=s.minReplyMin;
    if($('#mailReplyMax'))$('#mailReplyMax').value=s.maxReplyMin;
    if($('#mailCardCountMin'))$('#mailCardCountMin').value=s.cardCountMin;
    if($('#mailCardCountMax'))$('#mailCardCountMax').value=s.cardCountMax;
    const error=$('#mailSettingsError');if(error)error.textContent='';
    saveSettings('信箱设置已恢复默认');
  }
  function openSettingsModal(){
    const modal=$('#mailSettingsModal');if(!modal)return false;
    syncSettings();modal.classList.add('show');modal.setAttribute('aria-hidden','false');
    return true;
  }
  function closeSettingsModal(){
    const modal=$('#mailSettingsModal');if(!modal)return;
    syncSettings();modal.classList.remove('show');modal.setAttribute('aria-hidden','true');
  }
  function saveSettings(successMessage='信箱设置已保存'){
    const error=$('#mailSettingsError');
    try{
      const next=readSettingsForm(),old=clone(box);
      const incomingChanged=next.autoIncoming!==box.settings.autoIncoming||next.minIncomingMin!==box.settings.minIncomingMin||next.maxIncomingMin!==box.settings.maxIncomingMin;
      box.settings={...box.settings,...next};
      if(incomingChanged)box.nextIncomingAt=0;
      if(!box.settings.autoReply)box.pending=[];
      try{scheduleIncoming(false);persist();}
      catch(storageError){box=normalize(old);throw storageError;}
      render();if(error)error.textContent='';
      closeSettingsModal();showToast(successMessage);
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
      <div class="item-row"><label for="mailAutoIncoming">允许主动来信</label><input id="mailAutoIncoming" type="checkbox"></div>
      <label class="duo-mail-setting-row"><span>主动来信间隔</span><span><input id="mailIncomingMin" type="number" min="1" max="168" step="1" inputmode="numeric"> ～ <input id="mailIncomingMax" type="number" min="1" max="168" step="1" inputmode="numeric"> 小时</span></label>
      <div class="item-row"><label for="mailAutoReply">自动回信</label><input id="mailAutoReply" type="checkbox"></div>
      <label class="duo-mail-setting-row"><span>自动回信等待</span><span><input id="mailReplyMin" type="number" min="1" max="1440" step="1" inputmode="numeric"> ～ <input id="mailReplyMax" type="number" min="1" max="1440" step="1" inputmode="numeric"> 分钟</span></label>
      <label class="duo-mail-setting-row"><span>每封信最少使用</span><span><input id="mailCardCountMin" type="number" min="1" max="10" step="1"> 张字卡</span></label>
      <label class="duo-mail-setting-row"><span>每封信最多使用</span><span><input id="mailCardCountMax" type="number" min="1" max="10" step="1"> 张字卡</span></label>
      <div id="mailSettingsError" class="duo-mail-settings-error" aria-live="polite"></div>
      <div class="duo-mail-settings-actions"><button type="button" id="mailSettingsSave" class="primary">保存</button><button type="button" id="mailSettingsDefault" class="mini-btn">恢复默认值</button><button type="button" id="mailSettingsCancel" class="mini-btn">取消</button></div>
    </section>`;
    // Keep the modal's single header as the only visible title; remove any legacy inner headings or helper copy.
    root.querySelectorAll('h1,h2,h3,h4,h5,h6,strong').forEach(node=>{if(node.textContent.trim()==='信箱设置')node.remove();});
    root.querySelectorAll('.data-note,.help-text,.hint,.code-help,p,small').forEach(node=>node.remove());
    syncSettings();return true;
  }
  function exportData(){return {mailbox:clone(box)};}
  function importData(raw){if(!raw||typeof raw!=='object')throw new Error('信件备份格式无效');const oldBox=clone(box);const source={...(raw.mailbox||raw)};delete source.drafts;delete source.draft;const next=normalize(source);box=next;try{if(box.settings.autoIncoming&&!box.nextIncomingAt)scheduleIncoming(false);persist();try{localStorage.removeItem(LEGACY_DRAFT_KEY);}catch(_){}syncSettings();return true;}catch(error){box=normalize(oldBox);throw error;}}
  function showPage(){activeTab='in';render();syncSettings();processDue();}
  window.__duoMailbox={exportData,importData,render,processDue,openCompose,openLetter,openSettings:openSettingsModal,closeSettings:closeSettingsModal,flushUsageOutbox,getReferencedMediaIds,mountSettings,pauseTasks(){tasksPaused=true;},resumeTasks(){tasksPaused=false;flushUsageOutbox();processDue();}};
  const style=document.createElement('style');style.textContent='.duo-mail-settings .data-note{margin:0 0 14px}.duo-mail-setting-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 12px;margin-top:9px;border:1px solid var(--line);border-radius:13px;background:var(--panel);font-size:13px;font-weight:700;color:var(--text)}.duo-mail-setting-row>span:last-child{display:flex;align-items:center;gap:6px;white-space:nowrap}.duo-mail-setting-row input{width:66px;min-width:0;min-height:36px;padding:7px 6px;border:1px solid var(--line);border-radius:10px;background:var(--soft);color:var(--text);text-align:center}.duo-mail-setting-row input[type=checkbox]{width:22px;height:22px;accent-color:var(--accent)}.duo-mail-settings .item-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 12px;margin-top:9px;border:1px solid var(--line);border-radius:13px;background:var(--panel);font-size:13px;font-weight:700}.duo-mail-settings .item-row input[type=checkbox]{width:22px;height:22px;accent-color:var(--accent)}.duo-mail-settings-actions{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:15px}.duo-mail-settings-actions #mailSettingsSave{grid-column:1/-1;grid-row:1;min-height:44px}.duo-mail-settings-actions button{min-height:42px}.duo-mail-settings-error{min-height:18px;color:#b94b4b;font-size:12px;padding-top:8px}@media(max-width:380px){.duo-mail-setting-row{align-items:flex-start;flex-direction:column}.duo-mail-setting-row>span:last-child{max-width:100%}}.mail-actions{display:flex;gap:8px;flex-wrap:wrap}.mail-tabs{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:8px 0 12px}.mail-tab{position:relative;min-height:42px;border:1px solid var(--line);border-radius:13px;background:var(--panel);color:var(--sub);font-weight:750}.mail-tab.active{border-color:var(--accent);color:var(--accent);background:var(--soft)}.mail-letter-row{display:flex;flex-direction:column;align-items:flex-start;gap:5px;width:100%;padding:13px;margin:8px 0;border:1px solid var(--line);border-radius:14px;background:var(--panel);color:var(--text);text-align:left}.mail-letter-row strong{font-size:15px}.mail-letter-row small,.mail-letter-type{color:var(--sub);font-size:11px}.mail-letter-row>span:last-child{font-size:13px;line-height:1.5;color:var(--sub)}.mail-empty{padding:25px 12px;text-align:center;color:var(--sub);font-size:13px}.mail-footer{position:sticky;bottom:0;padding:10px 0 calc(10px + env(safe-area-inset-bottom));background:var(--bg)}.mail-write{width:100%;min-height:48px;border:0;border-radius:14px;background:var(--accent);color:white;font-weight:800}.mail-modal{position:absolute;inset:0;z-index:var(--z-mail-modal,80);display:none;align-items:flex-end;background:#0006}.mail-modal.show{display:flex}.mail-settings-modal{align-items:center;justify-content:center;padding:18px}.mail-settings-modal .mail-sheet{width:min(360px,100%);max-height:88dvh;border:1px solid var(--line);border-radius:18px;padding:18px;box-shadow:0 14px 38px #0003}.mail-sheet{width:100%;max-height:88%;overflow:auto;padding:18px;border-radius:20px 20px 0 0;background:var(--panel);color:var(--text)}.mail-settings-modal .mail-sheet{border-radius:18px;background:var(--bg)}.mail-sheet input,.mail-sheet textarea{width:100%;margin:8px 0;padding:12px;border:1px solid var(--line);border-radius:10px;background:var(--soft);color:var(--text)}.mail-sheet textarea{min-height:220px;resize:vertical}.mail-read-content{white-space:pre-wrap;line-height:1.8;overflow-wrap:anywhere;padding:12px 0}.mail-image-grid{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.mail-image-thumb{position:relative;width:76px;height:76px;border-radius:10px;overflow:hidden;background:var(--soft);border:1px solid var(--line)}.mail-image-thumb img{width:100%;height:100%;object-fit:cover;display:block}.mail-image-thumb button{position:absolute;right:3px;top:3px;width:22px;height:22px;border:0;border-radius:50%;background:#0009;color:white}.mail-read-images{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));align-items:start;gap:10px;margin:12px 0}.mail-read-image{width:100%;max-width:560px;min-width:0;min-height:0;height:auto;border-radius:12px;overflow:hidden;background:var(--soft);display:flex;align-items:center;justify-content:center;color:var(--sub);font-size:12px}.mail-read-image img{display:block;width:auto;height:auto;max-width:100%;max-height:70vh;object-fit:contain}';document.head.appendChild(style);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('#mailSettingsModal')?.classList.contains('show'))closeSettingsModal();});
  document.addEventListener('click',e=>{if(e.target.closest('#mailSettingsBtn')){openSettingsModal();return;}const settingsModal=$('#mailSettingsModal');if(settingsModal&&e.target===settingsModal){closeSettingsModal();return;}if(e.target.closest('#mailComposeBtn')){openCompose();return;}const tab=e.target.closest('[data-mail-tab]');if(tab){activeTab=tab.dataset.mailTab==='out'?'out':'in';render();return;}if(e.target.closest('#mailComposeCancel')){closeCompose();return;}if(e.target.closest('#mailComposeSend'))send();if(e.target.closest('#mailImagePickBtn'))$('#mailImageInput')?.click();const imageDel=e.target.closest('[data-mail-image-remove]');if(imageDel)removeComposeImage(imageDel.dataset.mailImageRemove);if(e.target.closest('#mailReadClose'))closeRead();if(e.target.closest('#mailReplyBtn'))replyToCurrent();if(e.target.closest('#mailDeleteBtn')){const id=$('#mailReadModal')?.dataset.letterId;if(id)deleteLetter(id);}const row=e.target.closest('[data-mail-open]');if(row)openLetter(row.dataset.mailOpen);if(e.target.closest('#mailSettingsSave'))saveSettings();if(e.target.closest('#mailSettingsDefault'))restoreDefaultSettings();if(e.target.closest('#mailSettingsCancel')){closeSettingsModal();if(typeof showToast==='function')showToast('已恢复未保存的设置');}});
  document.addEventListener('change',e=>{if(e.target&&e.target.id==='mailImageInput')addImages(e.target.files);});
  document.addEventListener('click',e=>{if(e.target.closest('[data-go="mailPage"]'))setTimeout(showPage,0);});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)processDue();});window.addEventListener('focus',processDue);setInterval(()=>{if(!document.hidden)processDue();},15000);
  const settingsHost=$('#mailSettingsMount');
  if(settingsHost)mountSettings(settingsHost);
  if(box.settings.autoIncoming&&!box.nextIncomingAt){try{scheduleIncoming();}catch(error){showToast('自动来信计划保存失败：'+(error.message||error));}}
  syncSettings();
})();
