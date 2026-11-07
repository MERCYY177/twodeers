import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const cardSource = readFileSync(new URL('../card-system.js', import.meta.url), 'utf8');
const mailboxSource = readFileSync(new URL('../mailbox-manager.js', import.meta.url), 'utf8');
function makeStorage(){
  const values=new Map();
  return {getItem:key=>values.has(key)?values.get(key):null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key),_values:values};
}
function makeDocument(){
  return {head:{appendChild(){}},createElement(){return {textContent:'',style:{},appendChild(){}};},addEventListener(){},querySelector(){return null;},hidden:false};
}

test('card system preserves the legacy chat pool and keeps Circle pools separate',()=>{
  const storage=makeStorage();
  const circle={dynamicCards:['动态卡'],replyCards:['回复卡'],notificationsEnabled:true};
  const sandbox={
    state:{cardPhrases:['旧用户字卡A','旧用户字卡B']},
    window:{__duoCircleApi:{exportState:()=>JSON.parse(JSON.stringify(circle)),importState(next){Object.assign(circle,JSON.parse(JSON.stringify(next)));return true;}}},
    localStorage:storage,document:makeDocument(),escapeHtml:s=>String(s),setTimeout(){return 1;},console
  };
  vm.createContext(sandbox);vm.runInContext(cardSource,sandbox,{filename:'card-system.js'});
  const api=sandbox.window.__duoCardSystem;
  const before=api.exportData();
  assert.deepEqual(sandbox.state.cardPhrases,['旧用户字卡A','旧用户字卡B']);
  assert.equal(before.momentsDynamic[0],'动态卡');
  assert.equal(before.momentsReply[0],'回复卡');
  const stableId=api.getCardId('旧用户字卡B','chat');
  api.recordUsed('旧用户字卡B','chat',stableId);
  sandbox.state.cardPhrases.shift();
  assert.equal(api.getCardId('旧用户字卡B','chat'),stableId,'removing an earlier card must not change the remaining card ID');
  api.recordUsed('动态卡','moments-dynamic');
  api.recordUsed('回复卡','moments-reply');
  const after=api.exportData();
  assert.equal(after.recentDrawnRepliesV1.length,3);
  assert.ok(after.recentDrawnRepliesV1.every(x=>x.cardId&&x.textSnapshot));
  assert.equal(after.recentDrawnRepliesV1.find(x=>x.source==='moments-dynamic').textSnapshot,'动态卡');
  const countBeforePreview=after.recentDrawnRepliesV1.find(x=>x.source==='chat').count;
  api.draw('chat');
  assert.equal(api.getRecent().find(x=>x.source==='chat').count,countBeforePreview,'random preview must not count as actual use');
  api.confirmDraw('chat');
  assert.equal(api.getRecent().find(x=>x.source==='chat').count,countBeforePreview+1,'explicitly confirming use should update the history');
});

test('mailbox persists drafts, queues delayed replies and records card fragments',()=>{
  const storage=makeStorage();
  const now=Date.now();
  const sandbox={
    state:{cardPhrases:['自动回信字卡']},
    window:{addEventListener(){},__duoCardSystem:{pick:()=> '自动回信字卡',getCardId:()=> 'chat-card-1',recordUsed(){}}},
    localStorage:storage,document:makeDocument(),setInterval(){return 1;},showToast(){},console,Date,Math
  };
  vm.createContext(sandbox);vm.runInContext(mailboxSource,sandbox,{filename:'mailbox-manager.js'});
  const api=sandbox.window.__duoMailbox;
  api.importData({mailbox:{version:1,items:[{id:'out-1',type:'outgoing',title:'测试信',content:'你好',createdAt:now,read:true}],pending:[{id:'pending-1',type:'reply',sourceId:'out-1',due:now-1}],settings:{autoIncoming:false,autoReply:true}},drafts:[{id:'draft-1',title:'草稿标题',content:'草稿正文',updatedAt:now}]});
  api.processDue();
  const result=api.exportData();
  const reply=result.mailbox.items.find(x=>x.type==='incoming');
  assert.ok(reply,'due auto-reply task should create an incoming letter');
  assert.equal(reply.replyToId,'out-1');
  assert.equal(reply.content,'自动回信字卡');
  assert.equal(reply.cardFragments[0].cardId,'chat-card-1');
  assert.equal(result.mailbox.pending.length,0);
  assert.equal(result.drafts[0].content,'草稿正文');
  assert.ok(storage.getItem('twodeers_mailbox_letters_v1'));
  assert.ok(storage.getItem('twodeers_mailbox_drafts_v1'));
});


test('card usage outbox replays idempotently without double-counting',()=>{
  const storage=makeStorage();
  const state={cardPhrases:['待记录字卡'],cardUsageOutbox:[{eventId:'evt-chat-1',source:'chat',textSnapshot:'待记录字卡',cardId:'c-1',usedAt:12345}]};
  const circle={dynamicCards:[],replyCards:[],notificationsEnabled:true,usageOutbox:[]};
  const sandbox={state,window:{__duoCircleApi:{exportState:()=>circle,importState(next){Object.assign(circle,next);return true;},getUsageOutbox:()=>circle.usageOutbox,ackUsageOutbox(ids){circle.usageOutbox=circle.usageOutbox.filter(x=>!ids.includes(x.eventId));return true;}}},localStorage:storage,document:makeDocument(),escapeHtml:s=>String(s),setTimeout(){return 1;},console,save(){return true;},showToast(){}};
  vm.createContext(sandbox);vm.runInContext(cardSource,sandbox,{filename:'card-system.js'});
  const api=sandbox.window.__duoCardSystem;
  api.flushOutbox();
  assert.equal(state.cardUsageOutbox.length,0);
  assert.equal(api.getRecent().length,1);
  assert.equal(api.getRecent()[0].count,1);
  assert.equal(api.recordUsageEvent({eventId:'evt-chat-1',source:'chat',textSnapshot:'待记录字卡',cardId:'c-1',usedAt:12345}),true);
  assert.equal(api.getRecent()[0].count,1,'replayed event IDs must be deduplicated');
});

test('mailbox exposes image references from saved letters and drafts for shared media protection',()=>{
  const storage=makeStorage();
  const sandbox={state:{cardPhrases:[]},window:{addEventListener(){},__duoCardSystem:{recordUsageEvent(){return true;},getCardId(){return null;}}},localStorage:storage,document:makeDocument(),setInterval(){return 1;},showToast(){},console,Date,Math};
  vm.createContext(sandbox);vm.runInContext(mailboxSource,sandbox,{filename:'mailbox-manager.js'});
  const api=sandbox.window.__duoMailbox;
  api.importData({mailbox:{items:[{id:'letter-1',type:'outgoing',content:'含附件',images:[{id:'media-letter-1',name:'信件图.jpg',size:123}]}],pending:[],settings:{}},drafts:[{id:'draft-1',content:'草稿',images:[{id:'media-draft-1',name:'草稿图.png',size:456}]}]});
  const refs=api.getReferencedMediaIds();
  assert.equal(refs.has('media-letter-1'),true);
  assert.equal(refs.has('media-draft-1'),true);
  assert.equal(api.exportData().mailbox.items[0].images.length,1);
  assert.equal(api.exportData().drafts[0].images.length,1);
});

test('stable card IDs distinguish duplicate text by selected pool index', () => {
  const storage=makeStorage();
  const sandbox={
    state:{cardPhrases:['完全相同的文案','完全相同的文案']},
    window:{__duoCircleApi:{exportState:()=>({dynamicCards:[],replyCards:[],notificationsEnabled:true}),importState(){return true;}}},
    localStorage:storage,document:makeDocument(),escapeHtml:s=>String(s),setTimeout(){return 1;},console
  };
  vm.createContext(sandbox);vm.runInContext(cardSource,sandbox,{filename:'card-system.js'});
  const api=sandbox.window.__duoCardSystem;
  const first=api.getCardIdAt('chat',0),second=api.getCardIdAt('chat',1);
  assert.ok(first&&second);
  assert.notEqual(first,second,'identical text entries must retain separate stable IDs');
  assert.equal(api.getCardId('完全相同的文案','chat'),first,'legacy text lookup remains backward compatible');
});

test('mailbox attachment flow saves media ID into a draft, sends it with the letter, and preserves the reference', async () => {
  const storage=makeStorage(), media=new Map(), listeners={};
  const elements={
    '#mailComposeTitle':{value:'有图片的信'},
    '#mailComposeContent':{value:'正文内容',focus(){}},
    '#mailComposeModal':{classList:{add(){},remove(){}}},
    '#mailComposeImagesPreview':{innerHTML:''},
    '#mailImageHint':{textContent:''},
    '#mailImageInput':{value:''},
    '#mailLetterList':{innerHTML:''},
    '#mailUnreadCount':{textContent:''},
    '#mailDraftList':{innerHTML:''},
    '#mailReadModal':{dataset:{},_show:false,classList:{add(){this._show=true;},remove(){this._show=false;},contains(){return this._show;}}},
    '#mailReadImages':{innerHTML:'',children:[],appendChild(node){this.children.push(node);}},
    '#mailReadTitle':{textContent:''},
    '#mailReadMeta':{textContent:''},
    '#mailReadContent':{textContent:''},
    '#mailReplyBtn':{hidden:false},
    '#mailDeleteBtn':{hidden:false},
  };
  const document={
    head:{appendChild(){}},
    querySelector(selector){return elements[selector]||null;},
    createElement(tag){return {tagName:tag.toUpperCase(),className:'',textContent:'',alt:'',src:'',children:[],appendChild(node){this.children.push(node);}};},
    addEventListener(type,handler){(listeners[type] ||= []).push(handler);},
    hidden:false,
  };
  const sandbox={
    state:{cardPhrases:['写信字卡']},window:{addEventListener(){}},localStorage:storage,document,
    setInterval(){return 1;},showToast(){},console,Date,Math,
    URL:{createObjectURL:()=> 'blob:letter-image',revokeObjectURL(){}},
    async putMediaBlob(file,kind,name){const id='media-'+(media.size+1);media.set(id,{id,blob:file,kind,name,mimeType:file.type,createdAt:Date.now()});return id;},
    async getMediaRecord(id){return media.get(id)||null;},
    async deleteMediaRecord(id){media.delete(id);},
    window:{addEventListener(){},__duoCardSystem:{getCardIdAt:()=> 'card-letter-1',recordUsageEvent:()=>true}},
  };
  vm.createContext(sandbox);vm.runInContext(mailboxSource,sandbox,{filename:'mailbox-manager.js'});
  const api=sandbox.window.__duoMailbox;
  await api.openCompose();
  elements['#mailComposeContent'].value='正文内容';
  const file={name:'letter.png',type:'image/png',size:128,bytes:'image-binary'};
  for(const handler of listeners.change||[])handler({target:{id:'mailImageInput',files:[file],value:''}});
  await new Promise(resolve=>setTimeout(resolve,0));
  let exported=api.exportData();
  assert.equal(exported.drafts.length,1,'attaching an image creates a durable draft even before text exists');
  assert.equal(exported.drafts[0].images.length,1);
  const mediaId=exported.drafts[0].images[0].id;
  assert.equal(media.has(mediaId),true,'image Blob is stored in the shared media store');
  assert.match(elements['#mailComposeImagesPreview'].innerHTML,/blob:letter-image/,'new unsaved compose must render its attachment preview after saveDraft assigns a new ID');
  await api.openCompose(exported.drafts[0]);
  assert.match(elements['#mailComposeImagesPreview'].innerHTML,/blob:letter-image/);
  const sendTarget={closest(selector){return selector==='#mailComposeSend'?{}:null;}};
  for(const handler of listeners.click||[])handler({target:sendTarget});
  exported=api.exportData();
  assert.equal(exported.mailbox.items.length,1);
  assert.equal(exported.mailbox.items[0].images[0].id,mediaId);
  assert.equal(exported.drafts.length,0);
  assert.equal(api.getReferencedMediaIds().has(mediaId),true);
  await api.openLetter(exported.mailbox.items[0].id);
  assert.equal(elements['#mailReadImages'].children.length,1,'reading the letter loads its image attachment');
  assert.equal(elements['#mailReadContent'].textContent,'正文内容');
});


test('mailbox records only card fragments still present in the edited letter body', () => {
  const start=mailboxSource.indexOf('function reconcileComposeCardFragments(){');
  const end=mailboxSource.indexOf('  function insertCard(){',start);
  assert.ok(start>=0&&end>start);
  const fragmentSource=mailboxSource.slice(start,end);
  const sandbox={
    composeCardFragments:[{cardId:'card-a',textSnapshot:'保留的卡片'},{cardId:'card-b',textSnapshot:'被删除的卡片'}],
    clean:value=>String(value||'').trim().slice(0,12000),
    $: selector => selector==='#mailComposeContent' ? {value:'正文\n保留的卡片\n末尾'} : null
  };
  vm.createContext(sandbox);vm.runInContext(fragmentSource+'\nthis.reconcileComposeCardFragments=reconcileComposeCardFragments;',sandbox);
  sandbox.reconcileComposeCardFragments();
  assert.equal(sandbox.composeCardFragments.length,1);
  assert.equal(sandbox.composeCardFragments[0].cardId,'card-a');
});

test('mailbox image path enforces file limits and safely falls back when JPEG compression is unavailable', () => {
  assert.match(mailboxSource,/MAX_IMAGES=6,MAX_IMAGE_BYTES=8\*1024\*1024,MAX_TOTAL_IMAGE_BYTES=24\*1024\*1024/);
  assert.ok(mailboxSource.includes("/^image\\/(jpeg|png|webp|gif|avif)$/i"));
  assert.match(mailboxSource,/async function compressMailJpeg\(file\)/);
  assert.match(mailboxSource,/typeof createImageBitmap!=='function'\)return file/);
  assert.match(mailboxSource,/compressed&&compressed\.size>0&&compressed\.size<file\.size\?compressed:file/);
});

test('mail reading generation prevents an older letter attachment request from contaminating the newer letter', async () => {
  const storage=makeStorage(),listeners={},delays={A:40,B:2};
  let visible=false;
  const elements={
    '#mailLetterList':{innerHTML:''},'#mailUnreadCount':{textContent:''},'#mailAutoStatus':{textContent:''},'#mailDraftList':{innerHTML:''},
    '#mailReadModal':{dataset:{},classList:{add(){visible=true;},remove(){visible=false;},contains(){return visible;}}},
    '#mailReadTitle':{textContent:''},'#mailReadMeta':{textContent:''},'#mailReadContent':{textContent:''},
    '#mailReadImages':{_html:'',children:[],set innerHTML(v){this._html=v;this.children=[];},get innerHTML(){return this._html;},appendChild(node){this.children.push(node);}},
    '#mailReplyBtn':{hidden:false},'#mailDeleteBtn':{hidden:false}
  };
  const document={head:{appendChild(){}},querySelector:s=>elements[s]||null,createElement(tag){return {tagName:tag,className:'',textContent:'',appendChild(node){this.child=node;}};},addEventListener(type,fn){(listeners[type]||=[]).push(fn);},hidden:false};
  const sandbox={state:{cardPhrases:[]},window:{addEventListener(){}},localStorage:storage,document,setInterval(){return 1;},showToast(){},console,Date,Math,
    URL:{createObjectURL:blob=>'blob:'+blob.id,revokeObjectURL(){}},
    async getMediaRecord(id){await new Promise(resolve=>setTimeout(resolve,delays[id]));return {blob:{id},id};}};
  vm.createContext(sandbox);vm.runInContext(mailboxSource,sandbox,{filename:'mailbox-manager.js'});
  const api=sandbox.window.__duoMailbox;
  api.importData({mailbox:{items:[{id:'A',type:'incoming',title:'信A',content:'正文A',images:[{id:'A'}]},{id:'B',type:'incoming',title:'信B',content:'正文B',images:[{id:'B'}]}],pending:[],settings:{autoIncoming:false}},drafts:[]});
  const first=api.openLetter('A');await new Promise(resolve=>setTimeout(resolve,1));const second=api.openLetter('B');
  await Promise.all([first,second]);
  assert.equal(elements['#mailReadTitle'].textContent,'信B');
  assert.equal(elements['#mailReadModal'].dataset.letterId,'B');
  assert.equal(elements['#mailReadImages'].children.length,1);
  assert.equal(elements['#mailReadImages'].children[0].child.src,'blob:B');
});

test('draft image operation cannot attach its result to a different draft after switching', async () => {
  const storage=makeStorage(),listeners={},media=new Map();let release;
  const elements={
    '#mailComposeTitle':{value:'',focus(){}},'#mailComposeContent':{value:'',focus(){}},
    '#mailComposeModal':{classList:{add(){},remove(){}}},'#mailComposeImagesPreview':{innerHTML:''},'#mailImageHint':{textContent:''},'#mailImageInput':{value:''},
    '#mailLetterList':{innerHTML:''},'#mailUnreadCount':{textContent:''},'#mailAutoStatus':{textContent:''},'#mailDraftList':{innerHTML:''}
  };
  const document={head:{appendChild(){}},querySelector:s=>elements[s]||null,createElement(){return {style:{},textContent:''};},addEventListener(type,fn){(listeners[type]||=[]).push(fn);},hidden:false};
  const sandbox={state:{cardPhrases:[]},window:{addEventListener(){}},localStorage:storage,document,setInterval(){return 1;},showToast(){},console,Date,Math,
    URL:{createObjectURL:()=> 'blob:draft',revokeObjectURL(){}},
    putMediaBlob(file){return new Promise(resolve=>{release=()=>{media.set('new-image',{id:'new-image',blob:file});resolve('new-image');};});},
    async deleteMediaRecord(id){media.delete(id);},async getMediaRecord(id){return media.get(id)||null;}};
  vm.createContext(sandbox);vm.runInContext(mailboxSource,sandbox,{filename:'mailbox-manager.js'});
  const api=sandbox.window.__duoMailbox;
  api.importData({mailbox:{items:[],pending:[],settings:{autoIncoming:false}},drafts:[{id:'draft-A',title:'A',content:'A'},{id:'draft-B',title:'B',content:'B'}]});
  await api.openCompose(api.exportData().drafts[0]);
  const change=(listeners.change||[])[0];change({target:{id:'mailImageInput',files:[{name:'a.png',type:'image/png',size:100}],value:''}});
  await Promise.resolve();
  await api.openCompose(api.exportData().drafts[1]);
  release();await new Promise(resolve=>setTimeout(resolve,0));
  const result=api.exportData();
  assert.equal(result.drafts.find(x=>x.id==='draft-A').images.length,0);
  assert.equal(result.drafts.find(x=>x.id==='draft-B').images.length,0);
  assert.equal(media.has('new-image'),false,'stale media is garbage-collected instead of being attached to draft B');
});

test('mailbox usage outbox normalization does not silently discard events beyond 500', () => {
  const storage=makeStorage();
  const sandbox={state:{cardPhrases:[]},window:{addEventListener(){}},localStorage:storage,document:makeDocument(),setInterval(){return 1;},showToast(){},console,Date,Math};
  vm.createContext(sandbox);vm.runInContext(mailboxSource,sandbox,{filename:'mailbox-manager.js'});
  const events=Array.from({length:620},(_,i)=>({eventId:'e'+i,textSnapshot:'卡'+i,source:'mail'}));
  sandbox.window.__duoMailbox.importData({mailbox:{items:[],pending:[],usageOutbox:events,settings:{autoIncoming:false}},drafts:[]});
  assert.equal(sandbox.window.__duoMailbox.exportData().mailbox.usageOutbox.length,620);
});

test('draw and pick preserve the actual ID of the selected duplicate-text card', () => {
  const storage=makeStorage();
  const sandbox={state:{cardPhrases:['重复文案','重复文案']},window:{__duoCircleApi:{exportState:()=>({dynamicCards:[],replyCards:[],notificationsEnabled:true}),importState(){return true;}}},localStorage:storage,document:makeDocument(),escapeHtml:s=>String(s),setTimeout(){return 1;},console,Math:Object.assign(Object.create(Math),{random:(()=>{let i=0;return ()=>{i++;return i===1?0.1:i===2?0.9:0.95+i/1000;};})()}),Date};
  vm.createContext(sandbox);vm.runInContext(cardSource,sandbox,{filename:'card-system.js'});
  const api=sandbox.window.__duoCardSystem,second=api.getCardIdAt('chat',1);
  const preview=api.draw('chat');
  assert.equal(preview.text,'重复文案');assert.equal(preview.cardId,second);
  assert.equal(api.confirmDraw('chat'),true);
  api.pick('chat','chat-offline');
  const recent=api.getRecent().find(x=>x.source==='chat-offline');
  assert.equal(recent.cardId,second,'automatic pick must pass the selected pool index into usage recording');
});

test('recordUsageEvent catches reconciliation persistence failures and leaves the event retryable', () => {
  const values=new Map();let fail=false;
  const storage={getItem:key=>values.get(key)||null,setItem(key,value){if(fail)throw new Error('quota exceeded');values.set(key,String(value));},removeItem:key=>values.delete(key)};
  const sandbox={state:{cardPhrases:['原字卡']},window:{__duoCircleApi:{exportState:()=>({dynamicCards:[],replyCards:[],notificationsEnabled:true}),importState(){return true;}}},localStorage:storage,document:makeDocument(),escapeHtml:s=>String(s),setTimeout(){return 1;},console,showToast(){}};
  vm.createContext(sandbox);vm.runInContext(cardSource,sandbox,{filename:'card-system.js'});
  sandbox.state.cardPhrases.push('新增字卡');fail=true;
  assert.doesNotThrow(()=>assert.equal(sandbox.window.__duoCardSystem.recordUsageEvent({eventId:'retry-me',source:'chat',textSnapshot:'原字卡',cardId:'id-1'}),false));
});

test('card-system idempotency ledger import does not silently truncate old event IDs', () => {
  const storage=makeStorage();
  const sandbox={state:{cardPhrases:[]},window:{__duoCircleApi:{exportState:()=>({dynamicCards:[],replyCards:[],notificationsEnabled:true}),importState(){return true;}}},localStorage:storage,document:makeDocument(),escapeHtml:s=>String(s),setTimeout(){return 1;},console};
  vm.createContext(sandbox);vm.runInContext(cardSource,sandbox,{filename:'card-system.js'});
  const ids=Array.from({length:2105},(_,i)=>'event-'+i);
  sandbox.window.__duoCardSystem.importData({appliedEventIds:ids});
  assert.equal(sandbox.window.__duoCardSystem.exportData().appliedEventIds.length,2105);
});

test('rejecting an over-limit image selection does not leave the compose image lock stuck', async () => {
  const storage=makeStorage(),listeners={},media=new Map();let nextId=0;
  const elements={
    '#mailComposeTitle':{value:'',focus(){}},'#mailComposeContent':{value:'正文',focus(){}},
    '#mailComposeModal':{classList:{add(){},remove(){}}},'#mailComposeImagesPreview':{innerHTML:''},'#mailImageHint':{textContent:''},'#mailImageInput':{value:''},
    '#mailLetterList':{innerHTML:''},'#mailUnreadCount':{textContent:''},'#mailAutoStatus':{textContent:''},'#mailDraftList':{innerHTML:''}
  };
  const document={head:{appendChild(){}},querySelector:s=>elements[s]||null,createElement(){return {style:{},textContent:''};},addEventListener(type,fn){(listeners[type]||=[]).push(fn);},hidden:false};
  const sandbox={state:{cardPhrases:[]},window:{addEventListener(){}},localStorage:storage,document,setInterval(){return 1;},showToast(){},console,Date,Math,
    URL:{createObjectURL:()=> 'blob:image',revokeObjectURL(){}},
    async putMediaBlob(file){const id='image-'+(++nextId);media.set(id,{id,blob:file});return id;},
    async deleteMediaRecord(id){media.delete(id);},async getMediaRecord(id){return media.get(id)||null;}};
  vm.createContext(sandbox);vm.runInContext(mailboxSource,sandbox,{filename:'mailbox-manager.js'});
  const api=sandbox.window.__duoMailbox;
  api.importData({mailbox:{items:[],pending:[],settings:{autoIncoming:false}},drafts:[]});
  await api.openCompose();
  const change=(files)=>{for(const handler of listeners.change||[])handler({target:{id:'mailImageInput',files,value:''}});};
  const seven=Array.from({length:7},(_,i)=>({name:'over-'+i+'.png',type:'image/png',size:10}));
  change(seven);
  await new Promise(resolve=>setTimeout(resolve,0));
  change([{name:'valid.png',type:'image/png',size:10}]);
  await new Promise(resolve=>setTimeout(resolve,0));
  const result=api.exportData();
  assert.equal(result.drafts.length,1);
  assert.equal(result.drafts[0].images.length,1,'a valid follow-up upload must work after an over-limit selection');
  assert.equal(media.size,1,'the valid follow-up image should be stored exactly once');
  assert.equal(elements['#mailImageInput'].value,'');
});

test('card usage records retain message, letter, and source provenance', () => {
  const storage=makeStorage();
  const sandbox={state:{cardPhrases:['有来源的字卡']},window:{__duoCircleApi:{exportState:()=>({dynamicCards:[],replyCards:[],notificationsEnabled:true}),importState(){return true;}}},localStorage:storage,document:makeDocument(),escapeHtml:s=>String(s),setTimeout(){return 1;},console};
  vm.createContext(sandbox);vm.runInContext(cardSource,sandbox,{filename:'card-system.js'});
  const api=sandbox.window.__duoCardSystem;
  assert.equal(api.recordUsageEvent({eventId:'trace-chat',source:'chat',textSnapshot:'有来源的字卡',messageId:'message-7',sourceId:'message-7'}),true);
  assert.equal(api.recordUsageEvent({eventId:'trace-mail',source:'mail',textSnapshot:'有来源的字卡',letterId:'letter-8',sourceId:'letter-7'}),true);
  assert.equal(api.recordUsageEvent({eventId:'trace-circle',source:'moments-dynamic',textSnapshot:'有来源的字卡',postId:'post-9',sourceId:'post-9'}),true);
  const rows=api.getRecent();
  assert.equal(rows.find(x=>x.source==='chat').messageId,'message-7');
  assert.equal(rows.find(x=>x.source==='mail').letterId,'letter-8');
  assert.equal(rows.find(x=>x.source==='mail').sourceId,'letter-7');
  assert.equal(rows.find(x=>x.source==='moments-dynamic').postId,'post-9');
});

test('card system applies explicit backpressure instead of growing the idempotency ledger without bound', () => {
  const storage=makeStorage(),toasts=[];
  const sandbox={state:{cardPhrases:['字卡']},window:{__duoCircleApi:{exportState:()=>({dynamicCards:[],replyCards:[],notificationsEnabled:true}),importState(){return true;}}},localStorage:storage,document:makeDocument(),escapeHtml:s=>String(s),setTimeout(){return 1;},console,showToast:m=>toasts.push(m)};
  vm.createContext(sandbox);vm.runInContext(cardSource,sandbox,{filename:'card-system.js'});
  const api=sandbox.window.__duoCardSystem;
  const ids=Array.from({length:10000},(_,i)=>'retained-event-'+i);
  api.importData({appliedEventIds:ids});
  assert.equal(api.recordUsageEvent({eventId:'must-wait',source:'chat',textSnapshot:'字卡'}),false);
  assert.equal(api.exportData().appliedEventIds.length,10000);
  assert.ok(toasts.some(x=>/安全容量上限/.test(x)));
});

test('mailbox send applies explicit backpressure at the usage outbox limit and keeps the draft', () => {
  const storage=makeStorage(),listeners={};
  const elements={
    '#mailComposeTitle':{value:'待寄出',focus(){}},'#mailComposeContent':{value:'正文含字卡',focus(){}},
    '#mailComposeModal':{classList:{add(){},remove(){}}},'#mailComposeImagesPreview':{innerHTML:''},'#mailImageHint':{textContent:''},'#mailImageInput':{value:''},
    '#mailLetterList':{innerHTML:''},'#mailUnreadCount':{textContent:''},'#mailAutoStatus':{textContent:''},'#mailDraftList':{innerHTML:''}
  };
  const document={head:{appendChild(){}},querySelector:s=>elements[s]||null,createElement(){return {style:{},textContent:''};},addEventListener(type,fn){(listeners[type]||=[]).push(fn);},hidden:false};
  const sandbox={state:{cardPhrases:[]},window:{addEventListener(){}},localStorage:storage,document,setInterval(){return 1;},showToast(){},console,Date,Math};
  vm.createContext(sandbox);vm.runInContext(mailboxSource,sandbox,{filename:'mailbox-manager.js'});
  const api=sandbox.window.__duoMailbox;
  const outbox=Array.from({length:1000},(_,i)=>({eventId:'mail-old-'+i,textSnapshot:'旧记录'+i,source:'mail'}));
  api.importData({mailbox:{items:[],pending:[],usageOutbox:outbox,settings:{autoIncoming:false,autoReply:false}},drafts:[{id:'draft-with-card',title:'待寄出',content:'正文含字卡',cardFragments:[{cardId:'card-1',textSnapshot:'字卡'}]}]});
  api.openCompose(api.exportData().drafts[0]);
  const target={closest(selector){return selector==='#mailComposeSend'?{}:null;}};
  for(const handler of listeners.click||[])handler({target});
  const result=api.exportData();
  assert.equal(result.mailbox.items.length,0,'a letter requiring an outbox event must not be sent without durable queue capacity');
  assert.equal(result.mailbox.usageOutbox.length,1000,'all previously queued events must remain intact');
  assert.equal(result.drafts.length,1,'the unsent draft must remain available for retry');
});

test('closing a letter revokes its no-longer-visible Blob URL', async () => {
  const storage=makeStorage(),listeners={},revoked=[],created=[];let visible=false;
  const elements={
    '#mailLetterList':{innerHTML:''},'#mailUnreadCount':{textContent:''},'#mailAutoStatus':{textContent:''},'#mailDraftList':{innerHTML:''},
    '#mailReadModal':{dataset:{},classList:{add(){visible=true;},remove(){visible=false;},contains(){return visible;}}},
    '#mailReadImages':{innerHTML:'',children:[],appendChild(node){this.children.push(node);}},
    '#mailReadTitle':{textContent:''},'#mailReadMeta':{textContent:''},'#mailReadContent':{textContent:''},'#mailReplyBtn':{hidden:false},'#mailDeleteBtn':{hidden:false}
  };
  const document={head:{appendChild(){}},querySelector:s=>elements[s]||null,createElement(){return {className:'',children:[],appendChild(node){this.children.push(node);}};},addEventListener(type,fn){(listeners[type]||=[]).push(fn);},hidden:false};
  const sandbox={state:{cardPhrases:[]},window:{addEventListener(){}},localStorage:storage,document,setInterval(){return 1;},showToast(){},console,Date,Math,
    URL:{createObjectURL(){const url='blob:letter-'+created.length;created.push(url);return url;},revokeObjectURL(url){revoked.push(url);}},
    async getMediaRecord(id){return {id,blob:{id}};}};
  vm.createContext(sandbox);vm.runInContext(mailboxSource,sandbox,{filename:'mailbox-manager.js'});
  const api=sandbox.window.__duoMailbox;
  api.importData({mailbox:{items:[{id:'letter-blob',type:'incoming',title:'图片信',content:'正文',images:[{id:'media-blob'}]}],pending:[],settings:{autoIncoming:false}},drafts:[]});
  await api.openLetter('letter-blob');
  assert.equal(created.length,1);
  const target={closest(selector){return selector==='#mailReadClose'?{}:null;}};
  for(const handler of listeners.click||[])handler({target});
  assert.deepEqual(revoked,['blob:letter-0']);
  assert.equal(elements['#mailReadImages'].innerHTML,'');
});

test('saving a new draft cleans media belonging only to the draft evicted by the 50-draft limit', async () => {
  const storage=makeStorage(),listeners={},media=new Map([['evicted-media',{id:'evicted-media',blob:{size:12}}]]);
  const elements={
    '#mailComposeTitle':{value:'',focus(){}},'#mailComposeContent':{value:'',focus(){}},'#mailComposeModal':{classList:{add(){},remove(){}}},
    '#mailComposeImagesPreview':{innerHTML:''},'#mailImageHint':{textContent:''},'#mailImageInput':{value:''},
    '#mailLetterList':{innerHTML:''},'#mailUnreadCount':{textContent:''},'#mailAutoStatus':{textContent:''},'#mailDraftList':{innerHTML:''}
  };
  const document={head:{appendChild(){}},querySelector:s=>elements[s]||null,createElement(){return {style:{},textContent:''};},addEventListener(type,fn){(listeners[type]||=[]).push(fn);},hidden:false};
  const sandbox={state:{cardPhrases:[]},window:{addEventListener(){}},localStorage:storage,document,setInterval(){return 1;},showToast(){},console,Date,Math,
    async getMediaRecord(id){return media.get(id)||null;},async deleteMediaRecord(id){media.delete(id);}};
  vm.createContext(sandbox);vm.runInContext(mailboxSource,sandbox,{filename:'mailbox-manager.js'});
  const api=sandbox.window.__duoMailbox;
  const drafts=Array.from({length:50},(_,i)=>({id:'draft-'+i,title:'草稿'+i,content:'正文',updatedAt:1000-i,images:i===49?[{id:'evicted-media',name:'旧图',size:12,mimeType:'image/png'}]:[]}));
  api.importData({mailbox:{items:[],pending:[],settings:{autoIncoming:false}},drafts});
  await api.openCompose();
  elements['#mailComposeContent'].value='新草稿正文';
  for(const handler of listeners.input||[])handler({target:{matches:()=>true}});
  await new Promise(resolve=>setTimeout(resolve,0));
  const result=api.exportData();
  assert.equal(result.drafts.length,50);
  assert.equal(result.drafts.some(x=>x.id==='draft-49'),false);
  assert.equal(media.has('evicted-media'),false,'unreferenced attachment media must be deleted after successful draft eviction');
});

test('mailbox auto-reply tasks remain queued when the usage outbox is full and resume after capacity returns', () => {
  const storage=makeStorage(),toasts=[];
  const sandbox={state:{cardPhrases:['自动回信字卡']},window:{addEventListener(){}},localStorage:storage,document:makeDocument(),setInterval(){return 1;},showToast:m=>toasts.push(m),console,Date,Math};
  vm.createContext(sandbox);vm.runInContext(mailboxSource,sandbox,{filename:'mailbox-manager.js'});
  const api=sandbox.window.__duoMailbox;
  const outbox=Array.from({length:1000},(_,i)=>({eventId:'old-'+i,textSnapshot:'旧字卡'+i,source:'mail'}));
  api.importData({mailbox:{items:[{id:'source-letter',type:'outgoing',title:'原信',content:'正文',createdAt:1,read:true}],pending:[{id:'reply-task',type:'reply',sourceId:'source-letter',due:1}],usageOutbox:outbox,settings:{autoIncoming:false,autoReply:true}},drafts:[]});
  api.processDue();
  let result=api.exportData();
  assert.equal(result.mailbox.pending.length,1);
  assert.equal(result.mailbox.items.length,1);
  assert.equal(result.mailbox.usageOutbox.length,1000);
  assert.ok(toasts.some(x=>/队列已满/.test(x)));
  result.mailbox.usageOutbox=[];
  api.importData(result);
  api.processDue();
  result=api.exportData();
  assert.equal(result.mailbox.pending.length,0);
  assert.equal(result.mailbox.items.length,2);
  assert.equal(result.mailbox.usageOutbox.length,1);
  assert.equal(result.mailbox.usageOutbox[0].letterId,result.mailbox.items[1].id);
});

test('mailbox letter retention limit cleans media for the oldest evicted letter after commit', () => {
  const storage=makeStorage(),media=new Map([['old-letter-media',{id:'old-letter-media',blob:{size:16}}]]);
  const sandbox={state:{cardPhrases:[]},window:{addEventListener(){}},localStorage:storage,document:makeDocument(),setInterval(){return 1;},showToast(){},console,Date,Math,
    async getMediaRecord(id){return media.get(id)||null;},async deleteMediaRecord(id){media.delete(id);}};
  vm.createContext(sandbox);vm.runInContext(mailboxSource,sandbox,{filename:'mailbox-manager.js'});
  const api=sandbox.window.__duoMailbox;
  const items=Array.from({length:5000},(_,i)=>({id:'letter-'+i,type:'outgoing',title:'信'+i,content:'正文',createdAt:i+1,read:true,images:i===0?[{id:'old-letter-media',name:'旧图',size:16,mimeType:'image/png'}]:[]}));
  api.importData({mailbox:{items,pending:[{id:'due-reply',type:'reply',sourceId:'letter-4999',due:1}],settings:{autoIncoming:false,autoReply:true}},drafts:[]});
  api.processDue();
  const result=api.exportData();
  assert.equal(result.mailbox.items.length,5000);
  assert.equal(result.mailbox.items.some(x=>x.id==='letter-0'),false);
  assert.equal(result.mailbox.items.some(x=>x.type==='incoming'),true);
  assert.equal(media.has('old-letter-media'),false,'media referenced only by the evicted letter must be collected after the new mailbox state commits');
});

test('automatic letters use a unique random selection within the configured card-count bounds',()=>{
  const storage=makeStorage(),usage=[];
  const now=Date.now();
  const sandbox={
    state:{cardPhrases:['卡片一','卡片二','卡片三','卡片四','卡片五']},
    window:{addEventListener(){},__duoCardSystem:{
      getCardIdAt:(pool,index)=>'chat-card-'+index,
      getCardId:(text)=>'chat-card-'+text,
      recordUsageEvent(event){usage.push(event);return true;}
    }},
    localStorage:storage,document:makeDocument(),setInterval(){return 1;},
    showToast(){},console,Date,Math
  };
  vm.createContext(sandbox);vm.runInContext(mailboxSource,sandbox,{filename:'mailbox-manager.js'});
  const api=sandbox.window.__duoMailbox;
  api.importData({mailbox:{
    items:[{id:'out-multi',type:'outgoing',title:'多字卡来信',content:'正文',createdAt:now,read:true}],
    pending:[{id:'pending-multi',type:'reply',sourceId:'out-multi',due:now-1}],
    settings:{autoIncoming:false,autoReply:true,cardCountMin:3,cardCountMax:4}
  },drafts:[]});
  api.processDue();
  const data=api.exportData(),letter=data.mailbox.items.find(item=>item.type==='incoming');
  assert.ok(letter,'due automatic reply should create an incoming letter');
  assert.ok(letter.cardFragments.length>=3&&letter.cardFragments.length<=4,'selected card count must be within configured bounds');
  assert.equal(letter.cardFragments.length,new Set(letter.cardFragments.map(item=>item.cardId)).size,'one letter must not repeat a stable card ID');
  assert.equal(letter.content,letter.cardFragments.map(item=>item.textSnapshot).join('\\n'),'letter text must preserve all selected card snapshots in order');
  assert.equal(usage.length,letter.cardFragments.length,'every selected card must produce one durable usage event');
  assert.ok(usage.every(event=>event.letterId===letter.id&&event.source==='mail-auto-reply'));
  assert.equal(data.mailbox.pending.length,0);
});

test('mail settings form mounts all required fields without changing pending letter data',()=>{
  const storage=makeStorage(),now=Date.now();
  const sandbox={
    state:{cardPhrases:[]},
    window:{addEventListener(){},__duoCardSystem:{recordUsageEvent(){return true;}}},
    localStorage:storage,document:makeDocument(),setInterval(){return 1;},
    showToast(){},console,Date,Math
  };
  vm.createContext(sandbox);vm.runInContext(mailboxSource,sandbox,{filename:'mailbox-manager.js'});
  const api=sandbox.window.__duoMailbox,root={innerHTML:''};
  api.importData({mailbox:{
    items:[{id:'out-settings',type:'outgoing',title:'现有信件',content:'保持原样',createdAt:now,read:true}],
    pending:[{id:'pending-settings',type:'reply',sourceId:'out-settings',due:now+60000}],
    settings:{autoIncoming:false,autoReply:true,minIncomingMin:120,maxIncomingMin:240,minReplyMin:5,maxReplyMin:10,cardCountMin:2,cardCountMax:3}
  },drafts:[]});
  assert.equal(api.mountSettings(root),true);
  for(const id of ['mailAutoIncoming','mailIncomingMin','mailIncomingMax','mailAutoReply','mailReplyMin','mailReplyMax','mailCardCountMin','mailCardCountMax','mailSettingsSave','mailSettingsDefault','mailSettingsCancel']) {
    assert.ok(root.innerHTML.includes('id="'+id+'"'),'settings form must include '+id);
  }
  const after=api.exportData();
  assert.equal(after.mailbox.pending[0].id,'pending-settings','mounting settings must preserve queued replies');
  assert.equal(after.mailbox.items[0].content,'保持原样','mounting settings must not rewrite existing letters');
  assert.equal(after.mailbox.settings.cardCountMin,2);
  assert.equal(after.mailbox.settings.cardCountMax,3);
});
