import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const appendSource = html.match(/function appendChatMessage\(msg, shouldSave=true, usageEvents=\[\]\)\{[\s\S]*?\n\}/)?.[0];
assert.ok(appendSource, 'appendChatMessage source must exist');

function harness(saveResult) {
  const state = { chatHistory: [], cardUsageOutbox: [] };
  const rows = [];
  const messages = [];
  const list = {
    appendChild(row) { rows.push(row); row.isConnected = true; },
  };
  const context = {
    state,
    MAX_PENDING_CARD_USAGE_EVENTS:1000,
    ensureChatState() { if(!Array.isArray(state.cardUsageOutbox))state.cardUsageOutbox=[]; },
    flushChatCardUsageOutbox() {},
    uid: () => 'msg-test-1',
    $: selector => selector === '#chatList' ? list : null,
    buildMessageRow: msg => ({ msg, isConnected: false, remove() { this.isConnected = false; rows.splice(rows.indexOf(this), 1); } }),
    scrollChatToBottom() {},
    save: () => saveResult,
    showToast: message => messages.push(message),
  };
  vm.createContext(context);
  vm.runInContext(appendSource + '\nthis.appendChatMessage = appendChatMessage;', context);
  return { context, state, rows, messages };
}

test('failed message persistence rolls back in-memory history and visible row', () => {
  const h = harness(false);
  const result = h.context.appendChatMessage({ sender: 'me', type: 'text', text: '不可丢失的消息' });
  assert.equal(result, null);
  assert.equal(h.state.chatHistory.length, 0);
  assert.equal(h.state.cardUsageOutbox.length, 0);
  assert.equal(h.rows.length, 0);
  assert.match(h.messages[0], /消息未能保存/);
});

test('successful message persistence keeps the message and visible row', () => {
  const h = harness(true);
  const result = h.context.appendChatMessage({ sender: 'me', type: 'text', text: '正常发送' });
  assert.equal(result.text, '正常发送');
  assert.equal(h.state.chatHistory.length, 1);
  assert.equal(h.state.cardUsageOutbox.length, 0);
  assert.equal(h.rows.length, 1);
});

test('manual chat-card fill carries multiple range-based provenance records through send', () => {
  assert.match(html, /function addPendingCardFragment\(input,start,end,text,cardId,source='chat'\)/);
  assert.match(html, /pendingCardFragments=JSON\.stringify\(kept\)/);
  assert.match(html, /function getPendingCardUsageEvents\(input,txt,allowSearch=false\)/);
  assert.match(html, /const usageEvents=getPendingCardUsageEvents\(input,txt,forceText!==undefined\)/);
  assert.match(html, /appendChatMessage\(\{sender:'me',type:'text',[\s\S]*?true,usageEvents\)/);
  assert.match(html, /if\(!msg\)\{state\.offline\.lastChatAt=previousLastChatAt;return false;\}/);
  assert.match(html, /addPendingCardFragment\(input,start,end,txt,window\.__duoCardSystem/);
});

test('legacy chat-card add and delete controls delegate to the guarded card API', () => {
  assert.match(html, /__duoCardSystem\.add\('chat',value\)/);
  assert.match(html, /__duoCardSystem\.remove\('chat',idx\)/);
  assert.match(html, /__duoCardSystem\.add\('chat',txt\)/);
  assert.match(html, /__duoCardSystem\.remove\('chat',idx\)/);
});

test('sticker upload commits metadata through the independent sticker library store', () => {
  const upload = html.match(/async function addStickers\(files\)\{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(upload, /putMediaBlob\(file,'sticker',file\.name\)/);
  assert.match(upload, /addStickerToLibrary\(\{id:uid\('stk'\),mediaId:id/);
  assert.doesNotMatch(upload, /state\.stickers\.push/);
});

test('chat-card API restores the old pool when primary localStorage save fails', async () => {
  const cardSource = readFileSync(new URL('../card-system.js', import.meta.url), 'utf8');
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
  const circle = { dynamicCards: [], replyCards: [], notificationsEnabled: true };
  const sandbox = {
    state: { cardPhrases: ['原有字卡'] },
    window: { __duoCircleApi: { exportState: () => circle, importState: next => { Object.assign(circle, next); return true; } } },
    localStorage: storage,
    document: { head: { appendChild() {} }, createElement: () => ({ style: {}, textContent: '' }), addEventListener() {}, querySelector() { return null; } },
    escapeHtml: value => String(value), showToast() {}, save: () => false,
    renderPhraseList() {}, renderParamPhraseList() {}, console,
  };
  vm.createContext(sandbox);
  vm.runInContext(cardSource, sandbox);
  assert.throws(() => sandbox.window.__duoCardSystem.add('chat', '不应留下'), /聊天字卡保存失败/);
  assert.deepEqual(sandbox.state.cardPhrases, ['原有字卡']);
  assert.throws(() => sandbox.window.__duoCardSystem.remove('chat', 0), /聊天字卡删除未能保存/);
  assert.deepEqual(sandbox.state.cardPhrases, ['原有字卡']);
});


test('chat message and its card-use event are appended before the single primary save', () => {
  assert.ok(html.includes('function appendChatMessage(msg, shouldSave=true, usageEvents=[])'));
  assert.ok(/state\.chatHistory\.push\(msg\);[\s\S]*?state\.cardUsageOutbox\.push\(\.\.\.queuedEvents\)/.test(html));
  assert.ok(html.includes('if(shouldSave&&queuedEvents.length)flushChatCardUsageOutbox()'));
  assert.ok(html.includes('recordUsageEvent(event)'));
});

test('failed primary message write removes both message and pending card-use event', () => {
  const h = harness(false);
  const result = h.context.appendChatMessage(
    { sender: 'me', type: 'text', text: '同事务消息' },
    true,
    [{ eventId: 'evt-1', textSnapshot: '实际使用的字卡', source: 'chat' }]
  );
  assert.equal(result, null);
  assert.equal(h.state.chatHistory.length, 0);
  assert.equal(h.state.cardUsageOutbox.length, 0);
});

test('automated and offline replies enqueue card usage with the message save', () => {
  assert.match(html, /function pickReplyCard\(\)[\s\S]*?getCardIdAt\?\.\('chat',selected\.index\)/);
  assert.match(html, /appendChatMessage\(\{sender:'other',type:'text',text:replyText,time:'刚刚'\},true,\[\{eventId:uid\('use'\),cardId:selectedReply\.cardId/);
  assert.match(html, /appendChatMessage\(\{sender:'other',type:'text',text:reply\.text,time:'离线后'\},false,\[\{eventId:uid\('use'\),cardId:reply\.cardId,source:'chat-offline'/);
  assert.doesNotMatch(html, /recordUsed\?\.\(reply,'chat-offline'\)/);
});

test('manual chat-card fill preserves the exact duplicate-card ID by index', () => {
  assert.match(html, /addPendingCardFragment\(input,start,end,txt,window\.__duoCardSystem\?\.getCardIdAt\?\.\('chat',idx\)/);
});


test('offline catch-up writes generated messages, card events, and the reset marker in one save', () => {
  const start=html.indexOf('function processOfflineCatchup(){');
  const end=html.indexOf('\nfunction initMiniCallDrag(){',start);
  assert.ok(start>=0&&end>start);
  const fn=html.slice(start,end);
  const state={offline:{lastHiddenAt:Date.now()-3600000,lastChatAt:0,chatEnabled:true,chatMin:1,chatMax:2},cardPhrases:['离线字卡'],chatHistory:[],cardUsageOutbox:[]};
  const calls=[];
  const sandbox={state,Date,JSON,showToast:m=>calls.push(m),renderChatHistory(){calls.push('render');},flushChatCardUsageOutbox(){calls.push('flush');},pickReplyCard:()=>({text:'离线字卡',cardId:'card-offline'}),uid:()=> 'evt-offline',appendChatMessage(msg,save,events){state.chatHistory.push(msg);state.cardUsageOutbox.push(...events);return msg;},save(){calls.push('save');return true;}};
  vm.createContext(sandbox);vm.runInContext(fn+'\nthis.runCatchup=processOfflineCatchup;',sandbox);
  assert.equal(sandbox.runCatchup(),true);
  assert.equal(state.chatHistory.length,1);
  assert.equal(state.cardUsageOutbox.length,1);
  assert.equal(state.offline.lastHiddenAt,0);
  assert.deepEqual(calls,['save','flush']);
});

test('offline catch-up restores the marker and does not keep unsaved generated messages', () => {
  const start=html.indexOf('function processOfflineCatchup(){');
  const end=html.indexOf('\nfunction initMiniCallDrag(){',start);
  const fn=html.slice(start,end);
  const hiddenAt=Date.now()-3600000;
  const state={offline:{lastHiddenAt:hiddenAt,lastChatAt:0,chatEnabled:true,chatMin:1,chatMax:2},cardPhrases:['离线字卡'],chatHistory:[],cardUsageOutbox:[]};
  const calls=[];
  const sandbox={state,Date,JSON,showToast:m=>calls.push(m),renderChatHistory(){calls.push('render');},flushChatCardUsageOutbox(){calls.push('flush');},pickReplyCard:()=>({text:'离线字卡',cardId:'card-offline'}),uid:()=> 'evt-offline',appendChatMessage(msg,save,events){state.chatHistory.push(msg);state.cardUsageOutbox.push(...events);return msg;},save(){return false;}};
  vm.createContext(sandbox);vm.runInContext(fn+'\nthis.runCatchup=processOfflineCatchup;',sandbox);
  assert.equal(sandbox.runCatchup(),false);
  assert.equal(state.chatHistory.length,0);
  assert.equal(state.cardUsageOutbox.length,0);
  assert.equal(state.offline.lastHiddenAt,hiddenAt);
  assert.ok(calls.includes('render'));
});

test('failed chat-message deletion persistence restores the message and skips media collection', async () => {
  const fn = html.match(/async function removeChatMessage\(mid\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(fn, 'removeChatMessage must exist');
  const message = { id: 'm-1', mediaId: 'media-1' };
  const state = { chatHistory: [message] };
  const calls = [];
  const sandbox = {
    state, ensureChatState() {},
    save() { calls.push('save'); return false; },
    renderChatHistory() { calls.push('render'); },
    showToast(message) { calls.push(message); },
    async deleteIfUnreferenced(id) { calls.push('delete:' + id); },
  };
  vm.createContext(sandbox);
  vm.runInContext(fn + '\nthis.removeChatMessage = removeChatMessage;', sandbox);
  assert.equal(await sandbox.removeChatMessage('m-1'), false);
  assert.equal(state.chatHistory.length, 1);
  assert.equal(state.chatHistory[0].mediaId, 'media-1');
  assert.equal(calls.includes('delete:media-1'), false);
});

test('sticker deletion writes a tombstone and removes favorite in one library commit', () => {
  assert.ok(html.includes('function deleteStickerFromLibrary(id){'));
  assert.ok(html.includes('next.items.splice(index,1)'));
  assert.ok(html.includes('next.favorites=next.favorites.filter'));
  assert.ok(html.includes('next.tombstones.push'));
  assert.ok(html.includes('function writeStickerLibraryStore(library){'));
  assert.ok(html.includes('readback!==serialized'));
  const library = readFileSync(new URL('../sticker-library.js', import.meta.url), 'utf8');
  assert.ok(html.includes('id="stickerOverlay"')&&html.includes('id="stickerGrid"'));
  assert.ok(library.includes('data-sticker-id='));
  assert.doesNotMatch(library,/sticker-send|data-sticker-del-id/);
  const start=html.indexOf('async function sendSticker(stickerId){');
  const end=html.indexOf('\n}',start);
  const send=html.slice(start,end);
  assert.ok(start>=0&&end>start);
  assert.ok(send.includes('isStickerSendable(stickerId)'));
  assert.ok(send.includes('const latest=readStickerLibraryStore()'));
});

test('whole-space reset snapshots all affected stores before deletion and restores them on failure', () => {
  const reset = html.match(/async function resetWholeDuoSpace\(\)\{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(reset, /const resetKeys=\[STORAGE_KEY,STICKER_LIBRARY_STORAGE_KEY,/);
  assert.match(reset, /mediaSnapshot=await snapshotMediaRecords\(\);[\s\S]*?oldFonts=await window\.ChuanXunFontManager\.exportData\(\)/);
  assert.ok(reset.indexOf('mediaSnapshot=await snapshotMediaRecords()') < reset.indexOf('for(const key of resetKeys)localStorage.removeItem(key)'));
  assert.ok(reset.indexOf('for(const key of resetKeys)localStorage.removeItem(key)') < reset.indexOf('await clearMediaDatabase()'));
  assert.match(reset, /for\(const \[key,value\] of oldStorage\)[\s\S]*?restoreMediaSnapshot\(mediaSnapshot\)[\s\S]*?importData\(oldFonts,\{replace:true\}\)[\s\S]*?init\(\);renderStickerList\(\);loadMessageMedia\(\)/);
  assert.match(html, /async function restoreMediaSnapshot\(records\)/);
});

test('chat card provenance tracks multiple insertions, shifts after edits, and drops edited fragments', () => {
  const start=html.indexOf('function updatePendingCardFragmentsOnInput(input){');
  const end=html.indexOf('function sendCurrentText(forceText){',start);
  assert.ok(start>=0&&end>start);
  const helpers=html.slice(start,end);
  const sandbox={uid:()=> 'evt-test',Date};
  vm.createContext(sandbox);vm.runInContext(helpers+'\nthis.addPendingCardFragment=addPendingCardFragment;this.updatePendingCardFragmentsOnInput=updatePendingCardFragmentsOnInput;this.getPendingCardUsageEvents=getPendingCardUsageEvents;',sandbox);
  const input={value:'',dataset:{}};
  input.value='第一张';sandbox.addPendingCardFragment(input,0,0,'第一张','id-1');
  input.value+='第二张';sandbox.addPendingCardFragment(input,3,3,'第二张','id-2');
  input.value='前缀'+input.value;sandbox.updatePendingCardFragmentsOnInput(input);
  let fragments=JSON.parse(input.dataset.pendingCardFragments);
  assert.deepEqual(Array.from(fragments,x=>x.cardId),['id-1','id-2']);
  assert.deepEqual(Array.from(fragments,x=>x.start),[2,5]);
  const events=sandbox.getPendingCardUsageEvents(input,input.value);
  assert.deepEqual(Array.from(events,x=>x.cardId),['id-1','id-2']);
  input.value=input.value.replace('第一张','第一x张');sandbox.updatePendingCardFragmentsOnInput(input);
  fragments=JSON.parse(input.dataset.pendingCardFragments);
  assert.deepEqual(Array.from(fragments,x=>x.cardId),['id-2'],'editing inside the first card fragment invalidates only that fragment');
});


test('chat card outbox loading preserves more than 500 pending events', () => {
  assert.match(html, /state\.cardUsageOutbox=Array\.isArray\(saved\.cardUsageOutbox\)\?saved\.cardUsageOutbox\.filter\(x=>x&&typeof x\.textSnapshot==='string'\):\[\]/);
  assert.doesNotMatch(html, /cardUsageOutbox[^;]*slice\(-500\)/);
});

test('whole-space reset restores local state, media, and fonts when a later reset step fails', async () => {
  const fn=html.match(/async function resetWholeDuoSpace\(\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(fn);
  const keys=['main','dual_space_sticker_library_v1','twodeers_mailbox_letters_v1','twodeers_mailbox_drafts_v1','twodeers_card_system_v1'];
  const values=new Map(keys.map(key=>[key,'saved:'+key]));
  const calls=[];let restoredFonts=false,tasksPaused=false,mediaCleared=false;
  const fontManager={async exportData(){return {currentFontId:'font-1',fonts:[{id:'font-1',blob:{size:10}}]};},async importData(data){if(!data.fonts.length)throw new Error('injected font clear failure');restoredFonts=true;}};
  const sandbox={
    STORAGE_KEY:'main',STICKER_LIBRARY_STORAGE_KEY:'dual_space_sticker_library_v1',state:{call:{phase:'ringing'},incomingCallNextAt:999},confirm:()=>true,
    localStorage:{getItem:key=>values.get(key)??null,setItem(key,value){values.set(key,String(value));},removeItem(key){values.delete(key);}},
    window:{ChuanXunFontManager:fontManager,__duoCircleApi:{pauseTasks(){tasksPaused=true;},resumeTasks(){tasksPaused=false;}},__duoMailbox:{pauseTasks(){},resumeTasks(){}}},
    async snapshotMediaRecords(){return [{id:'media-1',blob:{size:12},kind:'image',name:'keep.png'}];},
    async restoreMediaSnapshot(records){calls.push('restore-media:'+records[0].id);},
    async clearMediaDatabase(){mediaCleared=true;},
    cancelPendingReplies(){},clearIncomingRingTimer(){},clearIncomingSchedule(){},initializeIncomingCallScheduler(){},
    mediaLoadGeneration:0,init(){calls.push('init');},renderStickerList(){},loadMessageMedia(){},
    location:{reload(){calls.push('reload');}},showToast(message){calls.push(String(message));},
  };
  vm.createContext(sandbox);vm.runInContext(fn+'\nthis.resetWholeDuoSpace=resetWholeDuoSpace;',sandbox);
  await sandbox.resetWholeDuoSpace();
  assert.equal(mediaCleared,true);
  assert.equal(restoredFonts,true);
  assert.equal(tasksPaused,false);
  assert.ok(calls.includes('restore-media:media-1'));
  assert.ok(calls.includes('init'));
  assert.equal(calls.includes('reload'),false);
  for(const key of keys)assert.equal(values.get(key),'saved:'+key,`storage key ${key} must be restored`);
  assert.ok(calls.some(message=>/已恢复重置前的数据/.test(message)));
});

test('failed clear-chat persistence restores the full history and skips media collection', async () => {
  const fn=html.match(/async function clearChatOnly\(\)\{[\s\S]*?\n\}/)?.[0];assert.ok(fn);
  const history=[{id:'m-1',mediaId:'img-1'},{id:'m-2',mediaId:'voice-1'}],calls=[];
  const sandbox={state:{chatHistory:history},confirm:()=>true,save:()=>false,cancelPendingReplies(){calls.push('cancel');},renderChatHistory(){calls.push('render');},async deleteIfUnreferenced(id){calls.push('delete:'+id);},showToast(message){calls.push(message);}};
  vm.createContext(sandbox);vm.runInContext(fn+'\nthis.clearChatOnly=clearChatOnly;',sandbox);
  await sandbox.clearChatOnly();
  assert.equal(sandbox.state.chatHistory.length,2);
  assert.equal(calls.some(x=>String(x).startsWith('delete:')),false);
  assert.equal(calls.includes('cancel'),false);
});

test('long-text send can carry card provenance only when the inserted phrase remains in the sent text', () => {
  const start=html.indexOf('function updatePendingCardFragmentsOnInput(input){');
  const end=html.indexOf('function sendCurrentText(forceText){',start);
  const helpers=html.slice(start,end),sandbox={uid:()=> 'evt-long',Date};
  vm.createContext(sandbox);vm.runInContext(helpers+'\nthis.getPendingCardUsageEvents=getPendingCardUsageEvents;',sandbox);
  const input={value:'输入框里插入的卡片',dataset:{pendingCardFragments:JSON.stringify([{start:0,end:9,cardId:'card-long',source:'chat',textSnapshot:'输入框里插入'}])}};
  const retained=sandbox.getPendingCardUsageEvents(input,'一段长文本：输入框里插入的卡片，后面还有内容',true);
  assert.equal(retained.length,1);assert.equal(retained[0].cardId,'card-long');
  const removed=sandbox.getPendingCardUsageEvents(input,'一段完全不同的长文本',true);
  assert.equal(removed.length,0);
});

test('chat message with card usage is held back when its durable outbox is full', () => {
  const h=harness(true);
  h.state.cardUsageOutbox=Array.from({length:1000},(_,i)=>({eventId:'old-'+i,textSnapshot:'旧字卡'+i,source:'chat'}));
  const before=h.state.cardUsageOutbox.map(x=>x.eventId);
  const result=h.context.appendChatMessage({sender:'me',type:'text',text:'含字卡的消息'},true,[{eventId:'new-event',textSnapshot:'新字卡',source:'chat'}]);
  assert.equal(result,null);
  assert.equal(h.state.chatHistory.length,0);
  assert.deepEqual(Array.from(h.state.cardUsageOutbox,x=>x.eventId),before);
  assert.ok(h.messages.some(message=>/队列已满/.test(message)));
});
