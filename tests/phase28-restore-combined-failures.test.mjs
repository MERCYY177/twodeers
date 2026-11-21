import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backup = await readFile(path.join(ROOT, 'backup-v4.js'), 'utf8');
const runtimeCoordinator = await readFile(path.join(ROOT, 'runtime-coordinator.js'), 'utf8');

function section(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `missing production-source boundaries: ${start} -> ${end}`);
  return source.slice(a, b);
}

const restore = section(backup, '  async function restoreV4Internal(blob){', '\n  async function recoverInterruptedRestore(){');
const interrupted = section(backup, '  async function recoverInterruptedRestore(){', '\n  let restoreInProgress=false;');

// Execute the real restoreV4Internal production function under its fixture's
// injected multi-fault combinations. This covers font/media rollback and the
// PREPARED journal cleanup failure, not a parallel mock implementation.
const atomicity = spawnSync(process.execPath, ['tests/backup-atomicity.test.mjs'], {
  cwd: ROOT,
  encoding: 'utf8',
  timeout: 90_000,
});
assert.equal(atomicity.status, 0, `backup atomicity / Phase 28 injected restore cases failed:\n${atomicity.stdout}\n${atomicity.stderr}`);
assert.match(atomicity.stdout, /Phase 28|journal|回滚/i);

// A PREPARED record must be attempted and its ambiguous write result resolved
// before the first irreversible media or state mutation.
const preparedAt = restore.indexOf('const preparedJournal=');
const saveJournalAt = restore.indexOf('await coordinator.saveRecoveryJournal(preparedJournal);');
const firstMediaWriteAt = restore.indexOf('await putMediaBlob(');
const firstStateWriteAt = restore.indexOf("Object.keys(state).forEach(k=>delete state[k]);Object.assign(state,incomingState)");
assert.ok(preparedAt >= 0 && saveJournalAt > preparedAt);
assert.ok(firstMediaWriteAt > saveJournalAt, 'media writes must start only after PREPARED journal persistence');
assert.ok(firstStateWriteAt > saveJournalAt, 'main state replacement must start only after PREPARED journal persistence');
assert.match(restore, /readRecoveryJournal\(\)/, 'ambiguous journal write must be followed by journal read-back');
assert.match(restore, /日志写入\/回读结果不确定/);
assert.match(restore, /journalMayExist\)\{[\s\S]*?setRecoveryBlocked/);

// COMMITTED is written only after main state, module imports, media reads and
// UI/Circle verification. Old media GC and journal cleanup must follow it.
const committedAt = restore.indexOf('await coordinator.markRecoveryCommitted();');
const clearAt = restore.indexOf('await coordinator.clearRecoveryJournal();', committedAt);
const cleanupAt = restore.indexOf('cleanupReplacedMediaReferences(oldMediaReferences)', committedAt);
assert.ok(committedAt > restore.indexOf('const circleLoad=await window.__duoCircleMedia?.ensure?.(getCircleState());'));
assert.ok(clearAt > committedAt);
assert.ok(cleanupAt > committedAt);

// If rollback itself is incomplete OR rollback is complete but PREPARED cannot
// be cleared, the current page must be fenced before it can accept new writes.
assert.match(restore, /if\(rollbackErrors\.length\)\{[\s\S]*?setRecoveryBlocked\?\.\(reason\)[\s\S]*?throw new Error/);
assert.match(restore, /PREPARED 保护日志未能确认清理[\s\S]*?setRecoveryBlocked\?\.\(reason\)/);
assert.match(restore, /journalCommitUncertain[\s\S]*?setRecoveryBlocked\?\.\(reason\)[\s\S]*?throw new Error/);

// PREPARED, COMMITTED and deletion all require actual strict transaction durability.
assert.match(runtimeCoordinator, /function beginStrictJournalWrite\(db, operation\)/);
assert.match(runtimeCoordinator, /db\.transaction\(JOURNAL_STORE, 'readwrite', \{ durability: 'strict' \}\)/);
assert.match(runtimeCoordinator, /tx\.durability !== 'strict'/);
assert.match(runtimeCoordinator, /tx\.oncomplete = function \(\) \{ if \(requestFailed\) reject\(requestFailed\); else resolve\(result\); \};/);
assert.match(runtimeCoordinator, /COMMITTED 恢复标记事务已完成，但回读内容不一致，提交状态不确定/);
assert.match(runtimeCoordinator, /if \(await readRecoveryJournal\(\) !== null\) throw new Error\('恢复保护日志删除后回读仍然存在'\)/);

// Startup rollback confirms each authoritative module by read-back. Any
// failure leaves PREPARED in place and closes the coordinator write gate.
assert.match(interrupted, /restoreSnapshot\?\.\(journal\.oldStickerLibrary\)[\s\S]*?exportSnapshot\?\.\(\)/);
assert.match(interrupted, /信件数据恢复后回读不一致/);
assert.match(interrupted, /字卡数据恢复后回读不一致/);
assert.match(interrupted, /字体库恢复后回读不一致/);
assert.match(interrupted, /媒体恢复后回读不一致/);
assert.match(interrupted, /PREPARED 保护日志仍保留[\s\S]*?setRecoveryBlocked\?\.\(reason\)/);
const circleCheckAt = interrupted.indexOf('const circleCheck=await window.__duoCircleMedia?.ensure?.(getCircleState());');
assert.ok(circleCheckAt >= 0 && interrupted.indexOf('await coordinator.clearRecoveryJournal();', circleCheckAt) > circleCheckAt, 'startup PREPARED journal must clear only after media verification');

console.log('PASS: Phase 28 V4 restore combined-failure gates: PREPARED-before-write, strict journal durability, ambiguous PREPARED/COMMITTED fencing, media/font/module rollback read-back, retained journals on incomplete cleanup, COMMITTED-before-GC, and startup retry safety.');
