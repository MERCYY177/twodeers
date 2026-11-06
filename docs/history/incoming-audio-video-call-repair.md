# twodeers 主动语音 / 视频来电恢复返修报告

- 仓库：`MERCYY177/twodeers`
- 分支：`main`
- 修改文件：`index.html`
- 最终文件 Blob：`6f09fa423f5252b6e191b1fbaa04d46606cbd51f`
- 最终提交：`cceb216fdde21586de0bc2f39ca859ae7377a36c`
- 本次修改基于读取到的 main 最新文件增量完成；未整体替换旧版本。

> 旧参考文件 `双人空间APP_最新合并版_字卡池参数区_双向来电版.html` 未出现在当前仓库可检索文件或可用分支中，因此没有声称已复用其源码。实现按本次指令列出的旧版行为和参数默认值恢复，没有把旧版整体导入。

## 1. 修改位置

| 位置（main/index.html） | 内容 |
|---|---|
| 约 217 行 | 新增来电全屏弹窗样式、头像、接听/拒绝按钮样式 |
| 约 3972 行 | 参数区「他主动给我打电话」设置模块 |
| 约 4099 行 | 新增来电界面 DOM |
| 约 4160 行 | 主动来电配置校验与归一化 |
| 约 4575 行 | 单一调度器、来电触发、接听/拒绝/超时、恢复和结束流程 |
| 约 5060 行 | 参数控件事件绑定 |
| 约 5280 行 | 参数备份导出 |
| 约 5404 行 | 参数备份恢复及旧备份默认值 |
| 约 5530 行 | 应用 init 中初始化主动来电调度 |

行号以最终提交文件为准。

## 2. 新增状态与默认参数

`state.incomingCallSettings` 与手动拨出 `state.callSettings` 完全分离：

- `enabled: true`：主动来电总开关，默认启用
- `audioEnabled: true`：允许主动语音来电
- `videoEnabled: true`：允许主动视频来电
- `videoProbability: 60`：两种类型均允许时视频概率 60%，语音概率 40%
- `minIntervalSec: 90`
- `maxIntervalSec: 180`
- `ringTimeoutSec: 25`

通话运行态使用 `state.call.direction`（incoming/outgoing）、`state.call.phase`（idle/ringing/active）、`type`、`incomingAt`、`startAt` 区分来电响铃、已接通和手动拨出。

## 3. 实际调用闭环

- 初始化：`init()` → `restoreCallIfNeeded()` → `initializeIncomingCallScheduler()` → `scheduleIncomingCall()`
- 到时触发：调度器回调 → `triggerIncomingCall(type)` → 设置 `phase='ringing'` → 显示来电界面 → 启动唯一响铃超时
- 接听：`incomingAnswerBtn` → `answerIncomingCall()` → 清除响铃超时 → 设置 `phase='active'`、写入 `startAt=Date.now()` → 启动现有通话计时器 → 显示原通话界面
- 拒绝：`incomingRejectBtn` → `rejectIncomingCall()` → 写入拒绝记录 → 清理状态 → `scheduleIncomingCall({forceNew:true})`
- 超时：响铃超时回调 → `missIncomingCall()` → 写入未接来电记录 → 清理状态 → 重新调度
- 挂断：原 `endCall()` → 写入通话结束记录 → 清理状态 → 释放 Wake Lock → 重新调度

同一时刻只保留一个调度定时器和一个响铃超时定时器。调度使用 token 使旧回调失效；通话中不调度下一通。重复调用初始化不会叠加有效调度器。

## 4. 参数区设置

- 主动来电总开关
- 主动语音来电开关
- 主动视频来电开关
- 视频来电概率 0–100%
- 最短 / 最长间隔（秒）
- 无人接听超时（秒）
- 运行状态：已开启/关闭、正在响铃/通话、下一次是否已安排

手动拨出权限仍保存在 `callSettings.audioEnabled` / `callSettings.videoEnabled`；主动来电类型开关保存在独立的 `incomingCallSettings`，不会互相替代。

## 5. 数据保存与备份兼容

- 所有设置通过既有 `save()` 写入 `STORAGE_KEY`。
- 参数备份 `backupJsonParts('param')` 新增导出 `incomingCallSettings`。
- 参数备份恢复读取并校验新配置；旧参数备份缺少该字段时只给主动来电配置补默认值，不覆盖其他参数。
- 总备份本来保存完整 state；恢复时对新字段归一化。旧总备份缺少新字段时同样补默认值。
- 数值校验：间隔限制在 1–86400 秒，若最短大于最长则将最长修正为最短；概率限制在 0–100；响铃超时限制在 5–300 秒。
- 页面刷新时，若持久化状态仍是 ringing，会记录为未接来电、清理残留界面，再安排下一轮；若是已接通状态，则恢复现有通话界面和计时。

## 6. 页面生命周期

监听现有 `visibilitychange` 和 `focus`：
- 未来来电时间未到：保留原定时器。
- 来电时间已过：清除旧 timer/token，只补触发一次。
- 响铃超时会根据 `incomingAt` 校验剩余时间，避免页面从后台恢复后继续无限响铃。

此功能是网页/WebView 运行期间的模拟来电。页面彻底关闭、系统强制停止或操作系统完全挂起时，不能保证系统级唤醒；不包含真实电话通信、WebRTC、摄像头采集或系统电话通知。

## 7. 源码与逻辑验证

<badge>源码检查通过</badge>

- 三段 inline JavaScript 均通过语法解析。
- 新增来电 UI 的 14 个 ID 均唯一出现。
- init 调用链包含第一次主动来电调度。
- scheduler 和 ring timeout 各自只有一个 timer handle，并用 token 阻止过期调度回调。
- 仅语音、仅视频、两种均开启及 0% / 100% 视频概率分支通过逻辑模拟。
- 主动来电先进入 ringing，未接听前不启动通话计时；接听后才进入 active 并启动计时。
- 拒绝、超时、挂断分支均验证会清理状态并安排下一轮。
- 关闭总开关验证会取消调度并清空 nextAt。
- 重复初始化/重复 schedule 验证不会增加有效调度定时器。
- 刷新时遗留 ringing 状态验证会转为未接来电并重新调度。
- 非法间隔、概率和超时时间验证会被归一化。
- 手动拨出入口和 `startCall(type)` 仍在，且仍使用独立的 `callSettings`。
- 朋友圈仍为 Shadow DOM 内嵌结构；没有修改朋友圈脚本、字卡池、媒体、表情包或聊天消息模块。

## 8. 尚未执行的测试

未进行真实 Android 手机、Android WebView 或桌面浏览器端到端测试；未验证设备锁屏、后台挂起、实际振铃音效等设备行为。以上通过项是源码静态检查和隔离的调度逻辑模拟，不代表真实设备验收。
