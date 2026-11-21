#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const manifest = JSON.parse(read('assets/builtin-stickers/manifest.json'));
assert.equal(manifest.version, 1);
assert.equal(manifest.totalCount, 352);
assert.equal(manifest.items.length, 352);
for (const item of manifest.items) {
  assert.ok(item.assetUrl.startsWith('assets/builtin-stickers/'), `unexpected sticker path: ${item.assetUrl}`);
  const asset = path.join(root, decodeURIComponent(item.assetUrl));
  assert.ok(fs.statSync(asset).isFile(), `missing sticker asset: ${item.assetUrl}`);
  assert.equal(fs.statSync(asset).size, item.size, `sticker size mismatch: ${item.assetUrl}`);
}

// Android system backup is disabled; both legacy backup and Android 12+ extraction
// / device-transfer rules explicitly exclude all app-owned storage domains.
const androidManifest = read('android-apps/app/src/main/AndroidManifest.xml');
assert.match(androidManifest, /android:allowBackup="false"/);
assert.match(androidManifest, /android:fullBackupContent="@xml\/backup_rules"/);
assert.match(androidManifest, /android:dataExtractionRules="@xml\/data_extraction_rules"/);
assert.match(androidManifest, /android:enableOnBackInvokedCallback="true"/);
const oldRules = read('android-apps/app/src/main/res/xml/backup_rules.xml');
const newRules = read('android-apps/app/src/main/res/xml/data_extraction_rules.xml');
for (const domain of ['root', 'file', 'database', 'sharedpref', 'external']) {
  assert.ok(oldRules.includes(`<exclude domain="${domain}" path="."`));
  assert.ok(newRules.includes(`<exclude domain="${domain}" path="."`));
}
for (const domain of ['device_root', 'device_file', 'device_database', 'device_sharedpref']) {
  assert.ok(newRules.includes(`<exclude domain="${domain}" path="."`));
}
assert.match(newRules, /<cloud-backup>/);
assert.match(newRules, /<device-transfer>/);

const gradle = read('android-apps/app/build.gradle.kts');
assert.match(gradle, /verifyBuiltinStickers/);
assert.match(gradle, /URLDecoder\.decode/);
assert.doesNotMatch(gradle, /sticker-source|prepare-builtin-stickers\.py/);
assert.doesNotMatch(gradle, /\\\$\{/);

const activity = read('android-apps/app/src/main/java/com/mercyy/twodeers/MainActivity.java');
const backup = read('backup-v4.js');
const appearance = read('appearance-manager.js');
const index = read('index.html');
const circleMediaManager = read('circle-media-manager.js');
const storageDiagnostics = read('storage-diagnostics.js');
const runtimeCoordinator = read('runtime-coordinator.js');
const recoveryWorkbench = read('recovery-workbench.js');
const recoveryCandidateZip = read('recovery-candidate-package.js');
const recoveryCandidateValidator = read('recovery-candidate-validator.js');
const recoveryIsolationEngine = read('recovery-isolation-engine.js');
const recoveryApplicationAuditor = read('recovery-application-auditor.js');
const isolatedApplicationRehearsal = read('tests/isolated-application-rehearsal-e2e.mjs');
const isolatedApplicationWorkflow = read('.github/workflows/isolated-application-rehearsal.yml');
const isolatedApplicationFixtures = read('tests/isolated-application-fixtures.mjs');
const isolatedRestoreLifecycle = read('tests/isolated-restore-lifecycle-e2e.mjs');
const isolatedRestoreCrashWorker = read('tests/isolated-restore-crash-worker.mjs');
const isolatedRestoreLifecycleWorkflow = read('.github/workflows/isolated-restore-lifecycle.yml');
const browserEvidenceRunner = read('tests/run-browser-with-evidence.mjs');
const browserEvidenceRunnerTestSource = read('tests/browser-evidence-runner.test.mjs');
const browserCiContractTestSource = read('tests/browser-ci-contract.test.mjs');
assert.match(isolatedApplicationRehearsal, /await chromium\.launch/);
assert.match(isolatedApplicationRehearsal, /createValidSeed\(\)/);
assert.match(isolatedApplicationRehearsal, /browser\.newContext/);
assert.match(isolatedApplicationRehearsal, /openStickerPanel/);
assert.match(isolatedApplicationRehearsal, /stickerMessagePersisted/);
assert.match(isolatedApplicationRehearsal, /mailLetterList|data-mail-open/);
assert.match(isolatedApplicationFixtures, /export function createValidSeed/);
assert.match(isolatedApplicationFixtures, /export function createMissingMediaSeed/);
assert.match(isolatedApplicationRehearsal, /phase17-chat-media/);
assert.match(isolatedApplicationRehearsal, /phase17-sticker-media/);
assert.match(isolatedApplicationRehearsal, /phase17-mail-media/);
assert.match(isolatedApplicationRehearsal, /phase17-circle-post-media/);
assert.match(isolatedApplicationRehearsal, /ChuanXunFontManager/);
assert.match(isolatedApplicationRehearsal, /external-request/);
const videoMediaPathsSource = read('tests/video-media-paths.test.mjs');
const voiceMediaPathsSource = read('tests/voice-media-paths.test.mjs');
const mailboxCircleWritePathsSource = read('tests/mailbox-circle-write-paths.test.mjs');
const phase25LifecycleSource = read('tests/phase25-circle-mailbox-lifecycle.test.mjs');
const storageQuotaBackgroundSource = read('tests/storage-quota-background.test.mjs');
const phase27CrossModuleSource = read('tests/phase27-cross-module-faults.test.mjs');
const phase28RestoreSource = read('tests/phase28-restore-combined-failures.test.mjs');
const phase29CrashHarness = read('tests/chromium-v4-restore-crash-matrix.mjs');
const phase29CrashHarnessTest = read('tests/chromium-v4-restore-crash-matrix.test.mjs');
const phase33EvidencePersistenceTest = read('tests/phase33-ci-evidence-persistence.test.mjs');
const phase34ProcessGroupCleanupTest = read('tests/phase34-chromium-process-group-cleanup.test.mjs');
const phase31StrictDurabilitySource = read('tests/phase31-restore-strict-durability.test.mjs');
assert.match(mailboxCircleWritePathsSource, /commitPostMineWithMedia/);
assert.match(mailboxCircleWritePathsSource, /mail-media-1/);
assert.match(phase25LifecycleSource, /openEditPost|editingPostId/);
assert.match(phase25LifecycleSource, /pending auto-reply|auto-reply|pending/);
assert.match(phase25LifecycleSource, /profileSettingsSaving/);
assert.match(phase25LifecycleSource, /shared-profile/);
assert.match(storageQuotaBackgroundSource, /revision-unreliable/);
assert.match(phase27CrossModuleSource, /RevisionMarkerError|markDataChanged/);
assert.match(phase28RestoreSource, /PREPARED-before-write/);
assert.match(phase29CrashHarness, /window\.__duoBackupV4\.restore\(window\.__phase30Archive\)/);
assert.match(phase29CrashHarness, /process\.kill\(-child\.pid, 'SIGKILL'\)/);
assert.match(phase29CrashHarness, /'prepared'.*'media'.*'font'.*'committed'/s);
assert.match(phase29CrashHarnessTest, /same persistent browser profile/);
assert.match(phase29CrashHarness, /id==='phase17-chat-media'/);
assert.match(phase29CrashHarness, /assert\.notEqual\(targetFontBase64, sourceFontBase64/);
assert.match(phase29CrashHarness, /fontBytes/);
assert.match(phase29CrashHarness, /mediaRecords/);
assert.match(phase29CrashHarness, /waitForProcessGroupExit\(child\.pid\)/);
assert.match(phase29CrashHarness, /window\.__duoBackupV4\.unzip\(window\.__phase30Archive\)/);
assert.match(phase29CrashHarness, /phase33-chromium-v4-ci-independent-matrix\.json/);
assert.match(phase29CrashHarness, /media-inflight/);
assert.match(phase29CrashHarness, /font-inflight/);
assert.match(phase29CrashHarness, /assertPreStartupProfile\(stage, preStartupProfile, sourceFontBase64, targetFontBase64\)/);
assert.match(phase29CrashHarness, /phase33-chromium-v4-ci-independent-matrix\.json/);
assert.match(phase29CrashHarness, /Runtime\.bindingCalled/);
assert.match(phase29CrashHarness, /writeJsonAtomic/);
assert.match(phase29CrashHarness, /failed-profiles/);
assert.match(phase29CrashHarness, /phase33-chromium-v4-ci-independent-matrix\.json/);
assert.match(phase33EvidencePersistenceTest, /independent CI job scheduling/);
assert.match(phase34ProcessGroupCleanupTest, /exited leader with live descendants/);
assert.match(phase29CrashHarness, /signalChromeProcessGroup\(child\)/);
assert.match(phase29CrashHarness, /finalizeFailedRunCase/);
assert.match(phase31StrictDurabilitySource, /durability/);
assert.match(phase31StrictDurabilitySource, /ordinary.*default|default.*ordinary/i);
assert.match(read('index.html'), /assertMediaStrictDurability/);
assert.match(read('custom-font-manager.js'), /assertImportDurability/);
assert.match(read('backup-v4.js'), /durability:'strict'/);
assert.match(isolatedApplicationRehearsal, /第二十五阶段朋友圈动态编辑/);
assert.match(isolatedApplicationRehearsal, /第二十五阶段自动回信演练/);
assert.match(videoMediaPathsSource, /openMediaPreview/);
assert.match(videoMediaPathsSource, /commitChatMediaBlob/);
assert.match(voiceMediaPathsSource, /MediaRecorder success\/cancel\/error/);
assert.match(index, /handleVoicePointerCaptureLost/);
assert.match(index, /function cancelVoiceCaptureOnPageHide\(force=false\)\{if\(\(force\|\|document\.hidden\)&&\(pendingVoicePress\|\|isRecording\)\)/);
assert.match(index, /window\.addEventListener\('pagehide',\(\)=>\{cancelVoiceCaptureOnPageHide\(true\);releaseWakeLock\(\);\}\)/);
assert.ok(index.includes('if(beforeCircleMediaIds&&window.__duoCircleMedia?.collectIdsFromState)'), 'Circle root transaction must compare pre/post media references');
assert.ok(index.includes('Promise.resolve(deleteIfUnreferenced(id)).then(deleted=>{if(deleted)window.__duoCircleMedia?.release?.(id);})'), 'Circle transaction must release cached URLs only after global media deletion succeeds');
assert.match(index, /if\(post\.author !== 'me'\)\{\s*grid\.innerHTML/);
assert.match(isolatedApplicationRehearsal, /--use-fake-device-for-media-stream/);
assert.match(isolatedApplicationRehearsal, /phase23-video\.webm/);
assert.match(isolatedApplicationRehearsal, /媒体文件丢失/);
assert.doesNotMatch(isolatedApplicationRehearsal, /mercyy177\.github\.io|github\.com\/MERCYY177\/twodeers/i, 'isolated rehearsal must not target deployed or remote origins');
assert.match(isolatedApplicationWorkflow, /playwright@1\.65\.0/);
assert.match(isolatedApplicationWorkflow, /isolated-application-rehearsal-e2e\.mjs/);
assert.match(isolatedApplicationWorkflow, /node_modules\/.bin\/playwright install --with-deps chromium/);
assert.match(isolatedApplicationWorkflow, /run-browser-with-evidence\.mjs phase17/);
assert.match(isolatedApplicationWorkflow, /actions\/upload-artifact@v4/);
assert.match(isolatedApplicationWorkflow, /if: always\(\)/);
assert.match(isolatedRestoreLifecycle, /__duoBackupV4\.build\('all'\)/);
assert.match(isolatedRestoreLifecycle, /__duoBackupV4\.restore/);
assert.match(isolatedRestoreLifecycle, /phase18-injected-font-post-write-failure/);
assert.match(isolatedRestoreLifecycle, /promotionAvailable/);
assert.match(isolatedRestoreLifecycle, /SIGKILL/);
assert.match(isolatedRestoreLifecycle, /isolated-restore-crash-worker\.mjs/);
assert.match(isolatedRestoreCrashWorker, /phase: 'prepared'/);
assert.match(isolatedRestoreCrashWorker, /durabilitys*:s*'strict'/);
assert.match(isolatedRestoreCrashWorker, /recover/i);
assert.doesNotMatch(isolatedRestoreLifecycle + isolatedRestoreCrashWorker, /mercyy177\.github\.io|github\.com\/MERCYY177\/twodeers/i, 'phase18 lifecycle rehearsal must not target deployed or remote origins');
assert.match(isolatedRestoreLifecycleWorkflow, /playwright@1\.65\.0/);
assert.match(isolatedRestoreLifecycleWorkflow, /isolated-restore-lifecycle-e2e\.mjs/);
assert.match(isolatedRestoreLifecycleWorkflow, /fonts-dejavu-core/);
assert.match(isolatedRestoreLifecycleWorkflow, /node_modules\/.bin\/playwright install --with-deps chromium/);
assert.match(isolatedRestoreLifecycleWorkflow, /run-browser-with-evidence\.mjs phase18/);
assert.match(isolatedRestoreLifecycleWorkflow, /actions\/upload-artifact@v4/);
assert.match(isolatedRestoreLifecycleWorkflow, /if: always\(\)/);
assert.match(browserEvidenceRunner, /timed_out/);
assert.match(browserEvidenceRunner, /SIGTERM/);
assert.match(browserEvidenceRunner, /SIGKILL/);
assert.match(browserEvidenceRunner, /summary\.json/);
assert.match(browserEvidenceRunnerTestSource, /intentional-runner-failure/);
assert.match(browserEvidenceRunnerTestSource, /timeout-worker-ready/);
assert.match(browserEvidenceRunnerTestSource, /phase20-parent-exits-before-grandchild/);
assert.match(browserEvidenceRunner, /function trackClose\(child\)/);
assert.match(browserEvidenceRunner, /process\.kill\(-child\.pid, signal\)/);
assert.match(browserEvidenceRunner, /summary\.runnerError = runnerError/);
assert.match(browserCiContractTestSource, /05-evidence-runner-self-test\.log/);
assert.match(isolatedRestoreLifecycle, /if \(!worker\.closeInfo && worker\.child\.pid\)/);
assert.ok(circleMediaManager.includes('async function performLegacyMigration(options={})'));
assert.ok(circleMediaManager.includes('async function cleanupReplaced(oldState,newState)'));
assert.match(index, /<script src="storage-diagnostics\.js"><\/script>/);
assert.match(index, /<script src="recovery-candidate-package\.js"><\/script>/);
assert.match(index, /<script src="recovery-candidate-validator\.js"><\/script>/);
assert.match(index, /<script src="recovery-isolation-engine\.js"><\/script>/);
assert.match(index, /<script src="recovery-application-auditor\.js"><\/script>/);
assert.ok(index.indexOf('recovery-candidate-package.js') < index.indexOf('recovery-candidate-validator.js') && index.indexOf('recovery-candidate-validator.js') < index.indexOf('recovery-isolation-engine.js') && index.indexOf('recovery-candidate-validator.js') < index.indexOf('recovery-application-auditor.js'), 'recovery script dependency order must be deterministic');
assert.match(index, /<script src="recovery-workbench\.js"><\/script>/);
assert.match(index, /id="recoveryWorkbenchFile"[^>]*data-duo-readonly-allowed="true"/);
assert.match(index, /id="recoveryWorkbenchAnalyzeBtn"[^>]*data-duo-readonly-allowed="true"/);
assert.match(index, /id="recoveryWorkbenchExportBtn"[^>]*data-duo-readonly-allowed="true"/);
assert.match(index, /id="recoveryWorkbenchCandidateBtn"[^>]*data-duo-readonly-allowed="true"/);
assert.match(index, /id="recoveryWorkbenchIncludeRevisionProposal"[^>]*data-duo-readonly-allowed="true"/);
for (const id of ['recoveryIsolationFile','recoveryIsolationValidateBtn','recoveryIsolationBuildBtn','recoveryIsolationIncludeRevision']) assert.match(index, new RegExp('id=\"' + id + '\"[^>]*data-duo-readonly-allowed=\"true\"'), `missing read-only recovery control: ${id}`);
assert.match(runtimeCoordinator, /recoveryWorkbenchFile.*storageDiagnosticsBtn/);
assert.match(recoveryWorkbench, /twodeers-recovery-preview/);
assert.match(recoveryWorkbench, /MAX_INPUT_BYTES = 128 \* 1024 \* 1024/);
assert.match(recoveryWorkbench, /localStorage-set-preview/);
assert.match(recoveryWorkbench, /downloadCandidatePackage/);
assert.match(recoveryWorkbench, /twodeers-recovery-candidate/);
assert.match(recoveryWorkbench, /importableAsBackup: false, writesPerformed: false/);
assert.match(recoveryCandidateZip, /0x04034B50/);
assert.match(recoveryCandidateZip, /0x02014B50/);
assert.match(recoveryCandidateZip, /0x06054B50/);
assert.doesNotMatch(recoveryCandidateZip, /global\.(?:localStorage|indexedDB)/);
assert.match(recoveryCandidateValidator, /本地头与中央目录|本地文件头与中央目录|local header/i);
assert.match(recoveryCandidateValidator, /SHA-256/);
assert.match(recoveryCandidateValidator, /validateOverlay/);
assert.doesNotMatch(recoveryCandidateValidator, /global\.(?:localStorage|indexedDB)/);
assert.match(recoveryIsolationEngine, /copy-on-write-localStorage-overlay/);
assert.match(recoveryIsolationEngine, /promotable: false/);
assert.doesNotMatch(recoveryIsolationEngine, /global\.(?:localStorage|indexedDB)/);
new vm.Script(recoveryCandidateValidator, { filename: 'recovery-candidate-validator.js' });
new vm.Script(recoveryIsolationEngine, { filename: 'recovery-isolation-engine.js' });
new vm.Script(recoveryApplicationAuditor, { filename: 'recovery-application-auditor.js' });
assert.ok(recoveryApplicationAuditor.includes('twodeers-application-consistency-audit'));
assert.doesNotMatch(recoveryApplicationAuditor, /global\.(?:localStorage|indexedDB)|\b(?:localStorage|indexedDB)\s*\.\s*(?:setItem|removeItem|open|deleteDatabase)/, 'application recovery auditor must not touch live application storage');
for (const id of ['recoveryApplicationAuditFile','recoveryApplicationAuditBtn','recoveryApplicationAuditExportBtn']) assert.match(index, new RegExp('id=\"' + id + '\"[^>]*data-duo-readonly-allowed=\"true\"'), `missing read-only application audit control: ${id}`);
assert.match(index, /id="recoveryIsolationFile"[^>]*data-duo-readonly-allowed="true"/);
assert.match(index, /id="recoveryIsolationValidateBtn"[^>]*data-duo-readonly-allowed="true"/);
assert.match(index, /id="recoveryIsolationBuildBtn"[^>]*data-duo-readonly-allowed="true"/);
assert.match(recoveryIsolationEngine, /独立校验完成|必须先完成候选 ZIP 独立校验/);
assert.match(recoveryIsolationEngine, /copy-on-write-localStorage-overlay/);
assert.doesNotMatch(recoveryWorkbench, /global\.(?:localStorage|indexedDB)/);
assert.match(index, /data-duo-readonly-allowed="true"/);
assert.match(index, /reportStorageDamage\?\.\(STORAGE_KEY,e\)/);
assert.match(storageDiagnostics, /importableAsBackup\s*:\s*false/);
assert.match(storageDiagnostics, /cleanup\s*:\s*false/);
assert.match(storageDiagnostics, /MAX_BLOB_EXPORT_BYTES/);
new vm.Script(storageDiagnostics, { filename: 'storage-diagnostics.js' });
new vm.Script(circleMediaManager, { filename: 'circle-media-manager.js' });
assert.match(appearance, /mode:'system'.*palette:'sage'/);
assert.match(appearance, /\['system','light','dark'\]/);
assert.match(appearance, /data-duo-theme-resolved/);
assert.match(appearance, /DuoThemeBridge/);
assert.match(index, /<meta name="color-scheme" content="light dark"\/>/);
assert.doesNotMatch(index, /@media\s*\(prefers-color-scheme\s*:/, 'manual theme modes must not be overridden by raw OS media-query CSS');
assert.match(activity, /new ThemeBridge\(\), "DuoThemeBridge"/);
assert.match(activity, /setAlgorithmicDarkeningAllowed\(settings, false\)/);
assert.match(activity, /setForceDarkAllowed\(false\)/);
assert.match(activity, /setSystemBarsAppearance\(appearance, mask\)/);
for (const file of [
  'android-apps/app/src/main/res/values/styles.xml',
  'android-apps/app/src/main/res/values-night/styles.xml',
  'android-apps/app/src/main/res/values-v26/styles.xml',
  'android-apps/app/src/main/res/values-night-v26/styles.xml'
]) {
  const xml = read(file);
  assert.match(xml, /name="AppTheme"/);
  assert.match(xml, /Theme\.Material/);
}
assert.match(backup, /init\(\);window\.DuoAppearance\?\.apply\(false\)/);
assert.match(activity, /OnBackInvokedCallback/);
assert.match(activity, /registerOnBackInvokedCallback/);
assert.match(activity, /__duoHandleSystemBack/);
assert.match(activity, /backRequestPending/);
assert.match(backup, /function safePath\(path\)/);
assert.equal((backup.match(/function safePath\(path\)/g) || []).length, 1, 'ZIP path validator must have one authoritative definition');
assert.match(backup, /e\.path==='manifest\.json'/);
assert.match(backup, /diskStart!==0/);
assert.match(backup, /生成后的备份 ZIP 超过 1 GB/);
assert.equal((activity.match(/startActivityForResult\(intent, BACKUP_SAVE_REQUEST\)/g) || []).length, 1, 'SAF save picker should launch exactly once');
assert.match(read('settings-pages.js'), /window\.__duoHandleSystemBack=function/);

// Phase 2 chat composer regression: the independent send control, persisted Enter
// setting and true in-memory batch queue must be connected to the real message
// append/save path, rather than merely leaving visual controls in the markup.
assert.match(index, /<button id="sendBtn" type="button"[^>]*>发送<\/button>/);
assert.match(index, /<button class="side-btn" id="batchBtn"/);
assert.match(index, /<div class="batch-panel" id="batchPanel"/);
assert.match(index, /<input id="batchImageInput" type="file" accept="image\/\*" multiple hidden>/);
assert.match(index, /enterKeySendEnabled:false/);
assert.match(index, /state\.enterKeySendEnabled=saved\.enterKeySendEnabled===true/);
assert.match(index, /function handleChatInputKeydown\(event\)/);
assert.match(index, /if\(state\.enterKeySendEnabled===true\)\{event\.preventDefault\(\);if\(isBatchMode\)addToBatch\(\);else sendCurrentText\(\);/);
assert.match(index, /event\.isComposing\|\|event\.keyCode===229/);
assert.match(index, /window\.__duoVoiceCapture=\{isActive:/);
assert.match(index, /voiceFinishing/);
assert.match(index, /cancelVoiceCaptureOnPageHide/);
assert.match(index, /recorder\.addEventListener\('error'/);
assert.match(index, /请先结束或取消正在进行的语音录制/);
assert.match(backup, /__duoVoiceCapture\?\.assertIdle/);
assert.match(isolatedApplicationRehearsal, /chatVideoUploader/);
assert.match(isolatedApplicationRehearsal, /MediaRecorder|voiceCancelBtn/);
assert.match(isolatedApplicationRehearsal, /phase23-video\.webm/);
assert.match(index, /function handleChatSendButtonClick\(\)/);
assert.match(index, /function sendBatchMessages\(\)\{[\s\S]*?await putMediaBlob\(item\.file,'image'/);
assert.match(index, /if\(item\.stickerId\)\{[\s\S]*?isStickerSendable\(item\.stickerId\)/);
assert.match(index, /if\(queueForBatch\)\{/);
assert.match(index, /appendChatMessage\(\{sender:'me',type:'text',[\s\S]*?\},false,usageEvents\)/);
assert.match(index, /if\(save\(\)===false\)throw new Error\('聊天记录写入失败，批量发送已回滚'\)/);
assert.match(index, /function triggerReply\(metaEl, sentMessageIds=null\)/);
assert.match(index, /syncChatSendInputs\(\)/);
assert.match(read('settings-pages.js'), /const inputSettings=\$\('#paramChatInputSettingsPanel'\)/);
assert.match(read('settings-pages.js'), /\{key:'send',label:'消息发送',nodes:\[inputSettings\]\}/);
assert.match(backup, /enterKeySendEnabled:stateSnapshot\.enterKeySendEnabled===true/);
assert.match(backup, /if\(data\.enterKeySendEnabled!==undefined\)state\.enterKeySendEnabled=data\.enterKeySendEnabled===true/);

// Execute the real appendChatMessage + sendBatchMessages source in a focused
// VM harness. This checks queue commit/rollback semantics and usage-event ties,
// not merely the presence of UI labels.
const appendStart = index.indexOf('function appendChatMessage(msg, shouldSave=true, usageEvents=[])');
const appendEnd = index.indexOf('\nfunction flushChatCardUsageOutbox', appendStart);
const batchStart = index.indexOf('async function sendBatchMessages(){');
const batchEnd = index.indexOf('\nfunction cancelBatchMode', batchStart);
assert.ok(appendStart >= 0 && appendEnd > appendStart && batchStart >= 0 && batchEnd > batchStart);
const sendHarness = `
const window={__duoRestoreInProgress:false,__duoExportInProgress:false};
let isBatchMode=true, batchSending=false;
let batchMessages=[];
let nextId=0, saveResult=true, saveCalls=0, replies=[], renderCalls=0, cleaned=[];
const MAX_PENDING_CARD_USAGE_EVENTS=1000;
const state={chatHistory:[],cardUsageOutbox:[{eventId:'existing-event',textSnapshot:'keep'}],offline:{lastChatAt:123}};
let stickerStore={items:[{id:'stk-1',mediaId:'sticker-media-1',mimeType:'image/png',name:'测试表情'}],tombstones:[]};
const mediaUrlCache=new Map();
const URL={createObjectURL(){return 'blob:test-'+(++nextId)},revokeObjectURL(){}};
function uid(prefix='m'){return prefix+'-'+(++nextId)}
function formatHM(){return '12:34'}
function ensureChatState(){if(!Array.isArray(state.chatHistory))state.chatHistory=[];if(!Array.isArray(state.cardUsageOutbox))state.cardUsageOutbox=[]}
function buildMessageRow(msg){return {dataset:{mid:String(msg.id)},querySelector(){return {messageId:String(msg.id)}}}}
const rows=[];
const chatList={appendChild(row){rows.push(row)},querySelectorAll(){return rows}};
const plainNode={classList:{remove(){}}};
function $(selector){if(selector==='#chatList')return chatList;if(selector==='#morePanel'||selector==='#inputHelper')return plainNode;return null}
function scrollChatToBottom(){}
function save(){saveCalls++;return saveResult}
function showToast(){}
function renderChatHistory(){renderCalls++}
function renderBatchPreview(){}
function updateBatchControls(){}
function flushChatCardUsageOutbox(){return true}
function triggerReply(meta,ids){replies.push({meta,ids})}
function releaseBatchPreview(item){if(item?.previewUrl)item.previewUrl=''}
async function putMediaBlob(file){return file.mediaId}
async function getMediaRecord(id){return id==='sticker-media-1'?{blob:{type:'image/png',size:64}}:null}
function readStickerLibraryStore(){return stickerStore}
function isStickerSendable(id){return !!stickerStore.items.find(item=>item.id===id)&&!stickerStore.tombstones.some(item=>item.id===id)}
async function deleteIfUnreferenced(id){cleaned.push(id)}
${index.slice(appendStart, appendEnd)}
${index.slice(batchStart, batchEnd)}
globalThis.runBatchSend=sendBatchMessages;
globalThis.setBatch=(items)=>{batchMessages=items.slice();isBatchMode=true};
globalThis.markStickerDeleted=()=>{stickerStore={items:[],tombstones:[{id:'stk-1'}]}};
globalThis.snapshot=()=>({state,saveCalls,renderCalls,replies,cleaned,batchSending,batchMessages:batchMessages.length,isBatchMode,rows});
`;
const sendSandbox = {};
vm.runInNewContext(sendHarness, sendSandbox, { filename: 'phase2-batch-harness.js' });
sendSandbox.setBatch([
  { id: 'q1', text: '第一条批量文字', usageEvents: [{ eventId: 'batch-use-1', textSnapshot: '第一条批量文字', source: 'chat' }] },
  { id: 'q2', text: '第二条批量文字', usageEvents: [] },
]);
await sendSandbox.runBatchSend();
let sendSnapshot = sendSandbox.snapshot();
assert.deepEqual(Array.from(sendSnapshot.state.chatHistory, item => item.text), ['第一条批量文字','第二条批量文字']);
assert.equal(sendSnapshot.saveCalls, 1, 'batch messages should be committed with one state save');
assert.equal(sendSnapshot.state.cardUsageOutbox.find(item => item.eventId === 'batch-use-1').messageId, sendSnapshot.state.chatHistory[0].id);
assert.equal(sendSnapshot.state.offline.lastChatAt > 123, true);
assert.deepEqual(Array.from(sendSnapshot.replies[0].ids), Array.from(sendSnapshot.state.chatHistory, item => item.id), 'one reply/read-receipt cycle must cover the entire batch');
assert.equal(sendSnapshot.batchMessages, 0);

const rollbackSandbox = {};
vm.runInNewContext(sendHarness.replace('saveResult=true','saveResult=false'), rollbackSandbox, { filename: 'phase2-batch-rollback-harness.js' });
rollbackSandbox.setBatch([
  { id: 'q3', text: '不可提交的队列消息', usageEvents: [{ eventId: 'batch-use-rollback', textSnapshot: '不可提交的队列消息' }] },
]);
await rollbackSandbox.runBatchSend();
const rollbackSnapshot = rollbackSandbox.snapshot();
assert.equal(rollbackSnapshot.state.chatHistory.length, 0, 'failed batch state write must roll back queued messages');
assert.equal(rollbackSnapshot.state.cardUsageOutbox.length, 1);
assert.equal(rollbackSnapshot.state.cardUsageOutbox[0].eventId, 'existing-event', 'rollback must preserve pre-existing usage events');
assert.equal(rollbackSnapshot.state.offline.lastChatAt, 123, 'rollback must restore the previous last-chat timestamp');
assert.equal(rollbackSnapshot.batchMessages, 1, 'failed queue should remain available for retry');

const imageSandbox = {};
vm.runInNewContext(sendHarness.replace('saveResult=true','saveResult=true'), imageSandbox, { filename: 'phase2-batch-image-harness.js' });
imageSandbox.setBatch([{ id: 'q-image', file: { name: 'test.png', type: 'image/png', size: 64, mediaId: 'media-image-1' }, previewUrl: 'blob:preview' }]);
await imageSandbox.runBatchSend();
const imageSnapshot = imageSandbox.snapshot();
assert.equal(imageSnapshot.state.chatHistory[0].type, 'image', 'queued images must enter the normal chat media message path');
assert.equal(imageSnapshot.state.chatHistory[0].mediaId, 'media-image-1');
assert.equal(imageSnapshot.saveCalls, 1);

const stickerSandbox={};
vm.runInNewContext(sendHarness,stickerSandbox,{filename:'phase2-batch-sticker-harness.js'});
stickerSandbox.setBatch([{id:'q-sticker',stickerId:'stk-1',mediaId:'sticker-media-1',mimeType:'image/png',name:'测试表情',previewUrl:'blob:sticker-preview'}]);
await stickerSandbox.runBatchSend();
const stickerSnapshot=stickerSandbox.snapshot();
assert.equal(stickerSnapshot.state.chatHistory[0].type,'sticker','queued stickers must enter the normal sticker message path');
assert.equal(stickerSnapshot.state.chatHistory[0].mediaId,'sticker-media-1');
assert.equal(stickerSnapshot.saveCalls,1);

const deletedStickerSandbox={};
vm.runInNewContext(sendHarness,deletedStickerSandbox,{filename:'phase2-batch-deleted-sticker-harness.js'});
deletedStickerSandbox.setBatch([{id:'q-sticker-deleted',stickerId:'stk-1',mediaId:'sticker-media-1',mimeType:'image/png',name:'已删除表情'}]);
deletedStickerSandbox.markStickerDeleted();
await deletedStickerSandbox.runBatchSend();
const deletedStickerSnapshot=deletedStickerSandbox.snapshot();
assert.equal(deletedStickerSnapshot.state.chatHistory.length,0,'a deleted sticker must not be sent from an old queue entry');
assert.equal(deletedStickerSnapshot.saveCalls,0,'stale sticker queue must fail before persistence');
assert.equal(deletedStickerSnapshot.batchMessages,1,'stale sticker entry remains visible for manual removal');

const keyHandlerStart=index.indexOf('function handleChatInputKeydown(event){');
const keyHandlerEnd=index.indexOf('\nfunction handleChatSendButtonClick()',keyHandlerStart);
const sendClickStart=keyHandlerEnd+1;
const sendClickEnd=index.indexOf('\n\nlet wakeLock=null',sendClickStart);
assert.ok(keyHandlerStart>=0&&keyHandlerEnd>keyHandlerStart&&sendClickEnd>sendClickStart);
const keyHarness=`
const state={enterKeySendEnabled:false};let isBatchMode=false,batchSending=false;let calls=[];
function addToBatch(){calls.push('queue')};function sendCurrentText(){calls.push('send')};function resizeChatInput(){calls.push('resize')};
${index.slice(keyHandlerStart,keyHandlerEnd)}
${index.slice(sendClickStart,sendClickEnd)}
globalThis.setMode=(enabled,batch=false,sending=false)=>{state.enterKeySendEnabled=enabled;isBatchMode=batch;batchSending=sending;calls=[]};
globalThis.fireKey=e=>{let prevented=false;handleChatInputKeydown({...e,preventDefault(){prevented=true}});return JSON.stringify({prevented,calls:[...calls]})};
globalThis.fireSend=()=>{handleChatSendButtonClick();return JSON.stringify(calls)};
`;
const keySandbox={};vm.runInNewContext(keyHarness,keySandbox,{filename:'phase2-enter-handler-harness.js'});
keySandbox.setMode(false,false,false);
assert.deepEqual(JSON.parse(keySandbox.fireKey({key:'Enter'})),{prevented:false,calls:[]},'Enter defaults to newline while the setting is off');
keySandbox.setMode(true,false,false);
assert.deepEqual(JSON.parse(keySandbox.fireKey({key:'Enter',shiftKey:true})),{prevented:false,calls:[]},'Shift+Enter must remain a newline');
assert.deepEqual(JSON.parse(keySandbox.fireKey({key:'Enter',isComposing:true})),{prevented:false,calls:[]},'IME composition Enter must not send');
assert.deepEqual(JSON.parse(keySandbox.fireKey({key:'Enter'})),{prevented:true,calls:['send','resize']},'enabled Enter sends through the normal send path');
keySandbox.setMode(true,true,false);
assert.deepEqual(JSON.parse(keySandbox.fireKey({key:'Enter'})),{prevented:true,calls:['queue','resize']},'enabled Enter in batch mode adds to the queue');
keySandbox.setMode(false,false,false);
assert.deepEqual(JSON.parse(keySandbox.fireSend()),['send','resize'],'the independent send button works while Enter sending is off');
keySandbox.setMode(true,true,false);
assert.deepEqual(JSON.parse(keySandbox.fireSend()),['queue','resize'],'the independent send button adds to the batch queue in batch mode');
keySandbox.setMode(true,true,true);
assert.deepEqual(JSON.parse(keySandbox.fireSend()),[],'the send button is locked during a batch commit');

// Execute the real normal-send and queue-add functions behind the real button
// handler, so the test covers message payload creation, clearing and queueing.
const sendTextStart=index.indexOf('function sendCurrentText(forceText){');
const sendTextEnd=index.indexOf('\nlet isBatchMode=false;',sendTextStart);
const addBatchStart=index.indexOf('function addToBatch(){',sendTextEnd);
const addBatchEnd=index.indexOf('\nfunction addBatchImages',addBatchStart);
assert.ok(sendTextStart>=0&&sendTextEnd>sendTextStart&&addBatchStart>sendTextEnd&&addBatchEnd>addBatchStart);
const actionHarness=`
const window={__duoRestoreInProgress:false,__duoExportInProgress:false};
const state={enterKeySendEnabled:false,offline:{lastChatAt:10}};
let isBatchMode=false,batchSending=false,batchMessages=[],sent=[],usageReads=[],toasts=[];
const MAX_BATCH_ITEMS=100;
const input={value:'普通消息',dataset:{pendingCardFragments:'[]',pendingCardSnapshot:'普通消息'}};
const list={querySelectorAll(){return []}};
const helper={classList:{remove(){}}};
const panel={classList:{remove(){}}};
function $(selector){if(selector==='#chatInput')return input;if(selector==='#inputHelper')return helper;if(selector==='#morePanel')return panel;if(selector==='#chatList')return list;return null}
function uid(prefix='m'){return prefix+'-test-'+(sent.length+batchMessages.length+1)}
function formatHM(){return '12:34'}
function getPendingCardUsageEvents(node,text,allowSearch){usageReads.push({text,allowSearch});return text.includes('字卡')?[{eventId:'card-use-'+(usageReads.length),textSnapshot:'字卡内容',source:'chat'}]:[]}
function appendChatMessage(message,shouldSave=true,events=[]){const saved={...message,id:'message-'+(sent.length+1),events};sent.push(saved);return saved}
function triggerReply(meta){sent[sent.length-1].replyTriggered=true}
function showToast(message){toasts.push(message)}
function resizeChatInput(){}
function renderBatchPreview(){}
${index.slice(sendTextStart,sendTextEnd)}
${index.slice(addBatchStart,addBatchEnd)}
${index.slice(keyHandlerStart,keyHandlerEnd)}
${index.slice(sendClickStart,sendClickEnd)}
globalThis.input=input;
globalThis.state=state;
globalThis.sent=sent;
globalThis.getQueue=()=>batchMessages;
globalThis.setMode=(enabled,batch)=>{state.enterKeySendEnabled=enabled;isBatchMode=batch;input.value='普通消息';input.dataset.pendingCardFragments='[]';input.dataset.pendingCardSnapshot=input.value;sent.length=0;batchMessages=[];usageReads.length=0};
globalThis.pressSend=()=>handleChatSendButtonClick();
globalThis.pressEnter=()=>{let prevented=false;handleChatInputKeydown({key:'Enter',preventDefault(){prevented=true}});return prevented};
`;
const actionSandbox={};vm.runInNewContext(actionHarness,actionSandbox,{filename:'phase2-actual-send-and-queue-harness.js'});
actionSandbox.setMode(false,false);
actionSandbox.pressSend();
assert.equal(actionSandbox.sent.length,1,'the independent send button must create an actual message through sendCurrentText');
assert.equal(actionSandbox.sent[0].text,'普通消息');
assert.equal(actionSandbox.input.value,'','successful normal send clears the input');
assert.equal(actionSandbox.sent[0].replyTriggered,true,'successful normal send enters the existing reply path');
assert.deepEqual(JSON.parse(JSON.stringify(actionSandbox.sent[0].events)),[]);
actionSandbox.setMode(true,true);
assert.equal(actionSandbox.pressEnter(),true,'enabled Enter prevents newline in batch mode');
assert.equal(actionSandbox.getQueue().length,1,'enabled Enter adds an actual text item to the queue');
assert.equal(actionSandbox.getQueue()[0].text,'普通消息');
assert.equal(actionSandbox.input.value,'','queueing clears the input draft');
assert.deepEqual(JSON.parse(JSON.stringify(actionSandbox.getQueue()[0].usageEvents)),[]);

// User-facing settings regression: remove obsolete empty rows and expose the
// two read-receipt modes as the first dedicated Chat Settings subpage.
assert.doesNotMatch(index, /戳一戳|输入辅助栏/);
assert.match(index, /<div class="panel-card" id="paramReadReceiptPanel">\s*<h3>已读设置<\/h3>/);
assert.match(index, /id="readReceiptSeg"[\s\S]*?data-read-style="text"[\s\S]*?data-read-style="checks"/);
assert.match(index, /state\.readReceiptStyle = btn\.dataset\.readStyle==='checks' \? 'checks' : 'text'/);
const settingsPages = read('settings-pages.js');
assert.match(settingsPages, /const readReceipt=\$\('#paramReadReceiptPanel'\)/);
assert.ok(settingsPages.indexOf("{key:'read-receipt',label:'已读设置',nodes:[readReceipt]}") < settingsPages.indexOf("{key:'reply',label:'回复设置',nodes:[reply]}"));
assert.doesNotMatch(index, /setInterval\(render,\s*700\)/);
assert.doesNotMatch(index, /setInterval\(\(\)=>\{if\(!window\.__duoCircleRestorePaused\)syncNotificationsFromPosts\(\);\},\s*1200\)/);
assert.match(index, /duo:notifications-changed/);
assert.match(index, /function validateBackupPayloadShape/);
assert.match(index, /function safeMediaUrl/);
assert.match(index, /escapeHtml\(time\)/);
assert.match(index, /Array\.from\(list\.querySelectorAll\('\[data-mid\]'\)\)\.find/);

// Exercise the actual URL/escaping helpers and chat message renderer.
const helpersStart = index.indexOf('function fallbackChar(');
const helpersEnd = index.indexOf('function getViewAssets()', helpersStart);
assert.ok(helpersStart >= 0 && helpersEnd > helpersStart);
const helperSandbox = {
  document: { baseURI: 'https://app.test/index.html' },
  location: { origin: 'https://app.test' },
  URL,
  state: { readReceiptStyle: 'text', media: {} },
  mediaUrlCache: new Map(),
  mediaLoadFailed: new Set(),
  uid: () => 'test-id',
};
vm.runInNewContext(index.slice(helpersStart, helpersEnd), helperSandbox);
assert.equal(helperSandbox.safeMediaUrl('javascript:alert(1)'), '');
assert.equal(helperSandbox.safeMediaUrl('data:text/html;base64,PHNjcmlwdD4='), '');
assert.equal(helperSandbox.safeMediaUrl('https://good.example/a.png'), 'https://good.example/a.png');
assert.equal(helperSandbox.safeMediaUrl('https://good.example/" onerror="alert(1)'), '');
assert.equal(helperSandbox.escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');

const metaStart = index.indexOf('function metaHtml(time, read=false)');
const metaEnd = index.indexOf('function uid(', metaStart);
assert.ok(metaStart >= 0 && metaEnd > metaStart);
vm.runInNewContext(index.slice(metaStart, metaEnd), helperSandbox);
const escapedMeta = helperSandbox.metaHtml('" onmouseover="alert(1)', false);
assert.ok(!escapedMeta.includes('" onmouseover="'));
assert.ok(escapedMeta.includes('&quot; onmouseover=&quot;'));

const messageStart = index.indexOf('function buildMessageRow(msg){');
const messageEnd = index.indexOf('function renderChatHistory(', messageStart);
assert.ok(messageStart >= 0 && messageEnd > messageStart);
helperSandbox.document.createElement = () => ({ dataset: {}, appendChild() {}, set innerHTML(value) { this.html = value; } });
vm.runInNewContext(index.slice(messageStart, messageEnd), helperSandbox);
const maliciousText = '<svg onload=alert(1)>';
const row = helperSandbox.buildMessageRow({ id: 'm1', sender: 'me', type: 'text', text: maliciousText, time: maliciousText });
assert.ok(row.html.includes('&lt;svg onload=alert(1)&gt;'));
assert.ok(!row.html.includes('<svg onload=alert(1)>'));
const badMediaRow = helperSandbox.buildMessageRow({ id: 'm2', sender: 'me', type: 'image', url: '"><img src=x onerror=alert(1)>' });
assert.ok(!badMediaRow.html.includes('onerror=alert(1)'));

const validatorStart = index.indexOf('function validateBackupPayloadShape(payload){');
const validatorEnd = index.indexOf('async function applyBackupPayloadInternal(payload){', validatorStart);
assert.ok(validatorStart >= 0 && validatorEnd > validatorStart);
const legacySandbox = { window: {}, URL };
vm.runInNewContext(index.slice(validatorStart, validatorEnd), legacySandbox);
const validateLegacy = legacySandbox.validateBackupPayloadShape;
assert.equal(validateLegacy({ kind: 'chat', data: { chatHistory: [{ id: 'm1', text: 'hello' }], stickers: [], stickerFavorites: [] } }), undefined);
assert.equal(validateLegacy({ kind: 'chat', data: { chatHistory: [{ id: 'm2', time: '<b>plain text</b>' }], stickers: [], stickerFavorites: [] } }), undefined, 'HTML-looking plain text is allowed only because renderers escape it');
assert.throws(() => validateLegacy({ kind: 'chat', data: { chatHistory: [], stickers: [{ id: 's1', src: 'javascript:alert(1)' }] } }), /允许的媒体或网页地址/);
assert.throws(() => validateLegacy({ kind: 'chat', data: { chatHistory: [{ id: 'm3', url: '\"><img src=x onerror=alert(1)>' }] } }), /允许的媒体或网页地址/);
assert.throws(() => validateLegacy({ kind: 'chat', data: { chatHistory: 'not-an-array' } }), /必须是数组/);
assert.throws(() => validateLegacy({ kind: 'chat', data: JSON.parse('{"chatHistory":[],"__proto__":{"polluted":true}}') }), /禁止字段/);

// Exercise the V4 import validation helpers, including media URL context and read cap.
const v4HelpersStart = backup.indexOf('  function safePath(path){');
const v4HelpersEnd = backup.indexOf('  async function unzipStored(blob){', v4HelpersStart);
assert.ok(v4HelpersStart >= 0 && v4HelpersEnd > v4HelpersStart);
const v4HelpersSandbox = { window: {}, Blob, URL, TextEncoder, decodeURIComponent, Map, Set, Number, Object, Array, Error };
vm.runInNewContext('const MAX_JSON_MEMBER=128*1024*1024, MAX_MANIFEST=16*1024*1024; const enc=new TextEncoder();\n' + backup.slice(v4HelpersStart, v4HelpersEnd), v4HelpersSandbox);
await v4HelpersSandbox.validateV4Payloads('chat', new Map(), { chatHistory: [{ id: 'm2', text: 'normal' }], stickers: [], stickerFavorites: [] });
await v4HelpersSandbox.validateV4Payloads('chat', new Map(), { chatHistory: [{ id: 'm3', time: '<b>plain text</b>' }], stickers: [], stickerFavorites: [] });
await assert.rejects(() => v4HelpersSandbox.validateV4Payloads('chat', new Map(), { chatHistory: [], stickers: [{ id: 's2', src: 'javascript:alert(1)' }] }), /允许的媒体或网页地址/);
await assert.rejects(() => v4HelpersSandbox.validateV4Payloads('chat', new Map(), { chatHistory: [{ id: 'm4', url: '\"><img src=x onerror=alert(1)>' }], stickers: [] }), /允许的媒体或网页地址/);
await assert.rejects(() => v4HelpersSandbox.validateV4Payloads('chat', new Map(), JSON.parse('{"chatHistory":[],"__proto__":{"polluted":true}}')), /禁止字段/);
await assert.rejects(() => v4HelpersSandbox.readJsonMember(new Map([['large.json', { size: 128*1024*1024+1, blob: new Blob(['{}']) }]]), 'large.json'), /128 MB/);

// Run the real V4 ZIP parser against a valid synthetic archive and malformed manifests.
const parserSandbox = {
  window: {},
  document: { addEventListener() {}, getElementById() { return null; } },
  Blob, TextEncoder, TextDecoder, Uint8Array, Uint32Array, DataView, ArrayBuffer,
  URL, Map, Set, Object, Number, Array, Date, Error, Math, Promise, console,
  decodeURIComponent,
};
vm.runInNewContext(backup, parserSandbox, { filename: 'backup-v4.js' });
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); crcTable[n] = c >>> 0; }
function crc32(buffer) { let c = 0xffffffff; for (const b of buffer) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return ((c ^ 0xffffffff) >>> 0); }
function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; }
function buildStoredZip(files) {
  const locals = [], centrals = []; let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8'), data = Buffer.from(file.data), crc = crc32(data);
    const local = Buffer.concat([u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data]);
    locals.push(local);
    const central = Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]);
    centrals.push(central); offset += local.length;
  }
  const centralData = Buffer.concat(centrals);
  const eocd = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(centralData.length), u32(offset), u16(0)]);
  return new Blob([...locals, centralData, eocd], { type: 'application/zip' });
}
function resourceMeta(name, data) {
  const b = Buffer.from(data);
  return { path: name, size: b.length, crc32: crc32(b).toString(16).padStart(8, '0'), sha256: crypto.createHash('sha256').update(b).digest('hex'), type: 'file', mimeType: 'application/json' };
}
const stateBytes = Buffer.from('{"kind":"chat"}');
const goodManifest = { format: 'twodeers-backup', formatVersion: 4, kind: 'chat', resourceCount: 1, totalResourceBytes: stateBytes.length, resources: [resourceMeta('state.json', stateBytes)] };
const goodZip = buildStoredZip([{ name: 'state.json', data: stateBytes }, { name: 'manifest.json', data: JSON.stringify(goodManifest) }]);
const parsedGood = await parserSandbox.window.__duoBackupV4.unzip(goodZip);
assert.equal(parsedGood.manifest.resourceCount, 1);
assert.equal(parsedGood.map.get('state.json').size, stateBytes.length);
const diskStartBytes = new Uint8Array(await goodZip.arrayBuffer());
const diskView = new DataView(diskStartBytes.buffer);
let centralSig = -1;
for (let i = 0; i < diskStartBytes.length - 4; i++) { if (diskView.getUint32(i, true) === 0x02014b50) { centralSig = i; break; } }
assert.ok(centralSig >= 0);
diskView.setUint16(centralSig + 34, 1, true);
await assert.rejects(() => parserSandbox.window.__duoBackupV4.unzip(new Blob([diskStartBytes])), /边界有效/);
const extraManifest = { ...goodManifest, resources: goodManifest.resources };
const extraZip = buildStoredZip([{ name: 'state.json', data: stateBytes }, { name: 'unlisted.json', data: '{}' }, { name: 'manifest.json', data: JSON.stringify(extraManifest) }]);
await assert.rejects(() => parserSandbox.window.__duoBackupV4.unzip(extraZip), /资源数量与 ZIP 内容不一致/);
const duplicateManifest = { ...goodManifest, resourceCount: 2, totalResourceBytes: stateBytes.length * 2, resources: [resourceMeta('state.json', stateBytes), resourceMeta('state.json', stateBytes)] };
const duplicateZip = buildStoredZip([{ name: 'state.json', data: stateBytes }, { name: 'other.json', data: '{}' }, { name: 'manifest.json', data: JSON.stringify(duplicateManifest) }]);
await assert.rejects(() => parserSandbox.window.__duoBackupV4.unzip(duplicateZip), /重复资源路径/);
const mismatchManifest = { ...goodManifest, resources: [resourceMeta('missing.json', stateBytes)] };
const mismatchZip = buildStoredZip([{ name: 'state.json', data: stateBytes }, { name: 'manifest.json', data: JSON.stringify(mismatchManifest) }]);
await assert.rejects(() => parserSandbox.window.__duoBackupV4.unzip(mismatchZip), /缺少资源|资源路径非法/);

// Syntax-check all root JS modules and executable inline JS; parse Android XML.
for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith('.js')) {
    const result = spawnSync(process.execPath, ['--check', path.join(root, entry.name)], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${entry.name}: ${result.stderr}`);
  }
}
let scriptIndex = 0;
for (const match of index.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
  const attrs = match[1], body = match[2];
  if (/\bsrc\s*=/.test(attrs) || !body.trim()) continue;
  const type = attrs.match(/\btype\s*=\s*["']([^"']+)/i)?.[1]?.toLowerCase();
  if (type && !['text/javascript', 'application/javascript', 'module'].includes(type)) continue;
  new vm.Script(body, { filename: `index-inline-${scriptIndex++}.js` });
}
const xmlFiles = ['android-apps/app/src/main/AndroidManifest.xml', 'android-apps/app/src/main/res/xml/backup_rules.xml', 'android-apps/app/src/main/res/xml/data_extraction_rules.xml', 'android-apps/app/src/main/res/values/styles.xml', 'android-apps/app/src/main/res/values-night/styles.xml', 'android-apps/app/src/main/res/values-v26/styles.xml', 'android-apps/app/src/main/res/values-night-v26/styles.xml'];
for (const file of xmlFiles) {
  const result = spawnSync('python3', ['-c', 'import sys,xml.etree.ElementTree as E; E.parse(sys.argv[1])', path.join(root, file)], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${file}: ${result.stderr}`);
}


// Mailbox alignment regression: mirror KKK's received/sent view and card-only
// scheduled letters; drafts and canned fallback text must not exist.
const mailboxSource = read('mailbox-manager.js');
const legacyDrafts = 'twodeers_mailbox_drafts_v1';
assert.match(mailboxSource, /const KEY='twodeers_mailbox_letters_v1',LEGACY_DRAFT_KEY=/);
assert.doesNotMatch(mailboxSource, /localStorage\.removeItem\(LEGACY_DRAFT_KEY\)/, 'legacy drafts must not be deleted outside the recoverable transaction');
assert.match(mailboxSource, /delete x\.drafts;delete x\.draft;/);
assert.match(mailboxSource, /function isLegacyPresetLetter\(item\)/);
assert.match(mailboxSource, /function initialize\(\)[\s\S]*access\?\.ready&&access\?\.writable/);
assert.match(mailboxSource, /function exportData\(\)\{return \{mailbox:clone\(box\)\};\}/);
assert.match(mailboxSource, /function contentForCards\(cards\)[\s\S]*?if\(!cards\.length\)return ''/);
assert.doesNotMatch(mailboxSource, /const fallback=|contentForCards\([^)]*,\s*fallback\)|function saveDraft|persistDrafts|insertCard/);
assert.match(mailboxSource, /const imageUrls=new Map\(\),pendingComposeMediaIds=new Set\(\),MAX_IMAGES=6,MAX_COMPOSE_IMAGES=4/);
assert.match(mailboxSource, /function getReferencedMediaIds\(\)[\s\S]*?pendingComposeMediaIds/);
assert.match(mailboxSource, /if\(!box\.settings\.autoReply\)box\.pending=\[\]/);
assert.match(mailboxSource, /if\(!Number\.isInteger\(incomingMinHours\)\|\|!Number\.isInteger\(incomingMaxHours\)/);
assert.match(mailboxSource, /saveSettings\('信箱设置已恢复默认'\);\s*\}/);
assert.match(mailboxSource, /aria-selected',active\?'true':'false'/);
for (const label of ['允许主动来信','主动来信间隔','自动回信','自动回信等待','每封信最少使用','每封信最多使用']) assert.ok(mailboxSource.includes(label), `missing mailbox setting: ${label}`);
assert.doesNotMatch(index, /mailDraftOpenBtn|mailDraftList|mailDraftBtn|mailInsertCardBtn|mail-draft-row|草稿箱|继续草稿|插入聊天字卡/);
assert.match(index, /data-mail-tab="in"[\s\S]*?收到的信[\s\S]*?data-mail-tab="out"[\s\S]*?寄出的信/);
assert.match(index, /<textarea id="mailComposeContent" placeholder="今天想跟你说……"><\/textarea>/);
assert.doesNotMatch(index, /id="mailComposeContent"[^>]*>[^<\s]/);
assert.match(index, /<div class="mail-settings-title">信箱设置<\/div>/);
assert.doesNotMatch(index, /id="mailSettingsClose"|mailSettingsModal[\s\S]{0,300}小字说明/);
assert.match(index, /#mailSettingsModal\{position:fixed!important;inset:0!important;z-index:2147483435!important/);
assert.doesNotMatch(backup, /信件 \/ 草稿引用/);

const mailboxStore = new Map([[legacyDrafts, JSON.stringify([{ id: 'legacy', content: 'should be discarded' }])], ['twodeers_mailbox_letters_v1', JSON.stringify({ items: [{ id: 'fallback-in', type: 'incoming', title: '一封新来信', content: '今天想给你写一封信。', cardFragments: [], images: [] }, { id: 'fallback-reply', type: 'incoming', title: '回信：测试', content: '我收到你的信啦，等我慢慢回你。', replyToId: 'sent-x', cardFragments: [], images: [] }, { id: 'real-mail', type: 'incoming', title: '真实来信', content: '正常内容', cardFragments: [], images: [] }], pending: [], settings: { autoIncoming: false, autoReply: true, minIncomingMin: 720, maxIncomingMin: 2160, minReplyMin: 2, maxReplyMin: 15, cardCountMin: 2, cardCountMax: 4 } })]]);
const mailboxDocument = {
  querySelector() { return null; }, querySelectorAll() { return []; }, addEventListener() {},
  createElement() { return { textContent: '', setAttribute() {}, classList: { add() {}, remove() {} } }; },
  head: { appendChild() {} }, hidden: false,
};
const mailboxWindow = {
  addEventListener() {},
  __duoRuntimeCoordinator: { getStatus() { return { ready: true, writable: true }; }, isWritable() { return true; }, assertWritable() { return true; }, markDataChanged() { return true; } },
  __duoCardSystem: { recordUsageEvent() { return true; }, getCardIdAt() { return 'card-test'; }, getCardId() { return 'card-test'; } },
};
const mailboxLocalStorage = {
  getItem(key) { return mailboxStore.has(key) ? mailboxStore.get(key) : null; },
  setItem(key, value) { mailboxStore.set(key, String(value)); },
  removeItem(key) { mailboxStore.delete(key); },
};
Object.assign(mailboxWindow, { document: mailboxDocument, localStorage: mailboxLocalStorage });
const mailboxSandbox = {
  window: mailboxWindow, document: mailboxDocument, localStorage: mailboxLocalStorage,
  state: { cardPhrases: [] }, showToast() {}, setInterval() { return 1; }, clearTimeout() {}, setTimeout() { return 1; },
  URL, Blob, console, Math, Date, Set, Map, Promise, Number, String, Object, Array, JSON, RegExp, Error,
};
vm.runInNewContext(mailboxSource, mailboxSandbox, { filename: 'mailbox-manager.js' });
assert.equal(mailboxStore.has(legacyDrafts), true, 'legacy draft storage must survive module evaluation until an explicitly journaled migration exists');
mailboxWindow.__duoMailbox.initialize();
assert.equal(mailboxStore.has(legacyDrafts), true, 'mailbox initialization must not delete legacy drafts');
let mailboxData = mailboxWindow.__duoMailbox.exportData();
assert.deepEqual(Array.from(mailboxData.mailbox.items, item => item.id), ['real-mail'], 'only exact legacy canned fallback letters are migrated out');
assert.equal(Object.hasOwn(mailboxData, 'drafts'), false);
assert.equal(Object.hasOwn(mailboxData.mailbox, 'drafts'), false);
mailboxWindow.__duoMailbox.importData({ mailbox: { items: [], drafts: [{ id: 'legacy', content: 'old draft' }], settings: mailboxData.mailbox.settings } });
mailboxData = mailboxWindow.__duoMailbox.exportData();
assert.equal(Object.hasOwn(mailboxData.mailbox, 'drafts'), false, 'legacy imported drafts must be discarded');
const now = Date.now();
mailboxWindow.__duoMailbox.importData({ mailbox: {
  items: [{ id: 'sent-1', type: 'outgoing', title: 'test', content: 'hello', createdAt: now, images: [] }],
  pending: [{ id: 'job-1', type: 'reply', sourceId: 'sent-1', due: now - 1 }], nextIncomingAt: now - 1,
  settings: { autoIncoming: true, autoReply: true, minIncomingMin: 720, maxIncomingMin: 2160, minReplyMin: 2, maxReplyMin: 15, cardCountMin: 2, cardCountMax: 4 },
} });
mailboxWindow.__duoMailbox.resumeTasks();
mailboxWindow.__duoMailbox.processDue();
mailboxData = mailboxWindow.__duoMailbox.exportData().mailbox;
assert.equal(mailboxData.items.filter(item => item.type === 'incoming').length, 0, 'empty card pool must not create canned letters');
assert.equal(mailboxData.pending.length, 0, 'due reply is not replaced by a canned fallback');
assert.ok(mailboxData.nextIncomingAt > Date.now(), 'incoming schedule advances even when card pool is empty');
mailboxSandbox.state.cardPhrases = ['第一张聊天字卡内容', '第二张聊天字卡内容'];
mailboxWindow.__duoMailbox.importData({ mailbox: {
  items: [], pending: [], nextIncomingAt: Date.now() - 1,
  settings: { autoIncoming: true, autoReply: true, minIncomingMin: 720, maxIncomingMin: 2160, minReplyMin: 2, maxReplyMin: 15, cardCountMin: 2, cardCountMax: 2 },
} });
mailboxWindow.__duoMailbox.processDue();
mailboxData = mailboxWindow.__duoMailbox.exportData().mailbox;
const generated = mailboxData.items.filter(item => item.type === 'incoming');
assert.equal(generated.length, 1, 'scheduled incoming letter is generated from actual chat cards');
assert.ok(generated[0].content.includes('第一张聊天字卡内容') || generated[0].content.includes('第二张聊天字卡内容'));
assert.equal(generated[0].cardFragments.length, 2);

const phase18Syntax = spawnSync(process.execPath, ['--check', 'tests/isolated-restore-lifecycle-e2e.mjs'], { cwd: root, encoding: 'utf8' });
assert.equal(phase18Syntax.status, 0, `phase18 restore lifecycle E2E syntax failed:\n${phase18Syntax.stdout}\n${phase18Syntax.stderr}`);
const phase18WorkerSyntax = spawnSync(process.execPath, ['--check', 'tests/isolated-restore-crash-worker.mjs'], { cwd: root, encoding: 'utf8' });
assert.equal(phase18WorkerSyntax.status, 0, `phase18 crash worker syntax failed:\n${phase18WorkerSyntax.stdout}\n${phase18WorkerSyntax.stderr}`);
const browserEvidenceRunnerSyntax = spawnSync(process.execPath, ['--check', 'tests/run-browser-with-evidence.mjs'], { cwd: root, encoding: 'utf8' });
assert.equal(browserEvidenceRunnerSyntax.status, 0, `browser evidence runner syntax failed:\n${browserEvidenceRunnerSyntax.stdout}\n${browserEvidenceRunnerSyntax.stderr}`);
const browserEvidenceRunnerTest = spawnSync(process.execPath, ['tests/browser-evidence-runner.test.mjs'], { cwd: root, encoding: 'utf8' });
assert.equal(browserEvidenceRunnerTest.status, 0, `browser evidence runner test failed:\n${browserEvidenceRunnerTest.stdout}\n${browserEvidenceRunnerTest.stderr}`);
console.log(browserEvidenceRunnerTest.stdout.trim());
const browserCiContractTest = spawnSync(process.execPath, ['tests/browser-ci-contract.test.mjs'], { cwd: root, encoding: 'utf8' });
assert.equal(browserCiContractTest.status, 0, `browser CI contract test failed:\n${browserCiContractTest.stdout}\n${browserCiContractTest.stderr}`);
console.log(browserCiContractTest.stdout.trim());
const acceptanceMatrixTestSyntax = spawnSync(process.execPath, ['--check', 'tests/browser-recovery-acceptance-matrix.test.mjs'], { cwd: root, encoding: 'utf8' });
assert.equal(acceptanceMatrixTestSyntax.status, 0, `browser recovery acceptance matrix test syntax failed:\n${acceptanceMatrixTestSyntax.stdout}\n${acceptanceMatrixTestSyntax.stderr}`);
const acceptanceMatrixTest = spawnSync(process.execPath, ['tests/browser-recovery-acceptance-matrix.test.mjs'], { cwd: root, encoding: 'utf8' });
assert.equal(acceptanceMatrixTest.status, 0, `browser recovery acceptance matrix test failed:\n${acceptanceMatrixTest.stdout}\n${acceptanceMatrixTest.stderr}`);
console.log(acceptanceMatrixTest.stdout.trim());
const phase17FixtureTest = spawnSync(process.execPath, ['tests/isolated-application-fixtures.test.mjs'], { cwd: root, encoding: 'utf8' });
assert.equal(phase17FixtureTest.status, 0, `isolated application fixture test failed:\n${phase17FixtureTest.stdout}\n${phase17FixtureTest.stderr}`);
console.log(phase17FixtureTest.stdout.trim());
const runtimeConsistency = spawnSync(process.execPath, ['tests/runtime-consistency.test.mjs'], { cwd: root, encoding: 'utf8' });
assert.equal(runtimeConsistency.status, 0, `runtime consistency regressions failed:\n${runtimeConsistency.stdout}\n${runtimeConsistency.stderr}`);
console.log(runtimeConsistency.stdout.trim());
const mediaLifecycle = spawnSync(process.execPath, ['tests/media-lifecycle.test.mjs'], { cwd: root, encoding: 'utf8' });
assert.equal(mediaLifecycle.status, 0, `media lifecycle regressions failed:\n${mediaLifecycle.stdout}\n${mediaLifecycle.stderr}`);
console.log(mediaLifecycle.stdout.trim());
const mediaSendPaths = spawnSync(process.execPath, ['tests/media-send-paths.test.mjs'], { cwd: root, encoding: 'utf8' });
assert.equal(mediaSendPaths.status, 0, `media send path regressions failed:\n${mediaSendPaths.stdout}\n${mediaSendPaths.stderr}`);
console.log(mediaSendPaths.stdout.trim());
const videoMediaPaths = spawnSync(process.execPath, ['tests/video-media-paths.test.mjs'], { cwd: root, encoding: 'utf8' });
assert.equal(videoMediaPaths.status, 0, `video media path regressions failed:\n${videoMediaPaths.stdout}\n${videoMediaPaths.stderr}`);
console.log(videoMediaPaths.stdout.trim());
const voiceMediaPaths = spawnSync(process.execPath, ['tests/voice-media-paths.test.mjs'], { cwd: root, encoding: 'utf8' });
assert.equal(voiceMediaPaths.status, 0, `voice media path regressions failed:\n${voiceMediaPaths.stdout}\n${voiceMediaPaths.stderr}`);
console.log(voiceMediaPaths.stdout.trim());
const mailboxCircleWritePaths = spawnSync(process.execPath, ['tests/mailbox-circle-write-paths.test.mjs'], { cwd: root, encoding: 'utf8' });
assert.equal(mailboxCircleWritePaths.status, 0, `mailbox/Circle write path regressions failed:\n${mailboxCircleWritePaths.stdout}\n${mailboxCircleWritePaths.stderr}`);
console.log(mailboxCircleWritePaths.stdout.trim());
const phase25Lifecycle = spawnSync(process.execPath, ['tests/phase25-circle-mailbox-lifecycle.test.mjs'], { cwd: root, encoding: 'utf8' });
assert.equal(phase25Lifecycle.status, 0, `Phase 25 Circle/mailbox lifecycle regressions failed:\n${phase25Lifecycle.stdout}\n${phase25Lifecycle.stderr}`);
console.log(phase25Lifecycle.stdout.trim());
const circleMediaMigration = spawnSync(process.execPath, ['tests/circle-media-migration.test.mjs'], { cwd: root, encoding: 'utf8' });
assert.equal(circleMediaMigration.status, 0, `Circle media migration regressions failed:\n${circleMediaMigration.stdout}\n${circleMediaMigration.stderr}`);
console.log(circleMediaMigration.stdout.trim());
const storageQuotaBackground = spawnSync(process.execPath, ['tests/storage-quota-background.test.mjs'], { cwd: root, encoding: 'utf8' });
assert.equal(storageQuotaBackground.status, 0, `storage quota/background regressions failed:\n${storageQuotaBackground.stdout}\n${storageQuotaBackground.stderr}`);
console.log(storageQuotaBackground.stdout.trim());
const phase27CrossModule = spawnSync(process.execPath, ['tests/phase27-cross-module-faults.test.mjs'], { cwd: root, encoding: 'utf8' });
assert.equal(phase27CrossModule.status, 0, `Phase 27 cross-module fault injection failed:\n${phase27CrossModule.stdout}\n${phase27CrossModule.stderr}`);
console.log(phase27CrossModule.stdout.trim());
const phase29HarnessContract = spawnSync(process.execPath, ['tests/chromium-v4-restore-crash-matrix.test.mjs'], { cwd: root, encoding: 'utf8' });
assert.equal(phase29HarnessContract.status, 0, `Phase 29 Chromium crash harness contract failed:\n${phase29HarnessContract.stdout}\n${phase29HarnessContract.stderr}`);
console.log(phase29HarnessContract.stdout.trim());
const phase33EvidencePersistence = spawnSync(process.execPath, ['tests/phase33-ci-evidence-persistence.test.mjs'], { cwd: root, encoding: 'utf8' });
assert.equal(phase33EvidencePersistence.status, 0, `Phase 33 CI evidence persistence regressions failed:\n${phase33EvidencePersistence.stdout}\n${phase33EvidencePersistence.stderr}`);
console.log(phase33EvidencePersistence.stdout.trim());
const phase34ProcessGroupCleanup = spawnSync(process.execPath, ['tests/phase34-chromium-process-group-cleanup.test.mjs'], { cwd: root, encoding: 'utf8' });
assert.equal(phase34ProcessGroupCleanup.status, 0, `Phase 34 Chromium process-group cleanup regressions failed:\n${phase34ProcessGroupCleanup.stdout}\n${phase34ProcessGroupCleanup.stderr}`);
console.log(phase34ProcessGroupCleanup.stdout.trim());
const phase35BusinessWriteIntegrity = spawnSync(process.execPath, ['tests/phase35-business-write-integrity.test.mjs'], { cwd: root, encoding: 'utf8' });
assert.equal(phase35BusinessWriteIntegrity.status, 0, `Phase 35 business write-integrity regressions failed:\n${phase35BusinessWriteIntegrity.stdout}\n${phase35BusinessWriteIntegrity.stderr}`);
console.log(phase35BusinessWriteIntegrity.stdout.trim());
const phase36ProfileMediaCallBeautify = spawnSync(process.execPath, ['tests/phase36-profile-media-call-beautify.test.mjs'], { cwd: root, encoding: 'utf8' });
assert.equal(phase36ProfileMediaCallBeautify.status, 0, `Phase 36 profile media/call/beautify regressions failed:\n${phase36ProfileMediaCallBeautify.stdout}\n${phase36ProfileMediaCallBeautify.stderr}`);
console.log(phase36ProfileMediaCallBeautify.stdout.trim());
const phase36CallTransitions = spawnSync(process.execPath, ['tests/phase36-call-transition-integrity.test.mjs'], { cwd: root, encoding: 'utf8' });
assert.equal(phase36CallTransitions.status, 0, `Phase 36 call transition/scheduler regressions failed:\n${phase36CallTransitions.stdout}\n${phase36CallTransitions.stderr}`);
console.log(phase36CallTransitions.stdout.trim());
const phase37AuditFixes = spawnSync(process.execPath, ['tests/phase37-audit-fixes.test.mjs'], { cwd: root, encoding: 'utf8' });
assert.equal(phase37AuditFixes.status, 0, `Phase 37 audit-fix regressions failed:\n${phase37AuditFixes.stdout}\n${phase37AuditFixes.stderr}`);
console.log(phase37AuditFixes.stdout.trim());
const backupAtomicity = spawnSync(process.execPath, ['tests/backup-atomicity.test.mjs'], { cwd: root, encoding: 'utf8' });
assert.equal(backupAtomicity.status, 0, `V4 backup atomicity and Phase 31 startup-preflight regressions failed:\n${backupAtomicity.stdout}\n${backupAtomicity.stderr}`);
console.log(backupAtomicity.stdout.trim());
const phase31StrictDurability = spawnSync(process.execPath, ['tests/phase31-restore-strict-durability.test.mjs'], { cwd: root, encoding: 'utf8' });
assert.equal(phase31StrictDurability.status, 0, `Phase 31 strict media/font durability regressions failed:\n${phase31StrictDurability.stdout}\n${phase31StrictDurability.stderr}`);
console.log(phase31StrictDurability.stdout.trim());
const phase28Restore = spawnSync(process.execPath, ['tests/phase28-restore-combined-failures.test.mjs'], { cwd: root, encoding: 'utf8' });
assert.equal(phase28Restore.status, 0, `Phase 28 combined restore failure regressions failed:\n${phase28Restore.stdout}\n${phase28Restore.stderr}`);
console.log(phase28Restore.stdout.trim());
const runtimeRecovery = spawnSync(process.execPath, ['tests/runtime-recovery.test.mjs'], { cwd: root, encoding: 'utf8' });
assert.equal(runtimeRecovery.status, 0, `runtime recovery regressions failed:\n${runtimeRecovery.stdout}\n${runtimeRecovery.stderr}`);
console.log(runtimeRecovery.stdout.trim());
const storageDiagnosticsTest = spawnSync(process.execPath, ['tests/storage-diagnostics.test.mjs'], { cwd: root, encoding: 'utf8' });
assert.equal(storageDiagnosticsTest.status, 0, `storage diagnostics regressions failed:\n${storageDiagnosticsTest.stdout}\n${storageDiagnosticsTest.stderr}`);
console.log(storageDiagnosticsTest.stdout.trim());
const recoveryWorkbenchTest = spawnSync(process.execPath, ['tests/recovery-workbench.test.mjs'], { cwd: root, encoding: 'utf8' });
assert.equal(recoveryWorkbenchTest.status, 0, `recovery workbench regressions failed:\n${recoveryWorkbenchTest.stdout}\n${recoveryWorkbenchTest.stderr}`);
console.log(recoveryWorkbenchTest.stdout.trim());
const recoveryCandidateTest = spawnSync(process.execPath, ['tests/recovery-candidate-package.test.mjs'], { cwd: root, encoding: 'utf8' });
assert.equal(recoveryCandidateTest.status, 0, `recovery candidate package regressions failed:\n${recoveryCandidateTest.stdout}\n${recoveryCandidateTest.stderr}`);
console.log(recoveryCandidateTest.stdout.trim());
const candidateValidatorTest = spawnSync(process.execPath, ['tests/recovery-candidate-validator.test.mjs'], { cwd: root, encoding: 'utf8' });
assert.equal(candidateValidatorTest.status, 0, `candidate validator regressions failed:\n${candidateValidatorTest.stdout}\n${candidateValidatorTest.stderr}`);
console.log(candidateValidatorTest.stdout.trim());
const isolationEngineTest = spawnSync(process.execPath, ['tests/recovery-isolation-engine.test.mjs'], { cwd: root, encoding: 'utf8' });
assert.equal(isolationEngineTest.status, 0, `isolation engine regressions failed:\n${isolationEngineTest.stdout}\n${isolationEngineTest.stderr}`);
console.log(isolationEngineTest.stdout.trim());
const isolationUiTest = spawnSync(process.execPath, ['tests/recovery-isolation-ui.test.mjs'], { cwd: root, encoding: 'utf8' });
assert.equal(isolationUiTest.status, 0, `isolation UI regressions failed:\n${isolationUiTest.stdout}\n${isolationUiTest.stderr}`);
console.log(isolationUiTest.stdout.trim());
const applicationAuditTest = spawnSync(process.execPath, ['tests/recovery-application-auditor.test.mjs'], { cwd: root, encoding: 'utf8' });
assert.equal(applicationAuditTest.status, 0, `application consistency audit regressions failed:\n${applicationAuditTest.stdout}\n${applicationAuditTest.stderr}`);
console.log(applicationAuditTest.stdout.trim());
console.log(`PASS: 352 sticker assets; phase-2 send button/Enter toggle/batch queue and backup persistence; manual-only Android backup rules; Gradle source checks; Android 13+ and legacy Back hooks; single SAF save picker; legacy/V4 import URL validation; message text/metadata escaping; malformed V4 manifest rejection; 128 MB JSON cap; mailbox KKK alignment; chat/mailbox/Circle media ownership, migration, backup and rollback checks; direct and batch media-send path rollback checks; V4 manifest identity validation; export/restore mutual exclusion; atomic font restore; cross-module backup rollback checks; crash-recovery journal; single-writer multi-tab coordination; storage quota reporting and aged orphan-media cleanup; read-only salvage analysis, privacy-safe preview, isolated candidate ZIP generation, independent ZIP/manifest/hash validation, copy-on-write reconstruction, application consistency audit, recovery UI gating and Phase 17–37 browser recovery acceptance matrix/path-filter validation; ${scriptIndex} inline scripts and root JS syntax; Android XML parsing.`);
