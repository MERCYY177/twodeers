> **历史快照 / 已被后续修复与验收更新取代**：本文记录的是当时 71 项测试通过的状态，不代表当前源码包的最新测试数量或完整验收状态。当前表情包删除保护以 `../maintenance/2026-11-06-sticker-delete-guard.md` 为准；当前测试结果以项目根目录 `README.md` 的本次整理记录为准。

# TwoDeers 全面复审与补充修复报告

- 日期：2026-11-06
- 工作基线：`twodeers-p1-p2-fixed-2026-11-06.zip`
- 修改范围：仅本地独立工作副本；未修改 GitHub `main`，未推送、合并或部署。
- 当时结论：P1/P2 数据安全路径、已确认的 P2 缺陷和 P3 资源/记录追踪问题已补修，并通过当时的 Node 回归与静态集成检查。浏览器 E2E、Android 构建和真机测试因运行环境限制仍未完成，不能称为全平台验收通过。

## 1. 本轮补修

### 1.1 图片上传锁

- 将最大图片数校验移到 `addingComposeImages` 锁设置之前。
- 超限选择直接返回，不再留下永久占用的上传锁。
- 新增回归测试：先选择 7 张触发上限，再选择 1 张有效图片，确认后续上传正常完成。

### 1.2 字卡使用记录队列容量与背压

- 聊天、朋友圈、信件三个业务 outbox 均设置 1000 条待处理事件上限。
- 达到上限时不再继续接受需要新增使用事件的操作：聊天消息暂缓发送；朋友圈字卡动态/评论暂缓执行；信件保留草稿；自动回信/来信任务留在队列等待后续重试。
- 不静默截断旧事件，不因容量不足丢弃已有待处理记录。
- `appliedEventIds` 幂等账本设置 10000 个 ID 的安全上限；达到上限后拒绝新事件并返回失败，原事件继续保留在来源 outbox 中。没有对旧 ID 做不安全的自动压缩，因为历史备份可能重新导入旧事件。
- 增加满载测试，覆盖聊天、朋友圈、信件发送、自动回信延迟处理，以及幂等账本容量上限。

### 1.3 最近使用记录的来源追踪

- 聊天事件保存 `messageId` / `sourceId`。
- 信件事件保存 `letterId` / `sourceId`，自动回信的 `sourceId` 指向原信件。
- 朋友圈事件保存 `postId` / `sourceId`。
- 最近使用记录保留这些字段，便于追查一条记录来自哪条消息、信件或动态。

### 1.4 信件媒体资源回收

- 关闭阅读/写信弹层时，回收当前不再被可见弹层使用的 Blob URL。
- 切换阅读信件或写信草稿时，清除旧预览并回收失去引用的 URL。
- 草稿超过 50 封而淘汰旧草稿时，在新草稿成功保存后清理只被淘汰草稿引用的媒体。
- 信件超过 5000 封时，保存前淘汰最旧信件；只有新状态成功提交后才清理淘汰信件独占的附件。
- 导入信箱备份成功后，对旧信箱/旧草稿不再引用的附件执行清理；新数据仍引用的媒体不会被误删。
- 新增 Blob URL 回收、草稿淘汰清理、信件淘汰清理测试。

### 1.5 测试依赖与 CI

- 新增 `package.json` 与 `package-lock.json`，固定 Playwright `1.64.1` 及其 `playwright-core` 依赖版本和完整性哈希。
- CI 改为 `npm ci`，不再无锁安装 Playwright；Node 固定为 22。
- 浏览器测试支持通过 `CHROMIUM_PATH` 指定系统 Chromium，便于在已有浏览器的环境执行。
- `npm ci --ignore-scripts --dry-run --offline --no-audit --no-fund` 已通过，验证 manifest/lockfile 结构与版本对应关系；当前环境无法访问 npm registry，未执行实际依赖下载。

### 1.6 历史报告

- `2026-11-05-repair-completion.md` 与 `2026-11-05-repair-follow-up.md` 已加上“历史记录 / 已被后续审计取代”提示。
- 当时的实现状态和验收数据以本文件为准；本文件现已归档，不能替代当前源码包的最新测试结果。

## 2. 验收结果

### 通过

| 检查 | 结果 |
|---|---:|
| `node tools/verify-source.mjs` | 通过 |
| `node --check mailbox-manager.js` | 通过 |
| `node --check card-system.js` | 通过 |
| `node --check backup-v4.js` | 通过 |
| `npm test` / `node --test tests/*.test.mjs` | **71/71 通过，0 失败** |
| npm lockfile 离线 dry-run | 通过 |

新增/补强测试覆盖图片超限后的锁释放、三个 outbox 的容量背压、自动回信保留与重试、幂等账本容量、消息/信件/动态来源追踪、Blob URL 回收、50 封草稿淘汰清理、5000 封信件淘汰清理。

### 未能完成（不得记为通过）

| 检查 | 状态 | 原因 |
|---|---|---|
| `tests/browser-smoke.mjs` | 未通过启动后的页面导航 | 已能调用当前环境预装的 Playwright 与系统 Chromium，但浏览器访问 `http://127.0.0.1:8080/index.html` 返回 `ERR_BLOCKED_BY_ADMINISTRATOR`；改用 `file://` 也被同一策略阻止 |
| Android Gradle 构建 | 未执行 | 当前环境没有 `gradle` 命令、Android SDK 或可用设备；项目已有 GitHub Actions 固定 Gradle 8.9，但本轮没有运行远程 CI |
| Android WebView 真机测试 | 未执行 | 没有连接 Android 真机/模拟器 |

项目尚未包含 Gradle Wrapper。当前环境没有 Gradle 安装且网络 DNS 不可用，无法从可信 Gradle 发行包生成并校验 Wrapper 文件；没有用手写脚本冒充 Wrapper。Android CI 继续使用 `gradle/actions/setup-gradle@v4` 固定 Gradle 8.9。若要把“本地无需预装 Gradle”也作为交付条件，需要在可访问官方 Gradle 发行包的环境生成并校验 Wrapper，再补跑 Android 构建。

## 3. 保留的边界

- 本 ZIP 是网页源码与 Android 壳工程源码，不是 APK。
- 没有部署、推送或修改远程 `main`。
- Node 自动化与静态集成检查已通过；浏览器真实页面交互和 Android 运行时尚未通过本环境验收。
- 字卡使用事件容量上限是明确背压，不是无限容量：三个业务 outbox 各最多保留 1000 条待处理事件，幂等 ID 账本最多 10000 条；达到限制时阻止相应的新记录操作，不静默丢弃旧事件。
