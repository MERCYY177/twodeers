import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const source = html.match(/<script id="circleScriptSource" type="text\/plain">([\s\S]*?)<\/script>/)?.[1];
assert.ok(source, 'Circle source must exist');
const start = source.indexOf('let lastPersistedStateJson=');
const end = source.indexOf('function load(){', start);
assert.ok(start >= 0 && end > start, 'Circle transaction helpers must exist before load()');
const transactionSource = source.slice(start, end);

function harness() {
  const initial = { posts: [{ id: 'old-post' }], pendingEvents: [], usageOutbox: [] };
  const values = new Map([['circle-test', JSON.stringify(initial)]]);
  let failWrites = false;
  let writes = 0;
  const toasts = [];
  const context = {
    state: initial,
    STORE_KEY: 'circle-test',
    localStorage: {
      getItem(key) { return values.has(key) ? values.get(key) : null; },
      setItem(key, value) { if (failWrites) throw new Error('quota exceeded'); values.set(key, String(value)); writes++; },
      removeItem(key) { values.delete(key); },
    },
    window: {},
    currentDetailId: '',
    renderPosts() {},
    renderDetail() {},
    refreshViewerIfNeeded() {},
    renderNoticeBar() {},
    showToast(message) { toasts.push(String(message)); },
  };
  vm.createContext(context);
  vm.runInContext(transactionSource + '\nthis.circleTransaction = circleTransaction; this.queueCircleUsage = queueCircleUsage; this.saveCircle = save;', context);
  return {
    context,
    values,
    toasts,
    setFailWrites(value) { failWrites = value; },
    get writes() { return writes; },
  };
}

test('Circle groups multiple saves into one persisted transaction', () => {
  const h = harness();
  const result = h.context.circleTransaction('测试事务', () => {
    h.context.state.posts.push({ id: 'new-post' });
    h.context.saveCircle();
    h.context.state.pendingEvents.push({ type: 'other_like', postId: 'new-post', due: 123 });
    h.context.saveCircle();
    return true;
  });
  assert.equal(result, true);
  assert.equal(h.writes, 1, 'one transaction performs one localStorage commit');
  const persisted = JSON.parse(h.values.get('circle-test'));
  assert.deepEqual(persisted.posts.map(x => x.id), ['old-post', 'new-post']);
  assert.equal(persisted.pendingEvents.length, 1);
});

test('Circle restores the last committed state when localStorage rejects a transaction', () => {
  const h = harness();
  h.setFailWrites(true);
  const result = h.context.circleTransaction('发布动态', () => {
    h.context.state.posts.push({ id: 'must-not-survive' });
    h.context.state.pendingEvents.push({ type: 'other_comment', postId: 'must-not-survive' });
    h.context.saveCircle();
    return true;
  });
  assert.equal(result, false);
  assert.deepEqual(Array.from(h.context.state.posts, x => x.id), ['old-post']);
  assert.deepEqual(Array.from(h.context.state.pendingEvents), []);
  assert.match(h.toasts[0], /已恢复到上一次成功状态/);
});

test('Circle queues actual card use in the same state snapshot as the related mutation', () => {
  const h = harness();
  h.context.window.__duoCardSystem = { getCardIdAt: () => 'card-exact-2' };
  const result = h.context.circleTransaction('自动动态', () => {
    h.context.state.posts.push({ id: 'post-with-card' });
    h.context.queueCircleUsage('同文案的第二张卡', 'moments-dynamic', 'card-exact-2');
    h.context.saveCircle();
    return true;
  });
  assert.equal(result, true);
  const persisted = JSON.parse(h.values.get('circle-test'));
  assert.equal(persisted.posts[1].id, 'post-with-card');
  assert.equal(persisted.usageOutbox[0].cardId, 'card-exact-2');
  assert.equal(persisted.usageOutbox[0].textSnapshot, '同文案的第二张卡');
});

test('Circle user and automatic mutation entry points are covered by the transaction wrapper', () => {
  assert.match(source, /postMine=function\(\.\.\.args\)\{[^\n]*circleTransaction\('发布动态'/);
  assert.match(source, /postOtherNow=function\(\.\.\.args\)\{[^\n]*circleTransaction\('自动发布动态'/);
  assert.match(source, /toggleMyLike=function\(\.\.\.args\)\{return circleTransaction\('点赞'/);
  assert.match(source, /setPostPrivacy=function\(\.\.\.args\)\{return circleTransaction\('修改动态可见范围'/);
  assert.match(source, /deletePost=function\(\.\.\.args\)\{return circleTransaction\('删除动态'/);
  assert.match(source, /processPending=function\(\.\.\.args\)\{return circleTransaction\('自动互动'/);
  assert.match(source, /circleTransaction\('发布评论'/);
  assert.match(source, /setTimeout\(\(\)=>\{if\(!window\.__duoCircleRestorePaused\)processPending\(\);\}, 0\)/);
  assert.match(source, /if\(published!==false\)hidePostModal\(\)/);
});

test('Circle settings do not render a successful save after the primary write fails', () => {
  assert.match(source, /circleTransaction\('保存朋友圈设置',[\s\S]*?planNextOtherPost\(true,false\)[\s\S]*?save\(\);[\s\S]*?return true;/);
  assert.match(source, /if\(await saveSettings\(\)===true\)hideSettings\(\)/);
});

test('Circle outbox does not silently truncate pending events at 500', () => {
  const h=harness();
  h.context.state.usageOutbox=Array.from({length:600},(_,i)=>({eventId:'old-'+i,textSnapshot:'卡'+i,source:'circle'}));
  h.context.queueCircleUsage('最新事件','moments-dynamic','card-new');
  assert.equal(h.context.state.usageOutbox.length,601);
  assert.equal(h.context.state.usageOutbox.at(-1).cardId,'card-new');
});

test('Circle transaction keeps the business commit successful when usage projection fails', () => {
  const h=harness();
  h.context.window.__duoCardSystem={flushOutbox(){throw new Error('projection unavailable');}};
  const result=h.context.circleTransaction('发布动态',()=>{h.context.state.posts.push({id:'saved'});h.context.saveCircle();return true;});
  assert.equal(result,true);
  assert.equal(JSON.parse(h.values.get('circle-test')).posts.at(-1).id,'saved');
  assert.ok(h.toasts.some(message=>/已保存，字卡使用记录将在稍后重试/.test(message)));
});

test('Circle next-post planning can update the schedule without nested persistence', () => {
  const fn=source.match(/function planNextOtherPost\(force=false, shouldSave=true\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(fn);
  const calls=[];
  const sandbox={state:{autoPost:'on',dynamicCards:['动态'],nextOtherPostAt:0,postMin:10,postMax:10},Date:{now:()=>1000},rand:()=>10,save(){calls.push('save');return true;},updateNextHint(){calls.push('hint');}};
  vm.createContext(sandbox);vm.runInContext(fn+'\nthis.planNextOtherPost=planNextOtherPost;',sandbox);
  sandbox.planNextOtherPost(true,false);
  assert.equal(calls.includes('save'),false,'settings transaction owns the only persistence commit');
  assert.equal(sandbox.state.nextOtherPostAt,601000);
  assert.deepEqual(calls,['hint']);
  sandbox.planNextOtherPost(true);
  assert.equal(calls.filter(x=>x==='save').length,1,'ordinary scheduling still persists by default');
});

test('Circle usage outbox refuses new events at capacity without dropping older events', () => {
  const h=harness();
  h.context.state.usageOutbox=Array.from({length:1000},(_,i)=>({eventId:'retained-'+i,textSnapshot:'卡'+i,source:'circle'}));
  const before=h.context.state.usageOutbox.slice();
  assert.equal(h.context.queueCircleUsage('新事件','moments-dynamic','card-new','post-new'),false);
  assert.equal(h.context.state.usageOutbox.length,1000);
  assert.deepEqual(Array.from(h.context.state.usageOutbox,x=>x.eventId),before.map(x=>x.eventId));
});

test('Circle usage events retain their originating post identifier', () => {
  const h=harness();
  assert.equal(h.context.queueCircleUsage('动态字卡','moments-dynamic','card-1','post-42'),true);
  const event=h.context.state.usageOutbox[0];
  assert.equal(event.postId,'post-42');
  assert.equal(event.sourceId,'post-42');
});
