import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const mailbox = fs.readFileSync(path.join(ROOT, 'mailbox-manager.js'), 'utf8');
const circleMedia = fs.readFileSync(path.join(ROOT, 'circle-media-manager.js'), 'utf8');

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

const postMineFn = extract(index, 'function postMine(text){');
const processDueFn = extract(mailbox, 'function processDue(){');
const sendFn = extract(mailbox, 'async function send(){');
const collectStart = circleMedia.indexOf('function collectIdsFromState(circle, options={})');
assert.ok(collectStart >= 0);
const collectOpen = circleMedia.indexOf('){', collectStart) + 1;
function extractFromOpen(source, start, brace) {
  let depth=0, quote='', escaped=false, lineComment=false, blockComment=false;
  for(let i=brace;i<source.length;i++){
    const c=source[i],n=source[i+1];
    if(lineComment){if(c==='\n')lineComment=false;continue;}
    if(blockComment){if(c==='*'&&n==='/'){blockComment=false;i++;}continue;}
    if(quote){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c===quote)quote='';continue;}
    if(c==='/'&&n==='/'){lineComment=true;i++;continue;}
    if(c==='/'&&n==='*'){blockComment=true;i++;continue;}
    if(c==='"'||c==="'"||c==='`'){quote=c;continue;}
    if(c==='{')depth++;else if(c==='}'&&--depth===0)return source.slice(start,i+1);
  }
  throw new Error('unterminated extracted function');
}
const collectIdsFn = extractFromOpen(circleMedia, collectStart, collectOpen);
const cleanupReplacedFn = extract(circleMedia, 'async function cleanupReplaced(oldState,newState){');
const profileRefsStart = index.indexOf('function collectProfileMediaIds(');
const profileRefsEnd = index.indexOf('window.__duoProfileMediaRefs=', profileRefsStart);
assert.ok(profileRefsStart >= 0 && profileRefsEnd > profileRefsStart, 'profile media reference helper boundaries must exist');
const collectProfileMediaRefsFn = index.slice(profileRefsStart, profileRefsEnd);
const latestPersistedRefsFn = extract(index, 'function latestPersistedMediaReferences(){');
const deleteIfUnreferencedFn = extract(index, 'async function deleteIfUnreferenced(id){');
const saveSettingsFn = extract(index, 'async function saveSettings(){');
const commitPostMineWithMediaFn = extract(index, 'async function commitPostMineWithMedia(...args){');
const circleTransactionFn = extract(index, 'function circleTransaction(label,operation){');
const renderDetailTopSheetFn = extract(index, 'function renderDetailTopSheet(post){');

// Editing an owned post updates only text/media and preserves its identity and history.
{
  const post = { id:'post-existing', author:'me', text:'原文', ts:1234, private:true,
    likesBy:{me:true,other:true}, comments:[{id:'c1',text:'保留评论'}], media:[{id:'old-media',type:'image',src:'idb-media:old-media'}] };
  const h = { post, renders:0, detailRenders:0, toasts:[], saved:0 };
  const source = `
    let editingPostId='post-existing';let selectedPostMedia=[{id:'new-media',type:'image',src:'idb-media:new-media'}];
    let state={posts:[globalThis.h.post],pendingEvents:[{id:'pending-1',postId:'post-existing'}]};let currentDetailId='post-existing';
    function save(){globalThis.h.saved++;return true;}function renderPosts(){globalThis.h.renders++;}function renderDetail(){globalThis.h.detailRenders++;}
    function showToast(v){globalThis.h.toasts.push(v);}function createPost(){throw new Error('edit must not create a new post');}
    function scheduleOtherEngagement(){throw new Error('edit must not reschedule interactions');}
    ${postMineFn}
    globalThis.run=postMine;globalThis.snapshot=()=>state.posts[0];`;
  const ctx = vm.createContext({ h });
  vm.runInContext(source, ctx);
  assert.equal(ctx.run('修改后的内容'), true);
  const result = JSON.parse(JSON.stringify(ctx.snapshot()));
  assert.equal(result.id, 'post-existing');
  assert.equal(result.author, 'me');
  assert.equal(result.text, '修改后的内容');
  assert.equal(result.ts, 1234);
  assert.equal(result.private, true);
  assert.deepEqual(result.likesBy, {me:true,other:true});
  assert.deepEqual(result.comments, [{id:'c1',text:'保留评论'}]);
  assert.deepEqual(result.media, [{id:'new-media',type:'image',src:'idb-media:new-media'}]);
  assert.equal(h.saved, 1);
  assert.equal(h.renders, 1);
  assert.equal(h.detailRenders, 1);
}

// A failed post edit restores the previous in-memory value even before the outer Circle transaction rolls back.
{
  const post = {id:'post-fail',author:'me',text:'原文',media:[{id:'old',src:'idb-media:old'}],comments:[]};
  const source = `let editingPostId='post-fail';let selectedPostMedia=[];let state={posts:[globalThis.post],pendingEvents:[]};let currentDetailId='';function save(){return false;}function renderPosts(){}function renderDetail(){}function showToast(){}function createPost(){}function scheduleOtherEngagement(){};${postMineFn};globalThis.run=postMine;`;
  const ctx = vm.createContext({post}); vm.runInContext(source, ctx);
  assert.equal(ctx.run('不应保存'), false);
  assert.equal(ctx.post.text, '原文');
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.post.media)), [{id:'old',src:'idb-media:old'}]);
}

// Non-owned and deleted posts cannot be edited; an empty post cannot be committed.
for (const scenario of [
  {editingPostId:'other-post',post:{id:'other-post',author:'other',text:'对方内容',media:[]},text:'不允许',expected:false},
  {editingPostId:'gone-post',post:{id:'other-post',author:'me',text:'其他',media:[]},text:'不存在',expected:false},
  {editingPostId:'empty-post',post:{id:'empty-post',author:'me',text:'原文',media:[]},text:'  ',expected:false}
]) {
  const source = `let editingPostId=${JSON.stringify(scenario.editingPostId)};let selectedPostMedia=[];let state={posts:[globalThis.post],pendingEvents:[]};let currentDetailId='';function save(){return true;}function renderPosts(){}function renderDetail(){}function showToast(){}function createPost(){}function scheduleOtherEngagement(){};${postMineFn};globalThis.run=postMine;`;
  const ctx=vm.createContext({post:scenario.post});vm.runInContext(source,ctx);
  assert.equal(ctx.run(scenario.text),scenario.expected);
}

// When auto-reply planning is deferred because the usage outbox is full, recent-card history must not change.
{
  const h={box:{items:[{id:'out-1',type:'outgoing',content:'你好'}],pending:[{id:'task-1',type:'reply',sourceId:'out-1',due:0}],usageOutbox:Array.from({length:999},(_,i)=>({eventId:'u'+i})),recentCardKeys:['before'],settings:{autoIncoming:false},nextIncomingAt:0},toasts:[]};
  const source=`const MAX_PENDING_USAGE_EVENTS=1000;let box=globalThis.h.box;let tasksPaused=false;const document={hidden:false};const window={__duoRuntimeCoordinator:{isWritable:()=>true}};function clone(v){return JSON.parse(JSON.stringify(v));}function chooseChatCards(){box.recentCardKeys.push('phantom-card');return [{text:'卡片一'},{text:'卡片二'}];}function showToast(v){globalThis.h.toasts.push(v);}function contentForCards(v){return v.map(x=>x.text).join('\\n');}function fragmentsForCards(v){return v.map(x=>({textSnapshot:x.text}));}function random(){return 1;}function scheduleIncoming(){}function persist(){return true;}function makeLetter(){throw new Error('capacity guard should return before making letters');}function render(){}function flushUsageOutbox(){}function cleanupUnreferencedImages(){};${processDueFn};globalThis.run=processDue;`;
  const ctx=vm.createContext({h});vm.runInContext(source,ctx);ctx.run();
  assert.deepEqual(Array.from(h.box.recentCardKeys),['before']);
  assert.equal(h.box.pending.length,1,'deferred auto-reply remains queued');
  assert.equal(h.box.items.length,1);
  assert.match(h.toasts.at(-1),/队列已满/);
}

// A scheduled auto-reply whose source letter was evicted must be pruned in the same send commit.
// A reply draft whose incoming source has disappeared must be refused before creating an outgoing letter.
function buildSendHarness({items=[],pending=[],replyToId=null,autoReply=false}={}) {
  const h={box:{items,pending,usageOutbox:[],recentCardKeys:[],nextIncomingAt:0,settings:{autoReply,minReplyMin:2,maxReplyMin:3}},
    title:'测试信',content:'信件正文',activeImages:[],replyToId,toasts:[],persistCalls:0,deleted:[],rendered:0,closed:0};
  const source=`
    const MAX_COMPOSE_IMAGES=4,MAX_IMAGE_BYTES=8*1024*1024,MAX_TOTAL_IMAGE_BYTES=24*1024*1024;
    let box=globalThis.h.box,activeComposeImages=globalThis.h.activeImages,activeReplyToId=globalThis.h.replyToId;
    let composeGeneration=1,addingComposeImages=false,sendingLetter=false,activeTab='in';
    function $(s){if(s==='#mailComposeModal')return {classList:{contains:()=>true}};if(s==='#mailComposeTitle')return {value:globalThis.h.title};if(s==='#mailComposeContent')return {value:globalThis.h.content};if(s==='#mailComposeSend')return {disabled:false,setAttribute(){},removeAttribute(){}};return null;}
    const clean=s=>String(s||'').trim().slice(0,12000);function normalizeImages(x){return Array.isArray(x)?x:[];}function clone(v){return JSON.parse(JSON.stringify(v));}
    function showToast(v){globalThis.h.toasts.push(v);}function uid(){return 'new-task-'+(box.pending.length+1);}function random(a){return a;}
    function makeLetter(type,title,content,extra={}){return {id:'new-outgoing',type,title,content,createdAt:10,read:true,replyToId:extra.replyToId||null,images:normalizeImages(extra.images)};}
    function persist(){globalThis.h.persistCalls++;return true;}async function getMediaRecord(){return null;}function closeCompose(){globalThis.h.closed++;composeGeneration++;activeComposeImages=[];}
    function render(){globalThis.h.rendered++;}async function cleanupUnreferencedImages(items){globalThis.h.deleted.push(...items.map(x=>x.id));}
    const window={__duoRuntimeCoordinator:{beginMutation(){return ()=>{};}}};
    ${sendFn}
    globalThis.run=send;globalThis.snapshot=()=>({items:box.items,pending:box.pending});`;
  const ctx=vm.createContext({h,Date,Blob,console});vm.runInContext(source,ctx);return {h,ctx};
}
{
  const {h,ctx}=buildSendHarness({items:[],pending:[],replyToId:'deleted-incoming',autoReply:false});
  assert.equal(await ctx.run(),false);
  assert.equal(h.box.items.length,0);
  assert.equal(h.persistCalls,0);
  assert.match(h.toasts.at(-1),/原信件已删除/);
}
{
  const items=Array.from({length:5000},(_,i)=>({id:i===0?'old-outgoing':'old-'+i,type:i===0?'outgoing':'incoming',images:[]}));
  const {h,ctx}=buildSendHarness({items,pending:[{id:'old-task',type:'reply',sourceId:'old-outgoing',due:999999}],autoReply:true});
  assert.equal(await ctx.run(),true);
  assert.equal(h.box.items.length,5000);
  assert.equal(h.box.pending.some(task=>task.sourceId==='old-outgoing'),false);
  assert.equal(h.box.pending.some(task=>task.sourceId==='new-outgoing'),true);
}

// Circle media collection deduplicates shared profile references and preserves any surviving owner.
{
  const source=`const PREFIX='idb-media:';const PROFILE_FIELDS=['myAvatar','otherAvatar','myCover','otherCover'];function parseRef(value){return typeof value==='string'&&value.startsWith(PREFIX)?value.slice(PREFIX.length):'';} ${collectIdsFn};globalThis.collect=collectIdsFromState;`;
  const ctx=vm.createContext({});vm.runInContext(source,ctx);
  const state={myAvatar:'idb-media:shared',otherAvatar:'idb-media:shared',myCover:'idb-media:cover',otherCover:'idb-media:shared',posts:[]};
  assert.deepEqual([...ctx.collect(state)].sort(),['cover','shared']);
  state.myAvatar='';state.myCover='';
  assert.deepEqual([...ctx.collect(state)].sort(),['shared']);
  state.otherAvatar='';state.otherCover='';
  assert.deepEqual([...ctx.collect(state)],[]);
}

// Final persisted-reference check prevents deleting a shared profile media ID while another user still owns it.
{
  const h={circle:{myAvatar:'',otherAvatar:'idb-media:shared-profile',myCover:'',otherCover:''},deleted:[]};
  const source=`
    const STORAGE_KEY='main-state';const state={chatHistory:[],stickers:[]};
    const localStorage={getItem(key){if(key===STORAGE_KEY)return JSON.stringify({chatHistory:[],stickers:[]});if(key==='circle-state')return JSON.stringify(globalThis.h.circle);if(key==='twodeers_mailbox_letters_v1')return JSON.stringify({items:[]});return null;}};
    const window={__duoCircleApi:{getStoreKey:()=> 'circle-state'},__duoCircleMedia:{collectIdsFromState(circle){const out=new Set();for(const key of ['myAvatar','otherAvatar','myCover','otherCover'])if(String(circle?.[key]||'').startsWith('idb-media:'))out.add(String(circle[key]).slice(10));for(const post of circle?.posts||[])for(const media of post.media||[])if(String(media.src||'').startsWith('idb-media:'))out.add(media.src.slice(10));return out;}}};
    function referencedMediaIds(){return new Set();}function readStickerLibraryStore(){return null;}
    ${collectProfileMediaRefsFn}
    ${latestPersistedRefsFn}
    async function openMediaDB(){return {};}
    async function deleteMediaRecord(id){globalThis.h.deleted.push(id);}
    ${deleteIfUnreferencedFn}
    globalThis.run=deleteIfUnreferenced;`;
  const ctx=vm.createContext({h,JSON});vm.runInContext(source,ctx);
  assert.equal(await ctx.run('shared-profile'),false);
  assert.deepEqual(h.deleted,[]);
}

// If the last profile reference is removed, Circle cleanup releases the cached object URL after deletion.
{
  const h={deleted:[],released:[]};
  const source=`function collectIdsFromState(circle){const ids=new Set();for(const key of ['myAvatar','otherAvatar','myCover','otherCover'])if(String(circle?.[key]||'').startsWith('idb-media:'))ids.add(String(circle[key]).slice(10));return ids;}async function deleteIfUnreferenced(id){globalThis.h.deleted.push(id);return true;}function release(id){globalThis.h.released.push(id);}const console={warn(){}};${cleanupReplacedFn};globalThis.run=cleanupReplaced;`;
  const ctx=vm.createContext({h});vm.runInContext(source,ctx);
  const result=await ctx.run({myAvatar:'idb-media:shared',otherAvatar:'idb-media:shared'}, {myAvatar:'',otherAvatar:''});
  assert.equal(result.deleted,1);
  assert.deepEqual(h.deleted,['shared']);
  assert.deepEqual(h.released,['shared']);
}

// Profile save is single-flight: a second click while migration is pending must not run a second transaction.

{
  let releaseMigration;
  const migration=new Promise(resolve=>{releaseMigration=resolve;});
  const controls=[{disabled:false},{disabled:true},{disabled:false}];
  const fields={myNameInput:{value:'新名'},otherNameInput:{value:'对方'},autoPostSelect:{value:'off'},postMinInput:{value:'60'},postMaxInput:{value:'120'},replyMinInput:{value:'0.333'},replyMaxInput:{value:'1.5'},fontScaleNumber:{value:'100'}};
  const h={root:{querySelectorAll:()=>controls},fields,migration,state:{myName:'旧名',otherName:'对方',dynamicCards:[],replyCards:[],autoPost:'off',postMin:60,postMax:120,replyMin:20,replyMax:90,uiFontScale:1,nextOtherPostAt:0},txCalls:0,mutationBegins:0,mutationEnds:0,toasts:[]};
  const source=`
    let profileSettingsSaving=false,assetJobs=[],assetsBusy=false;
    let tempAssets={myAvatar:null,otherAvatar:null,myCover:null,otherCover:null,dirty:false};
    let tempAssetBlobs=new Map(),state=globalThis.h.state,draftDynamicCards=[],draftReplyCards=[];
    const DEFAULT_UI_SCALE=1;function clampFontPercent(v){return Math.min(160,Math.max(80,Math.round(Number(v)||100)));}
    function qs(s){if(s==='#settingsMask')return globalThis.h.root;return globalThis.h.fields[s.slice(1)]||null;}
    const window={__duoRuntimeCoordinator:{beginMutation(){globalThis.h.mutationBegins++;return ()=>globalThis.h.mutationEnds++;}},__duoCircleMedia:{waitForMigration:()=>globalThis.h.migration}};
    async function circleTransaction(label,fn){globalThis.h.txCalls++;try{await fn();return true;}catch(error){globalThis.h.txError=error.message;return false;}}
    function save(){return true;}function updateProfilePreview(){}function applyHeader(){}function renderPosts(){}function updateNextHint(){}function fillSettings(){}function releaseTempProfileAsset(){}function planNextOtherPost(){}function showToast(v){globalThis.h.toasts.push(v);}async function deleteIfUnreferenced(){return true;}
    ${saveSettingsFn}
    globalThis.run=saveSettings;`;
  const ctx=vm.createContext({h,Promise,console,Math});vm.runInContext(source,ctx);
  const first=ctx.run();
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(controls.every(item=>item.disabled),'all Circle settings controls lock during asynchronous save');
  assert.equal(await ctx.run(),false,'parallel save is rejected');
  assert.equal(h.txCalls,0,'transaction waits until media migration has finished');
  releaseMigration();
  assert.equal(await first,true);
  assert.equal(h.txCalls,1);
  assert.deepEqual(controls.map(item=>item.disabled),[false,true,false],'original disabled states are restored');
  assert.equal(h.mutationBegins,1);assert.equal(h.mutationEnds,1);
}

{
  const controls=[{disabled:false}];
  const fields={myNameInput:{value:'旧名'},otherNameInput:{value:'对方'},autoPostSelect:{value:'off'},postMinInput:{value:'60'},postMaxInput:{value:'120'},replyMinInput:{value:'0.333'},replyMaxInput:{value:'1.5'},fontScaleNumber:{value:'100'}};
  const h={root:{querySelectorAll:()=>controls},fields,migration:Promise.resolve(),state:{myName:'原始名',otherName:'对方',myAvatar:'idb-media:old-avatar',myCover:'idb-media:old-cover',dynamicCards:[],replyCards:[],autoPost:'off',postMin:60,postMax:120,replyMin:20,replyMax:90,uiFontScale:1,nextOtherPostAt:0},stores:0,deleted:[],released:[],toasts:[]};
  const source=`
    let profileSettingsSaving=false,assetJobs=[],assetsBusy=false;
    let tempAssets={myAvatar:'blob:avatar',otherAvatar:null,myCover:null,otherCover:'blob:cover',dirty:true};
    let tempAssetBlobs=new Map([['myAvatar',{blob:new Blob(['avatar']),url:'blob:avatar'}],['otherCover',{blob:new Blob(['cover']),url:'blob:cover'}]]);
    let state=globalThis.h.state,draftDynamicCards=[],draftReplyCards=[];const DEFAULT_UI_SCALE=1;
    function clampFontPercent(v){return Math.min(160,Math.max(80,Math.round(Number(v)||100)));}function qs(s){if(s==='#settingsMask')return globalThis.h.root;return globalThis.h.fields[s.slice(1)]||null;}
    const window={__duoRuntimeCoordinator:{beginMutation(){return ()=>{};}},__duoCircleMedia:{waitForMigration:()=>globalThis.h.migration,async storeBlob(){globalThis.h.stores++;if(globalThis.h.stores===2)throw new Error('cover write failed');return 'idb-media:new-avatar';},parseRef(v){return v.slice(10);},release(id){globalThis.h.released.push(id);}}};
    async function circleTransaction(label,fn){try{await fn();return true;}catch(_){return false;}}
    function save(){return true;}function updateProfilePreview(){}function applyHeader(){}function renderPosts(){}function updateNextHint(){}function fillSettings(){}function releaseTempProfileAsset(){}function planNextOtherPost(){}function showToast(v){globalThis.h.toasts.push(v);}
    async function deleteIfUnreferenced(id){globalThis.h.deleted.push(id);return true;}
    ${saveSettingsFn}
    globalThis.run=saveSettings;globalThis.snapshot=()=>({state,tempAssets});`;
  const ctx=vm.createContext({h,Promise,console,Math,Blob});vm.runInContext(source,ctx);
  assert.equal(await ctx.run(),false,'second profile media write failure must fail the whole settings transaction');
  const snapshot=JSON.parse(JSON.stringify(ctx.snapshot()));
  assert.equal(snapshot.state.myAvatar,'idb-media:old-avatar');
  assert.equal(snapshot.state.myCover,'idb-media:old-cover');
  assert.equal(snapshot.tempAssets.myAvatar,'blob:avatar','failed profile save keeps the retryable preview');
  assert.equal(snapshot.tempAssets.otherCover,'blob:cover');
  assert.deepEqual(h.deleted,['new-avatar']);
  assert.deepEqual(h.released,['new-avatar'],'rollback releases the temporary Circle object URL after deleting the unreferenced record');
  assert.equal(controls[0].disabled,false);
}

// The detail action sheet only exposes editing for posts owned by the current user.
{
  const source=`function qs(){return globalThis.grid;} ${renderDetailTopSheetFn};globalThis.render=renderDetailTopSheet;`;
  const ctx=vm.createContext({grid:{innerHTML:''}});vm.runInContext(source,ctx);
  ctx.render({id:'mine',author:'me',private:false});
  assert.match(ctx.grid.innerHTML,/editCurrentPostBtn/);
  ctx.render({id:'other',author:'other',private:false});
  assert.doesNotMatch(ctx.grid.innerHTML,/editCurrentPostBtn/);
}

// Circle's real root transaction reclaims removed post media only after commit and global reachability comparison.
function buildCircleTransactionHarness({sharedReference=false,persistSucceeds=true}={}) {
  const oldPost={id:'post-edit-media',author:'me',text:'旧内容',media:[{id:'old-media',type:'image',src:'idb-media:old-media'}]};
  const h={deleted:[],released:[],toasts:[],state:{posts:[oldPost],myAvatar:'',otherAvatar:sharedReference?'idb-media:old-media':'',myCover:'',otherCover:''}};
  const source=`
    let state=globalThis.h.state;
    let circleTransactionDepth=0,circleTransactionSnapshot=null,circleTransactionDirty=false;
    let currentDetailId='';
    const window={__duoRuntimeCoordinator:{beginMutation(){return ()=>{};}},__duoCircleMedia:{collectIdsFromState(circle){const ids=new Set();for(const key of ['myAvatar','otherAvatar','myCover','otherCover'])if(String(circle?.[key]||'').startsWith('idb-media:'))ids.add(String(circle[key]).slice(10));for(const post of circle?.posts||[])for(const media of post.media||[])if(String(media.src||'').startsWith('idb-media:'))ids.add(media.src.slice(10));return ids;},release(id){globalThis.h.released.push(id);}},__duoCardSystem:{flushOutbox(){}}};
    function persistCircleState(){if(!${persistSucceeds})throw new Error('Circle persist failed');return true;}
    function restoreCircleState(snapshot){state=JSON.parse(snapshot);globalThis.h.state=state;}
    function deleteIfUnreferenced(id){globalThis.h.deleted.push(id);return Promise.resolve(true);}
    function renderPosts(){}function renderDetail(){}function refreshViewerIfNeeded(){}function renderNoticeBar(){}function showToast(value){globalThis.h.toasts.push(value);}
    ${circleTransactionFn}
    globalThis.run=async()=>circleTransaction('编辑动态',()=>{state.posts[0].text='编辑后';state.posts[0].media=[];circleTransactionDirty=true;return true;});
    globalThis.snapshot=()=>state;`;
  const ctx=vm.createContext({h,JSON,Promise,console,Set});vm.runInContext(source,ctx);return {ctx,h};
}
{
  const {ctx,h}=buildCircleTransactionHarness();
  assert.equal(await ctx.run(),true);
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(h.deleted,['old-media'],'removed exclusive post media is sent to global deletion after successful state commit');
  assert.deepEqual(h.released,['old-media'],'Circle cache is released only when deletion confirms the record is gone');
  assert.equal(ctx.snapshot().posts[0].media.length,0);
}
{
  const {ctx,h}=buildCircleTransactionHarness({sharedReference:true});
  assert.equal(await ctx.run(),true);
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(h.deleted,[],'an avatar/cover reference in another profile keeps the media ID reachable');
  assert.deepEqual(h.released,[]);
}
{
  const {ctx,h}=buildCircleTransactionHarness({persistSucceeds:false});
  assert.equal(await ctx.run(),false);
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(h.deleted,[],'failed Circle transaction must not start media cleanup');
  assert.deepEqual(h.released,[]);
  assert.equal(ctx.snapshot().posts[0].media[0].src,'idb-media:old-media','failed edit restores old media reference');
}

console.log('PASS: owned-post editing preserves IDs/history and rolls back on save failure; successful edit reclaims only removed unshared media after global reference scanning; mailbox auto-reply planning, reply-source validation and eviction cleanup remain atomic; shared profile media stays reachable and releases cached URLs only after its last reference is removed; Circle profile saves are single-flight and rollback partial multi-asset writes.');
