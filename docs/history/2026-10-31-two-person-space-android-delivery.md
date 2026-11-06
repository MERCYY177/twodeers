# 双人空间全面升级与 Android 适配交付报告

**日期：2026-10-31**  
**目标仓库：** `MERCYY177/twodeers`  
**分支：** `main`  
**最终代码提交：** `4d4e2a9f2644c3a76038f0292f28e389eabd0b7d`  
**本报告提交后，最终仓库 HEAD 会更新为报告提交；本次 APK 对应的代码版本即上述提交。**

## 1. 总体结果

本次按增量方式修改双人空间，没有用参考项目的页面或业务代码替换 `index.html`。主页面、原聊天数据结构、原媒体引用方式、Circle Shadow DOM、原主动来电状态、原 v3 JSON 导入逻辑均保留。

以下部分已实际实现并通过自动化验证：

- 主题模式、9 套配色、外观设置即时应用与本地持久化。
- TTF、OTF、WOFF、WOFF2 字体导入、二进制签名识别、FontFace 预检、IndexedDB 保存、应用、预览、删除和恢复默认。
- 上传表情收藏与分类；原左右双列面板、原上传流程、原 `mediaId` 消息引用和历史消息媒体保护保留。
- V4 ZIP 备份与校验、v3 JSON 兼容导入。
- Android WebView 壳工程、网页文件选择桥接、SAF 原生备份保存和 CI APK 构建。

**未完成项也必须明确：参考项目的内置表情图片二进制文件没有迁入本仓库。** 当前界面“内置表情”分类会显示迁移状态说明，不会伪装成已经有 259 个可发送内置表情。Android 真机/模拟器文件交互也尚未验证。

## 2. 修改文件清单

### 网页与功能模块

| 文件 | 实际修改 |
|---|---|
| `index.html` | 保留原页面和业务结构，仅在页面入口接入新模块脚本；原双列表情包 DOM 未替换。 |
| `appearance-manager.js` | 新增独立主题状态、配色方案、模式切换、预览及主页面/Circle 变量应用。 |
| `custom-font-manager.js` | 适配参考项目当前字体管理器；增加字体库备份导出/导入接口，并将字体记录导入预检改为逐项处理。 |
| `font-panel.js` | 在参数区加入字体管理入口、字体列表和恢复默认按钮，并将字体同步到 Circle 宿主。 |
| `sticker-library.js` | 加入上传/收藏/内置三个分类入口；收藏以表情稳定 ID 保存，删除上传项时同步清理收藏引用。内置图片资源本身未迁入。 |
| `backup-v4.js` | 新增 V4 ZIP 打包、manifest、SHA-256/CRC32 校验、媒体/字体资源管理、导入校验和异常回滚。 |

### 测试与构建

| 文件 | 实际修改 |
|---|---|
| `tests/backup-v4.test.mjs` | SHA-256/CRC32 标准向量、V4 ZIP 生成解析、媒体资源打包、损坏资源拒绝等 Node 测试。 |
| `tests/browser-smoke.mjs` | Playwright 浏览器回归：主题刷新持久化、双列表情包、上传/收藏/发送、字体导入、V4 恢复及 v3 导入。 |
| `tools/verify-source.mjs` | 检查主页面脚本语法、新模块接入、原主动来电和双列表情包入口、V4/Android 关键函数。 |
| `.github/workflows/android-apk.yml` | GitHub Actions 自动跑源码/备份/Chromium 回归并构建、上传 Android debug APK。 |

### Android 原生工程

新增 `android-apps/` 工程，包括：

- `settings.gradle.kts`、`build.gradle.kts`、`gradle.properties`
- `app/build.gradle.kts`
- `app/src/main/AndroidManifest.xml`
- `app/src/main/java/com/mercyy/twodeers/MainActivity.java`
- `app/src/main/res/values/strings.xml`
- `app/src/main/res/values/styles.xml`
- `README.md`

## 3. 原有数据和功能保留方式

审查到的原主应用状态仍使用现有 localStorage 状态键 `dual_space_app_clean_test_v1`；聊天媒体继续使用现有 IndexedDB `dual-space-media-v1` / `media` 对象仓库，记录仍按 `mediaId` 引用媒体 Blob。本次未改写其数据库名称、对象仓库或消息媒体字段。

Circle 仍由 `index.html` 内嵌脚本通过 Shadow DOM 装载，原有 `window.__duoCircleApi` 导出、校验和导入接口继续使用。主题与字体模块通过宿主 CSS 变量/字体样式衔接，没有把 Circle 改成另一套页面。

原有上传表情仍写入原媒体仓库并使用原 `mediaId`；发送继续走原消息追加调用。删除上传表情仍由原有引用检查决定媒体能否实际删除：若聊天历史仍引用该媒体，不会因从面板移除而清掉历史消息文件。新增收藏只保存上传表情 ID，不复制图片 Blob。

原来 `callSettings` 与 `incomingCallSettings` 仍保留为独立字段，未更改原主动来电/手动外呼函数。源码静态检查确认主动来电 scheduler 和原双列表情包结构仍在。没有清空用户状态或要求用户重置数据。

## 4. 主题与外观系统

`appearanceSettings` 独立保存以下字段：

- 模式：浅色、深色、跟随系统。
- 配色：鼠尾草、海洋蓝、薰衣草、樱花粉、森林绿、日落橘、薄荷青、黑白灰、奶油米白，共 9 套；每套均提供浅/深配色。
- 页面背景：柔和纯色、简洁纯色、轻柔渐变。
- 聊天气泡：柔和、经典、扁平。

选择后即时应用并通过原 `save()` 保存，重新载入后从主状态恢复；跟随系统模式订阅系统深浅色变化。主题应用到页面背景、主要面板/控件/聊天相关变量和 Circle 宿主变量。原 `appearanceColors` 和 `customCSS` 不被新配置覆盖；现有自定义强调色、按钮颜色仍作为旧设置保留。

**覆盖边界：** 这是对现有 CSS 的变量层和主要组件样式扩展，不代表已逐一人工检查每一个历史页面/每一个弹窗在所有主题下的像素表现。Chromium 自动验证覆盖暗色/配色切换、刷新持久化和 Circle 宿主主题变量。

## 5. 表情包升级状态

实际完成：

- 保留左侧 Emoji、右侧上传表情的双列结构。
- 右侧新增“我的上传 / 收藏 / 内置表情”入口。
- 上传表情继续使用原 IDB Blob 和 `mediaId`。
- 收藏状态在 `state.stickerFavorites` 中保存，刷新后保留。
- 从上传列表删除时同步移除收藏 ID；历史消息引用资源的清理仍受原 `deleteIfUnreferenced` 逻辑保护。

**未完成：内置表情资源二进制迁移。**

重新检查参考仓库 `kkk35g1` 当前 `assets/stickers/embedded/`，GitHub 最新目录列表为 53 个文件：GIF 9、JPG 41、PNG 3。任务文本中提到的 259 条内置包数据 `xiaoshu-builtin-sticker-packs-data-v1` 在当前可检索的仓库实现/数据中没有找到对应清单。当前 GitHub 文件工具只支持 UTF-8 文本读取，无法把这些图片二进制以可写入形式复制到目标仓库；因此没有写入假文件、没有用外链冒充本地资源，也没有声称 GIF/JPG/PNG 已加载通过。

当前“内置表情”标签明确展示该状态说明，不能作为真正的内置表情库使用。需要后续获得可下载的参考项目归档或资源目录后，才能完成文件同步、SHA 校验、GIF 动画/图片渲染及实际发送测试。

## 6. 字体管理

已实现：

- TTF、OTF、WOFF、WOFF2。
- 每个字体文件最大 50 MB。
- 检查文件扩展名与前 4 字节真实签名是否一致；对字体进行 FontFace 加载预检，损坏文件不会直接替换当前字体。
- 字体 Blob 存在独立 IndexedDB：`chuanxun-local-font-library`，不写入 localStorage。
- 支持导入、列出、预览、应用、删除、恢复系统默认；删除当前字体前切回默认。
- 主页面样式应用字体，同时将当前字体 family 同步到 Circle Shadow DOM 宿主。
- 全局字体选择器排除 SVG、图标字体、Emoji、图片/表情包等非正文内容。
- V4 总备份与参数备份包含实际字体 Blob 和当前字体 ID；恢复时检查字体二进制并还原字体库。

CI Chromium 回归中实际选择并导入了 Runner 上的 DejaVu TTF，日志报告 `customFontImported: true`，且 V4 备份含 1 项字体资源。四种扩展名均具备解析分支，但本次自动化只实际用 TTF 样本完成浏览器导入，未声称其余三种均经过独立真实字体文件测试。

## 7. V4 备份内容与恢复边界

V4 使用 ZIP 容器，采用无压缩（store）条目；每项资源 manifest 记录路径、类型、ID（适用时）、大小、MIME、SHA-256、CRC32。文件读取/哈希按 Blob stream 或 1 MiB 分块执行；当前打包最终仍组装为一个 Blob，不是端到端的文件系统流式写出。ZIP32 条目/偏移限制，并限制备份资源合计最多 1 GiB；单字体仍受 50 MB 限制。

| 类型 | 包含内容 | 不包含/边界 |
|---|---|---|
| `all` | 主应用完整状态、聊天消息/上传表情元数据、聊天/表情引用的媒体 Blob、独立 `circle-state.json`、字体库清单及字体 Blob。主状态中的头像/背景等现有 Data URL 继续随状态 JSON 保存。 | 当前 Circle 状态独立导出为 JSON；没有将 Circle 内部可能存在的内嵌 Data URL 再拆成独立的 `media/` 文件条目。 |
| `chat` | 聊天记录、上传表情、收藏 ID、相关头像/聊天背景及聊天外观/回复/来电设置，和消息/上传表情引用的实际媒体 Blob。 | 不包含字体库，不包含 Circle 完整状态。 |
| `param` | 参数、外观主题、自定义 CSS、卡片字句、来电设置、现有 Data URL 外观资源、字体库清单与实际字体 Blob。 | 不包含聊天记录/聊天媒体和 Circle 完整状态；不包含上传表情库。 |

导入流程先检查 ZIP 路径、manifest 资源数量、大小、SHA-256/CRC32，再确认所引用媒体存在于本次备份包；总备份要求有独立 Circle 文件，参数/总备份要求有字体库清单。写入媒体后会从原 IndexedDB 回读确认 Blob 大小。恢复失败时尝试恢复原主状态/localStorage、Circle 状态、原媒体记录和原字体库。

旧 v3 JSON 的原 `applyBackupPayload` 导入路径保留；导入选择器可识别 ZIP 与 JSON。Chromium 测试通过 `buildBackup('param')` 生成的 v3 JSON 并调用原导入函数完成兼容性验证。

**容量/完整性说明：** SHA-256 是完整性校验，不是签名或加密；ZIP 不压缩，最终 Blob 仍会占用内存。虽然哈希读写分块，但并未实现 ZIP 直接流式写入文件系统。当前测试覆盖小型图片媒体和单个 TTF，未覆盖多 GB 数据、海量图片、多个视频/音频、50 MB 字体、不同 WebView 存储配额或断电中止恢复；1 GiB 是代码保护上限，不等于已在设备上验证可用的实际容量。

## 8. Android 文件与存储适配

新增原生工程使用 JDK 17、AGP 8.6.1、Gradle 8.9、compileSdk 35，应用 ID 为 `com.mercyy.twodeers`。Gradle 会将网页入口、JS/CSS/JSON 和 `assets/**` 暂存到 APK 的 `assets/site/`。

WebView 使用 `WebViewAssetLoader` 提供 `https://appassets.androidplatform.net/assets/site/index.html` 本地 HTTPS Origin，并启用 JavaScript、DOM Storage、IndexedDB 所需设置。此 Origin 与 GitHub Pages 不同，浏览器 localStorage/IndexedDB 不会自动出现在 APK 中。迁移路径是：**旧网页导出 V4 总备份 ZIP → APK 选择 ZIP 导入 → 校验并恢复数据。** 同包名应用更新通常沿用应用私有数据；卸载会清除应用数据，必须先备份。

文件选择通过 `WebChromeClient.onShowFileChooser` 回应网页 `input[type=file]`。原生保存桥适配双人空间自己的 `triggerDownloadBlob(name, blob)`，不是照搬参考项目的 `window.xiaoshuOfferBlobDownload`。用户在网页点击原生保存按钮后，Android 调用 `ACTION_CREATE_DOCUMENT`，每次最多传 24 KiB 数据块；原生端检查写入计数是否等于请求 Blob 字节数，并在文档提供器可报告 `OpenableColumns.SIZE` 时回查实际文件大小。单文件超过 1 GiB 拒绝。无原生桥的普通浏览器仍走原下载函数。

## 9. 自动化验证结果

最新目标代码提交 `4d4e2a9f2644c3a76038f0292f28e389eabd0b7d` 的 GitHub Actions Android 工作流运行：

- 工作流：`Android debug APK`
- 运行结果：**success**
- 运行地址：<https://github.com/MERCYY177/twodeers/actions/runs/41181995638>
- 源码静态检查：通过。
- Node V4 测试：通过（SHA-256/CRC32 标准向量、ZIP 生成/解析、资源和媒体条目检查、篡改数据拒绝）。
- Playwright Chromium 回归：通过，日志结果包含：
  - `themePersisted: true`
  - `twoColumnStickers: true`
  - `favoritePersistence: true`
  - `mediaSentAndBackedUp: true`
  - `v4Restore: true`
  - `v3Import: true`
  - `customFontImported: true`
  - 本次 V4 测试包 764,349 bytes，含 1 个媒体资源和 1 个字体资源。
- Gradle `:app:assembleDebug`：通过。
- Artifact 上传：通过。

**Android 构建产物：** GitHub Actions artifact 名称 `twodeers-debug-apk`，ZIP artifact 为 1,254,356 bytes，其中 `app-debug.apk` 为 1,286,021 bytes。本次提取后的 APK 已执行 ZIP 完整性检查，无压缩结构错误。该 APK 是 debug 构建，不是已签名的 release 包。

## 10. 尚未完成/无法验证

1. **内置表情图片资源没有迁移。** 这是当前明确的功能缺口；“内置表情”只能展示状态说明，不能实际浏览、发送。
2. 未取得 Android 真机/模拟器；没有在真实 Android WebView 上点选文件、导入字体/备份、通过 SAF 保存备份、重启验证 IndexedDB、应用升级或卸载重装恢复。
3. 浏览器回归只覆盖 Chromium 桌面环境、小型 PNG、单个 DejaVu TTF、单消息/单媒体恢复。未完成大体积照片/视频/音频、多个字体、完整媒体库压力测试和大备份失败注入。
4. V4 备份以单个 Blob 组装，并非真正端到端流式文件输出；大数据量会有内存压力。最大 1 GiB 是实现限额，实际存储配额取决于浏览器/WebView 和设备。
5. 未构建签名 release APK；当前交付的是 CI 成功产出的 debug APK。

因此本次交付已具备主题、字体、V4 备份与 Android 工程的实际实现和自动化构建，但不应表述为用户需求清单的所有子项均已完成；内置表情资源迁移和 Android 真机验证仍待完成。
