import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mailboxSource = fs.readFileSync(path.join(ROOT, 'mailbox-manager.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function extract(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `missing source function: ${signature}`);
  const brace = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false, lineComment = false, blockComment = false;
  for (let i = brace; i < source.length; i++) {
    const c = source[i], n = source[i + 1];
    if (lineComment) { if (c === '\n') lineComment = false; continue; }
    if (blockComment) { if (c === '*' && n === '/') { blockComment = false; i++; } continue; }
    if (quote) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === quote) quote = ''; continue; }
    if (c === '/' && n === '/') { lineComment = true; i++; continue; }
    if (c === '/' && n === '*') { blockComment = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated function: ${signature}`);
}

const cleanFn = extract(mailboxSource, 'const clean=s=>');
const normalizeImagesFn = extract(mailboxSource, 'function normalizeImages(images){');
const addImagesFn = extract(mailboxSource, 'async function addImages(files){');
const getRefsFn = extract(mailboxSource, 'function getReferencedMediaIds(){');
const sendFn = extract(mailboxSource, 'async function send(){');

function mailboxHarness({ persistResult = true, mediaRecords = {}, addMediaImpl, getMediaImpl, composeGeneration = 1 } = {}) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', disabled: false, attrs: {}, textContent: '', innerHTML: '', dataset: {},
      classList: { contains: name => name === 'show' && id === 'mailComposeModal' && modalOpen, add() {}, remove() {} },
      setAttribute(k,v){ this.attrs[k]=v; }, removeAttribute(k){ delete this.attrs[k]; }, focus() {}
    });
    return elements.get(id);
  };
  let modalOpen = true;
  const box = { items: [], pending: [], usageOutbox: [], recentCardKeys: [], nextIncomingAt: 0,
    settings: { autoReply: false, autoIncoming: false, minReplyMin: 2, maxReplyMin: 15, minIncomingMin: 720, maxIncomingMin: 2160, cardCountMin: 2, cardCountMax: 4 } };
  const h = {
    box, elements, activeComposeImages: [{ id: 'mail-media-1', name: 'attach.png', mimeType: 'image/png', size: 4, order: 0 }],
    pendingComposeMediaIds: new Set(), toasts: [], deleted: [], revoked: [], stored: [], persistCalls: 0,
    mutationBegins: 0, mutationEnds: 0, sending: false, modalOpen: true,
    generation: composeGeneration, adding: false, activeTab: 'in', replyToId: null,
    mediaRecords: { 'mail-media-1': { blob: new Blob([new Uint8Array([1,2,3,4])], { type:'image/png' }), size:4 }, ...mediaRecords },
    element
  };
  const source = `
    const MAX_IMAGES=6,MAX_COMPOSE_IMAGES=4,MAX_IMAGE_BYTES=8*1024*1024,MAX_TOTAL_IMAGE_BYTES=24*1024*1024;
    let box=globalThis.h.box,activeComposeImages=globalThis.h.activeComposeImages,activeReplyToId=globalThis.h.replyToId;
    let composeGeneration=globalThis.h.generation,addingComposeImages=globalThis.h.adding,sendingLetter=false,activeTab=globalThis.h.activeTab;
    const pendingComposeMediaIds=globalThis.h.pendingComposeMediaIds;
    const defaults={settings:{autoIncoming:true,autoReply:true,minIncomingMin:720,maxIncomingMin:2160,minReplyMin:2,maxReplyMin:15,cardCountMin:2,cardCountMax:4}};
    const clean=${cleanFn.slice(cleanFn.indexOf('s=>'))};
    ${normalizeImagesFn}
    function $(selector){return globalThis.h.element(selector.slice(1));}
    const modal=$('#mailComposeModal');
    function clone(v){return JSON.parse(JSON.stringify(v));}
    function showToast(v){globalThis.h.toasts.push(String(v));}
    function random(a,b){return Math.max(1,Number(a)||1);}
    function uid(){return 'pending-'+(globalThis.h.box.pending.length+1);}
    function makeLetter(type,title,content,extra={}){return {id:'letter-'+(box.items.length+1),type,title,content,createdAt:1,read:type!=='incoming',replyToId:extra.replyToId||null,images:normalizeImages(extra.images),cardFragments:[]};}
    function persist(){globalThis.h.persistCalls++;if(globalThis.h.persistResult!==true)return false;globalThis.h.stored.push(clone(box));return true;}
    async function getMediaRecord(id){if(globalThis.h.getMediaImpl)return globalThis.h.getMediaImpl(id);return globalThis.h.mediaRecords[id]||null;}
    function closeCompose(){composeGeneration++;globalThis.h.generation=composeGeneration;globalThis.h.modalOpen=false;modalOpen=false;modal.classList.remove('show');activeComposeImages=[];globalThis.h.activeComposeImages=activeComposeImages;}
    const window={__duoRuntimeCoordinator:{beginMutation(){globalThis.h.mutationBegins++;return ()=>globalThis.h.mutationEnds++;}}};
    ${getRefsFn}
    ${sendFn}
    globalThis.runSend=send;
    globalThis.state=()=>({box,activeComposeImages,composeGeneration,sendingLetter,activeTab,refs:[...getReferencedMediaIds()]});
  `;
  // The modal getter in its classList closure reads this lexical flag.
  vm.runInNewContext(source.replace('const modal=$(\'#mailComposeModal\');', 'const modal=$(\'#mailComposeModal\');'), { h, Blob, console, setTimeout, clearTimeout });
  return h;
}

// The mailbox's real addImages() must protect newly written Blob IDs while asynchronous attachment creation is pending.
{
  let releaseSecondPut; let putCalls=0;
  const h = { box:{items:[]}, activeComposeImages:[], pendingComposeMediaIds:new Set(), generation:1, adding:false,
    stored:[], deleted:[], toasts:[], mutationBegins:0, mutationEnds:0,
    putMediaImpl: async file => { putCalls++; if(putCalls===2) await new Promise(resolve => { releaseSecondPut=resolve; }); return putCalls===1?'mail-pending-1':'mail-pending-2'; },
    persistResult:true };
  const source = `
    const MAX_IMAGES=6,MAX_COMPOSE_IMAGES=4,MAX_IMAGE_BYTES=8*1024*1024,MAX_TOTAL_IMAGE_BYTES=24*1024*1024;
    let activeComposeImages=globalThis.h.activeComposeImages,composeGeneration=globalThis.h.generation,addingComposeImages=false,sendingLetter=false;
    const pendingComposeMediaIds=globalThis.h.pendingComposeMediaIds;
    function showToast(x){globalThis.h.toasts.push(String(x));}
    function normalizeImages(x){return Array.isArray(x)?x:[];}
    async function putMediaBlob(file){return globalThis.h.putMediaImpl(file);}
    async function renderComposeImages(){}
    function $(s){return s==='#mailImageInput'?{value:''}:null;}
    function revokeImageUrl(id){globalThis.h.revoked??=[];globalThis.h.revoked.push(id);}
    async function deleteIfUnreferenced(id){globalThis.h.deleted.push(id);return true;}
    function getReferencedMediaIds(){const ids=new Set(activeComposeImages.map(x=>x.id));for(const id of pendingComposeMediaIds)ids.add(id);return ids;}
    const window={__duoRuntimeCoordinator:{beginMutation(){globalThis.h.mutationBegins++;return ()=>globalThis.h.mutationEnds++;}}};
    ${addImagesFn}
    globalThis.add=addImages;globalThis.refs=getReferencedMediaIds;globalThis.cancel=()=>{composeGeneration++;globalThis.h.generation=composeGeneration;};
    globalThis.snapshot=()=>({activeComposeImages,pending:[...pendingComposeMediaIds],addingComposeImages});
  `;
  const ctx={h,Blob,console}; vm.runInNewContext(source,ctx);
  const promise=ctx.add([{name:'letter.png',type:'image/png',size:4},{name:'letter-2.png',type:'image/png',size:4}]);
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual([...ctx.refs()],['mail-pending-1'],'first pending attachment must be globally visible while the next attachment is still being written');
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.snapshot().pending)),['mail-pending-1']);
  releaseSecondPut(); await promise;
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.snapshot().activeComposeImages.map(x=>x.id))),['mail-pending-1','mail-pending-2']);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.snapshot().pending)),[]);
  assert.equal(h.mutationBegins,1); assert.equal(h.mutationEnds,1);
}

// Sending an outgoing letter verifies every attachment Blob and commits the letter atomically.
{
  const h=mailboxHarness();
  h.persistResult=true;
  const ctxSource = `globalThis.h.persistResult=true;`;
  // Add the persistence contract to the harness context after evaluating through a fresh closure.
  const elements = h.elements;
  h.element('#mailComposeTitle').value='相册记录';
  h.element('#mailComposeContent').value='这是带附件的信件';
  h.element('#mailComposeModal');
  h.element('#mailComposeSend');
  // Rebuild the actual send closure with the required persistence result.
  let context;
  const source = `
    const MAX_IMAGES=6,MAX_COMPOSE_IMAGES=4,MAX_IMAGE_BYTES=8*1024*1024,MAX_TOTAL_IMAGE_BYTES=24*1024*1024;
    let box=globalThis.h.box,activeComposeImages=globalThis.h.activeComposeImages,activeReplyToId=null,composeGeneration=1,addingComposeImages=false,sendingLetter=false,activeTab='in';
    const clean=${cleanFn.slice(cleanFn.indexOf('s=>'))};${normalizeImagesFn}
    function $(s){return globalThis.h.element(s.slice(1));}function clone(v){return JSON.parse(JSON.stringify(v));}
    function showToast(v){globalThis.h.toasts.push(String(v));}function random(a,b){return 2;}function uid(){return 'pending-new';}
    function makeLetter(type,title,content,extra={}){return {id:'letter-new',type,title,content,createdAt:10,read:true,replyToId:extra.replyToId||null,images:normalizeImages(extra.images),cardFragments:[]};}
    function persist(){globalThis.h.persistCalls++;if(!globalThis.h.persistResult) return false;globalThis.h.stored.push(clone(box));return true;}
    async function getMediaRecord(id){return globalThis.h.mediaRecords[id]||null;}
    function closeCompose(){composeGeneration++;globalThis.h.modalOpen=false;activeComposeImages=[];globalThis.h.activeComposeImages=[];}
    const window={__duoRuntimeCoordinator:{beginMutation(){globalThis.h.mutationBegins++;return ()=>globalThis.h.mutationEnds++;}}};
    ${sendFn}
    globalThis.run=send;globalThis.snapshot=()=>({items:box.items,stored:globalThis.h.stored,activeComposeImages,sendingLetter,mutationBegins:globalThis.h.mutationBegins,mutationEnds:globalThis.h.mutationEnds,buttonDisabled:$('#mailComposeSend').disabled,buttonBusy:$('#mailComposeSend').attrs['aria-busy'],toasts:globalThis.h.toasts});
  `;
  context={h,Blob,console};vm.runInNewContext(source,context);
  assert.equal(await context.run(),true);
  const result=context.snapshot();
  assert.equal(result.items.length,1);assert.equal(result.items[0].type,'outgoing');
  assert.equal(result.items[0].images[0].id,'mail-media-1');
  assert.equal(result.stored.length,1);assert.equal(result.sendingLetter,false);
  assert.equal(result.buttonDisabled,false);assert.equal(result.buttonBusy,undefined);
  assert.equal(result.mutationBegins,1);assert.equal(result.mutationEnds,1);
}

// A missing or mismatched attachment must block sending without persisting dangling IDs.
for (const scenario of [
  { name:'missing blob', record:null },
  { name:'wrong mime', record:{blob:new Blob(['x'],{type:'text/plain'}),size:1} },
  { name:'wrong size', record:{blob:new Blob(['x'],{type:'image/png'}),size:1} }
]) {
  const h=mailboxHarness({mediaRecords:{'mail-media-1':scenario.record}});
  const source=`
    const MAX_IMAGES=6,MAX_COMPOSE_IMAGES=4,MAX_IMAGE_BYTES=8*1024*1024,MAX_TOTAL_IMAGE_BYTES=24*1024*1024;
    let box=globalThis.h.box,activeComposeImages=globalThis.h.activeComposeImages,activeReplyToId=null,composeGeneration=1,addingComposeImages=false,sendingLetter=false,activeTab='in';
    const clean=${cleanFn.slice(cleanFn.indexOf('s=>'))};${normalizeImagesFn}
    function $(s){return globalThis.h.element(s.slice(1));}function clone(v){return JSON.parse(JSON.stringify(v));}function showToast(v){globalThis.h.toasts.push(String(v));}
    function persist(){globalThis.h.persistCalls++;return true;}function makeLetter(){throw new Error('must not create a letter');}function random(a){return a;}function uid(){return 'x';}async function getMediaRecord(id){return globalThis.h.mediaRecords[id]||null;}function closeCompose(){}
    const window={__duoRuntimeCoordinator:{beginMutation(){return ()=>{};}}};${sendFn}globalThis.run=send;
  `;
  const ctx={h,Blob};vm.runInNewContext(source,ctx);
  assert.equal(await ctx.run(),false,scenario.name);
  assert.equal(h.box.items.length,0,scenario.name);
  assert.equal(h.persistCalls,0,scenario.name);
  assert.equal(h.modalOpen,true,scenario.name);
  assert.ok(h.toasts.length>0,scenario.name);
}

// Closing the composer while the Blob read is pending must invalidate the send before it writes a letter.
{
  const h=mailboxHarness();let release;
  h.getMediaImpl=async()=>{await new Promise(resolve=>{release=resolve;});return h.mediaRecords['mail-media-1'];};
  const source=`
    const MAX_IMAGES=6,MAX_COMPOSE_IMAGES=4,MAX_IMAGE_BYTES=8*1024*1024,MAX_TOTAL_IMAGE_BYTES=24*1024*1024;let box=globalThis.h.box,activeComposeImages=globalThis.h.activeComposeImages,activeReplyToId=null,composeGeneration=1,addingComposeImages=false,sendingLetter=false,activeTab='in';
    const clean=${cleanFn.slice(cleanFn.indexOf('s=>'))};${normalizeImagesFn}function $(s){return globalThis.h.element(s.slice(1));}function clone(v){return JSON.parse(JSON.stringify(v));}function showToast(v){globalThis.h.toasts.push(String(v));}function persist(){globalThis.h.persistCalls++;return true;}function makeLetter(){return {id:'bad'};}function random(a){return a;}function uid(){return 'x';}async function getMediaRecord(id){return globalThis.h.getMediaImpl(id);}function closeCompose(){composeGeneration++;}
    const window={__duoRuntimeCoordinator:{beginMutation(){return ()=>{};}}};${sendFn}globalThis.run=send;globalThis.cancel=()=>{composeGeneration++;};
  `;
  const ctx={h,Blob};vm.runInNewContext(source,ctx);const task=ctx.run();await new Promise(resolve=>setImmediate(resolve));ctx.cancel();release();assert.equal(await task,false);assert.equal(h.box.items.length,0);assert.equal(h.persistCalls,0);
}

// The Circle media picker must release stale preview URLs when the composer is cleared during async file processing.
const releasePreviewFn=extract(html,'function releasePostMediaPreview(item){');
const handlePostFilesFn=extract(html,'async function handlePostMediaFilesWithGeneration(fileList){');
function circlePickerHarness(buildImpl){
  const h={selected:[],generation:0,busy:false,revoked:[],alerts:[],buildImpl};
  const source=`
    const MAX_POST_MEDIA_COUNT=9;let selectedPostMedia=globalThis.h.selected,postMediaSelectionGeneration=0,postMediaSelectionBusy=false;
    function alert(x){globalThis.h.alerts.push(String(x));}function updateMediaPreview(){globalThis.h.previewUpdates=(globalThis.h.previewUpdates||0)+1;}
    const URL={revokeObjectURL(x){globalThis.h.revoked.push(x);}};
    async function buildMediaItem(file){return globalThis.h.buildImpl(file);}
    ${releasePreviewFn}${handlePostFilesFn}
    globalThis.handle=handlePostMediaFilesWithGeneration;globalThis.clear=()=>{postMediaSelectionGeneration++;globalThis.h.generation=postMediaSelectionGeneration;selectedPostMedia=[];globalThis.h.selected=selectedPostMedia;};
    globalThis.snapshot=()=>({selectedPostMedia,postMediaSelectionGeneration,postMediaSelectionBusy});
  `;
  const ctx={h};vm.runInNewContext(source,ctx);return ctx;
}
{
  const h=circlePickerHarness(async file=>({id:'preview-'+file.name,type:'image',src:'blob:'+file.name,previewUrl:'blob:'+file.name}));
  assert.equal(await h.handle([{name:'one.png'}]),true);
  assert.equal(h.snapshot().selectedPostMedia.length,1);
  assert.equal(h.snapshot().postMediaSelectionBusy,false);
}
{
  let finish;const h=circlePickerHarness(async file=>{await new Promise(resolve=>{finish=resolve;});return {id:'stale',src:'blob:stale',previewUrl:'blob:stale'};});
  const pending=h.handle([{name:'race.png'}]);await new Promise(resolve=>setImmediate(resolve));h.clear();finish();assert.equal(await pending,false);
  assert.equal(h.snapshot().selectedPostMedia.length,0);assert.deepEqual(h.h.revoked,['blob:stale']);
}
{
  let finish;let builds=0;const h=circlePickerHarness(async file=>{builds++;await new Promise(resolve=>{finish=resolve;});return {id:'ok',src:'blob:ok',previewUrl:'blob:ok'};});
  const first=h.handle([{name:'first.png'}]);await new Promise(resolve=>setImmediate(resolve));assert.equal(await h.handle([{name:'second.png'}]),false);assert.equal(builds,1);finish();assert.equal(await first,true);
}

// Publishing is a transaction: pre-commit failure cleans newly stored media; post-commit preview refresh failure must not ask the user to publish twice.
const commitPostFn=extract(html,'async function commitPostMineWithMedia(...args){');
function postCommitHarness({ transactionResult=true, ensureError=false, storeError=false, waitStore=false }={}){
  const h={waitStore,releaseStore:null,selected:[{id:'preview-id',src:'blob:preview',previewUrl:'blob:preview',type:'image',blob:new Blob(['image'],{type:'image/png'}),name:'post.png'}],stored:[],deleted:[],revoked:[],toasts:[],posts:0,mutationBegins:0,mutationEnds:0,ensureError};
  const source=`
    let selectedPostMedia=globalThis.h.selected;let postMediaSelectionGeneration=0;let stateCommitted=false;const createdIds=[];let mediaBefore;
    function releasePostMediaPreview(item){const url=item?.previewUrl||(typeof item?.src==='string'&&item.src.startsWith('blob:')?item.src:'');if(url)URL.revokeObjectURL(url);}
    function updateMediaPreview(){}function showToast(x){globalThis.h.toasts.push(String(x));}function deleteIfUnreferenced(id){globalThis.h.deleted.push(id);return Promise.resolve(true);}
    const URL={revokeObjectURL(x){globalThis.h.revoked.push(x);}};
    const window={__duoRuntimeCoordinator:{beginMutation(){globalThis.h.mutationBegins++;return ()=>globalThis.h.mutationEnds++;}},__duoCircleMedia:{async waitForMigration(){},async storeBlob(blob){if(globalThis.h.waitStore)await new Promise(resolve=>{globalThis.h.releaseStore=resolve;});if(${storeError})throw new Error('simulated IDB quota failure');const id='media-circle-1';globalThis.h.stored.push(id);return 'idb-media:'+id;},parseRef(ref){return ref.replace('idb-media:','');},isDataMediaUrl(){return false;},async ensure(){if(globalThis.h.ensureError)throw new Error('preview refresh failed');return {missing:0};}}};
    const Blob=globalThis.Blob;
    async function circleTransaction(label,op){if(${transactionResult}){const result=await op();return result===false?false:true;}return false;}
    const rawPostMine=function(){globalThis.h.posts++;selectedPostMedia=[];globalThis.h.selected=selectedPostMedia;return true;};
    ${commitPostFn}
    globalThis.run=commitPostMineWithMedia;globalThis.cancel=()=>{postMediaSelectionGeneration++;selectedPostMedia=[];globalThis.h.selected=selectedPostMedia;};globalThis.snapshot=()=>({selectedPostMedia,posts:globalThis.h.posts,stored:globalThis.h.stored,deleted:globalThis.h.deleted,revoked:globalThis.h.revoked,toasts:globalThis.h.toasts,mutationBegins:globalThis.h.mutationBegins,mutationEnds:globalThis.h.mutationEnds});
  `;
  const ctx={h,Blob,console};vm.runInNewContext(source,ctx);return ctx;
}
{
  const h=postCommitHarness({ensureError:true});assert.equal(await h.run('post text'),true);const s=h.snapshot();assert.equal(s.posts,1);assert.deepEqual(s.deleted,[]);assert.deepEqual(s.revoked,['blob:preview']);assert.ok(s.toasts.some(x=>x.includes('动态已发布')));assert.equal(s.mutationBegins,s.mutationEnds);
}
{
  const h=postCommitHarness({transactionResult:false});assert.equal(await h.run('post text'),false);const s=h.snapshot();assert.equal(s.posts,0);assert.deepEqual(s.deleted,['media-circle-1']);assert.equal(s.selectedPostMedia.length,1);assert.deepEqual(s.revoked,[]);assert.equal(s.mutationBegins,s.mutationEnds);
}
{
  const h=postCommitHarness({transactionResult:true,storeError:true});assert.equal(await h.run('post text'),false);const s=h.snapshot();assert.equal(s.posts,0);assert.deepEqual(s.stored,[]);assert.deepEqual(s.deleted,[]);assert.equal(s.selectedPostMedia.length,1);
}

console.log('PASS: mailbox attachment writes remain protected until committed, outgoing letters verify real Blob IDs and roll back on missing/corrupt attachments or stale composer generations; Circle async file selection rejects stale completion and concurrent picks; post publishing rolls back before commit but never reports a committed post as failed after preview refresh errors.');

// Mailbox persistence failure must roll back the outgoing letter while leaving the compose draft usable.
{
  const h=mailboxHarness();h.persistResult=false;
  h.element('#mailComposeTitle').value='不得丢失的草稿';h.element('#mailComposeContent').value='持久化会失败';h.element('#mailComposeModal');h.element('#mailComposeSend');
  const source=`
    const MAX_IMAGES=6,MAX_COMPOSE_IMAGES=4,MAX_IMAGE_BYTES=8*1024*1024,MAX_TOTAL_IMAGE_BYTES=24*1024*1024;
    let box=globalThis.h.box,activeComposeImages=globalThis.h.activeComposeImages,activeReplyToId=null,composeGeneration=1,addingComposeImages=false,sendingLetter=false,activeTab='in';
    const clean=${cleanFn.slice(cleanFn.indexOf('s=>'))};${normalizeImagesFn}
    function $(s){return globalThis.h.element(s.slice(1));}function clone(v){return JSON.parse(JSON.stringify(v));}function normalize(v){return v;}
    function showToast(v){globalThis.h.toasts.push(String(v));}function random(a){return a;}function uid(){return 'p';}function makeLetter(type,title,content,extra={}){return {id:'new-letter',type,title,content,images:normalizeImages(extra.images)};}
    function persist(){globalThis.h.persistCalls++;if(!globalThis.h.persistResult)return false;globalThis.h.stored.push(clone(box));return true;}
    async function getMediaRecord(id){return globalThis.h.mediaRecords[id]||null;}function closeCompose(){globalThis.h.modalOpen=false;}
    const window={__duoRuntimeCoordinator:{beginMutation(){globalThis.h.mutationBegins++;return ()=>globalThis.h.mutationEnds++;}}};${sendFn}
    globalThis.run=send;globalThis.snapshot=()=>({items:box.items,activeComposeImages,sendingLetter,buttonDisabled:$('#mailComposeSend').disabled,buttonBusy:$('#mailComposeSend').attrs['aria-busy'],begins:globalThis.h.mutationBegins,ends:globalThis.h.mutationEnds,toasts:globalThis.h.toasts});
  `;
  const ctx={h,Blob,console};vm.runInNewContext(source,ctx);
  assert.equal(await ctx.run(),false);
  const r=JSON.parse(JSON.stringify(ctx.snapshot()));
  assert.deepEqual(r.items,[]);assert.deepEqual(r.activeComposeImages.map(x=>x.id),['mail-media-1']);
  assert.equal(r.sendingLetter,false);assert.equal(r.buttonDisabled,false);assert.equal(r.buttonBusy,undefined);
  assert.equal(r.begins,1);assert.equal(r.ends,1);assert.equal(h.stored.length,0);
}

// Double-clicking send while attachment verification is awaiting IndexedDB can create only one outgoing letter.
{
  const h=mailboxHarness();h.persistResult=true;let release;
  h.element('#mailComposeTitle').value='只能寄出一次';h.element('#mailComposeContent').value='快速双击';h.element('#mailComposeModal');h.element('#mailComposeSend');
  h.getMediaImpl=async id=>{await new Promise(resolve=>{release=resolve;});return h.mediaRecords[id];};
  const source=`
    const MAX_IMAGES=6,MAX_COMPOSE_IMAGES=4,MAX_IMAGE_BYTES=8*1024*1024,MAX_TOTAL_IMAGE_BYTES=24*1024*1024;
    let box=globalThis.h.box,activeComposeImages=globalThis.h.activeComposeImages,activeReplyToId=null,composeGeneration=1,addingComposeImages=false,sendingLetter=false,activeTab='in';
    const clean=${cleanFn.slice(cleanFn.indexOf('s=>'))};${normalizeImagesFn}
    function $(s){return globalThis.h.element(s.slice(1));}function clone(v){return JSON.parse(JSON.stringify(v));}function normalize(v){return v;}
    function showToast(v){globalThis.h.toasts.push(String(v));}function random(a){return a;}function uid(){return 'p';}function makeLetter(type,title,content,extra={}){return {id:'new-letter',type,title,content,images:normalizeImages(extra.images)};}
    function persist(){globalThis.h.persistCalls++;globalThis.h.stored.push(clone(box));return true;}
    async function getMediaRecord(id){return globalThis.h.getMediaImpl(id);}function closeCompose(){globalThis.h.modalOpen=false;}
    const window={__duoRuntimeCoordinator:{beginMutation(){globalThis.h.mutationBegins++;return ()=>globalThis.h.mutationEnds++;}}};${sendFn}
    globalThis.run=send;globalThis.snapshot=()=>({items:box.items,sendingLetter,persistCalls:globalThis.h.persistCalls,begins:globalThis.h.mutationBegins,ends:globalThis.h.mutationEnds});
  `;
  const ctx={h,Blob,console};vm.runInNewContext(source,ctx);const first=ctx.run();await new Promise(resolve=>setImmediate(resolve));assert.equal(await ctx.run(),false,'second send call must be rejected while first send is busy');release();assert.equal(await first,true);
  const r=JSON.parse(JSON.stringify(ctx.snapshot()));assert.equal(r.items.length,1);assert.equal(r.persistCalls,1);assert.equal(r.begins,1);assert.equal(r.ends,1);assert.equal(r.sendingLetter,false);
}

// Sending while attachment writes are still in progress is rejected before taking the mutation lock.
{
  const h=mailboxHarness();h.persistResult=true;h.element('#mailComposeTitle').value='';h.element('#mailComposeContent').value='content';h.element('#mailComposeModal');h.element('#mailComposeSend');
  const source=`const MAX_IMAGES=6,MAX_COMPOSE_IMAGES=4,MAX_IMAGE_BYTES=8*1024*1024,MAX_TOTAL_IMAGE_BYTES=24*1024*1024;let box=globalThis.h.box,activeComposeImages=globalThis.h.activeComposeImages,activeReplyToId=null,composeGeneration=1,addingComposeImages=true,sendingLetter=false,activeTab='in';const clean=${cleanFn.slice(cleanFn.indexOf('s=>'))};${normalizeImagesFn}function $(s){return globalThis.h.element(s.slice(1));}function showToast(v){globalThis.h.toasts.push(String(v));}const window={__duoRuntimeCoordinator:{beginMutation(){globalThis.h.mutationBegins++;return ()=>globalThis.h.mutationEnds++;}}};${sendFn}globalThis.run=send;`;
  const ctx={h,Blob};vm.runInNewContext(source,ctx);assert.equal(await ctx.run(),false);assert.equal(h.mutationBegins,0);assert.equal(h.persistCalls,0);assert.match(h.toasts.at(-1),/图片仍在写入/);
}

// Circle post deletion is wrapped in the real snapshot transaction. It must ask the global
// reference scanner before deleting media shared with chat/mailbox; failed persistence skips GC.
const circleTransactionFn=extract(html,'function circleTransaction(label,operation){');
const deletePostFn=extract(html,'function deletePost(postId){');
function circleDeleteHarness({ sharedIds=[], persistThrows=false }={}){
  const h={shared:new Set(sharedIds),cleanupCalls:[],persistCalls:0,toasts:[],posts:[{id:'post-1',author:'me',text:'delete me',media:[{id:'item-1',src:'idb-media:circle-shared-media',type:'image'}]}],pendingEvents:[{postId:'post-1',type:'other_like'}]};
  const source=`
    let state={posts:globalThis.h.posts,pendingEvents:globalThis.h.pendingEvents};
    let circleTransactionDepth=0,circleTransactionSnapshot=null,circleTransactionDirty=false,currentDetailId='post-1';
    const window={__duoRuntimeCoordinator:{beginMutation(){return ()=>{globalThis.h.ended=(globalThis.h.ended||0)+1;};},},__duoCircleMedia:{collectIdsFromState(s){const ids=new Set();for(const p of s.posts||[])for(const m of p.media||[]){const x=String(m.src||'').match(/^idb-media:(.+)$/);if(x)ids.add(x[1]);}return ids;}},__duoCircleRollbackInProgress:false};
    function restoreCircleState(raw){state=JSON.parse(raw);}
    function persistCircleState(){globalThis.h.persistCalls++;if(${persistThrows})throw new Error('quota failure');return true;}
    function save(){if(circleTransactionDepth>0){circleTransactionDirty=true;return true;}return persistCircleState();}
    function deleteIfUnreferenced(id){globalThis.h.cleanupCalls.push(id);return Promise.resolve(!globalThis.h.shared.has(id));}
    function qs(){return {classList:{contains(){return false;}}};}function renderPosts(){}function renderDetail(){}function refreshViewerIfNeeded(){}function renderNoticeBar(){}function closeDetail(){currentDetailId='';}
    const console={warn(){}};
    ${circleTransactionFn}${deletePostFn}
    globalThis.remove=()=>circleTransaction('删除动态',()=>deletePost('post-1'));
    globalThis.snapshot=()=>({state,persistCalls:globalThis.h.persistCalls,cleanupCalls:globalThis.h.cleanupCalls,ended:globalThis.h.ended||0});
  `;
  const ctx={h,console};vm.runInNewContext(source,ctx);return ctx;
}
{
  const h=circleDeleteHarness({sharedIds:['circle-shared-media']});
  assert.equal(await h.remove(),true);await new Promise(resolve=>setImmediate(resolve));
  const result=JSON.parse(JSON.stringify(h.snapshot()));
  assert.equal(result.state.posts.length,0);assert.deepEqual(result.cleanupCalls,['circle-shared-media']);
  assert.equal(result.ended,1,'writer mutation lease must be released');
  assert.equal(h.h.shared.has('circle-shared-media'),true,'the global scanner must retain media still referenced by another module');
}
{
  const h=circleDeleteHarness({persistThrows:true});
  assert.equal(await h.remove(),false);const result=JSON.parse(JSON.stringify(h.snapshot()));
  assert.equal(result.state.posts.length,1,'failed Circle persistence restores the deleted post');
  assert.deepEqual(result.cleanupCalls,[],'failed state commits must not start media GC');
  assert.equal(result.ended,1);
}

// Saving profile assets writes both avatar and cover Blobs in one Circle transaction.
// If the transaction fails after IndexedDB writes, only those newly-created, unreferenced IDs are cleaned.
const saveSettingsFn=extract(html,'async function saveSettings(){');
function profileSaveHarness({ failTransaction=false, failCoverStore=false }={}){
  const h={cleaned:[],stored:[],toasts:[],state:{myName:'Old',otherName:'Partner',myAvatar:'idb-media:old-avatar',myCover:'idb-media:old-cover',autoPost:'off',posts:[],dynamicCards:[],replyCards:[],uiFontScale:1},storeCalls:0};
  const source=`
    let state=globalThis.h.state,tempAssets={myAvatar:'blob:new-avatar',otherAvatar:null,myCover:'blob:new-cover',otherCover:null,dirty:true};
    const tempAssetBlobs=new Map([['myAvatar',{blob:new Blob(['avatar'],{type:'image/png'}),url:'blob:new-avatar'}],['myCover',{blob:new Blob(['cover'],{type:'image/png'}),url:'blob:new-cover'}]]);
    let assetJobs=[],assetsBusy=false,profileSettingsSaving=false,draftDynamicCards=['new dynamic'],draftReplyCards=['new reply'];
    const assetJobTokens=new Map();function updateProfilePreview(){}function fillSettings(){globalThis.h.filled=(globalThis.h.filled||0)+1;}function applyHeader(){}function renderPosts(){}function updateNextHint(){}function clampFontPercent(v){return Number(v)||100;}function planNextOtherPost(){}function save(){return true;}function releaseTempProfileAsset(key){tempAssetBlobs.delete(key);}
    function showToast(x){globalThis.h.toasts.push(String(x));}async function deleteIfUnreferenced(id){globalThis.h.cleaned.push(id);return true;}
    const fields={'#myNameInput':{value:'New Name'},'#otherNameInput':{value:'Partner'},'#autoPostSelect':{value:'off'},'#postMinInput':{value:'60'},'#postMaxInput':{value:'240'},'#replyMinInput':{value:'0.5'},'#replyMaxInput':{value:'1'},'#fontScaleNumber':{value:'100'}};function qs(s){return fields[s]||null;}
    let nextId=0;const window={__duoCircleMedia:{async waitForMigration(){},async storeBlob(blob){globalThis.h.storeCalls++;if(${failCoverStore}&&blob.type==='image/png'&&blob.size===5)throw new Error('cover store failed');const id='new-media-'+(++nextId);globalThis.h.stored.push(id);return 'idb-media:'+id;},parseRef(ref){return ref.replace('idb-media:','');},isDataMediaUrl(){return false;}}};
    async function circleTransaction(label,operation){const before=JSON.parse(JSON.stringify(state));try{await operation();if(${failTransaction}){state=before;return false;}return true;}catch(error){state=before;return false;}}
    ${saveSettingsFn}
    globalThis.run=saveSettings;globalThis.snapshot=()=>({state,tempAssets,stored:globalThis.h.stored,cleaned:globalThis.h.cleaned,filled:globalThis.h.filled||0,storeCalls:globalThis.h.storeCalls});
  `;
  const ctx={h,Blob,console};vm.runInNewContext(source,ctx);return ctx;
}
{
  const h=profileSaveHarness();assert.equal(await h.run(),true);const r=JSON.parse(JSON.stringify(h.snapshot()));
  assert.equal(r.state.myAvatar,'idb-media:new-media-1');assert.equal(r.state.myCover,'idb-media:new-media-2');
  assert.deepEqual(r.cleaned,[]);assert.equal(r.tempAssets.dirty,false);
}
{
  const h=profileSaveHarness({failTransaction:true});assert.equal(await h.run(),false);const r=JSON.parse(JSON.stringify(h.snapshot()));
  assert.equal(r.state.myAvatar,'idb-media:old-avatar');assert.equal(r.state.myCover,'idb-media:old-cover');
  assert.deepEqual(r.cleaned,['new-media-1','new-media-2']);assert.equal(r.tempAssets.myAvatar,'blob:new-avatar');assert.equal(r.tempAssets.myCover,'blob:new-cover');
}
{
  const h=profileSaveHarness({failCoverStore:true});assert.equal(await h.run(),false);const r=JSON.parse(JSON.stringify(h.snapshot()));
  assert.equal(r.state.myAvatar,'idb-media:old-avatar');assert.equal(r.state.myCover,'idb-media:old-cover');
  assert.deepEqual(r.cleaned,['new-media-1'],'avatar written before cover failure must be cleaned without touching old assets');
}

// If the user closes the Circle composer while a Blob is being written, the post must not commit,
// and the cancellation handler must not repopulate the now-closed composer with stale media.
{
  const h=postCommitHarness({waitStore:true});
  const pending=h.run('must not publish after cancel');
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(typeof h.h.releaseStore,'function','the async media write should be in flight');
  h.cancel();
  h.h.releaseStore();
  assert.equal(await pending,false);
  const r=h.snapshot();
  assert.equal(r.posts,0);
  assert.deepEqual(JSON.parse(JSON.stringify(r.selectedPostMedia)),[]);
  assert.deepEqual(r.deleted,['media-circle-1'],'media completed after cancellation must be cleaned as an orphan');
  assert.equal(r.mutationBegins,r.mutationEnds);
}

console.log('PASS: mailbox attachment write/send/read failure gates, Circle stale media selection, post commit/rollback/cancel race, shared-media-safe deletion, and avatar/cover storage replacement all execute the real source functions and preserve old data on failed transactions.');
