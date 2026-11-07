# 双人空间 Android 壳工程

该工程只负责把仓库根目录当前网页应用封装进 Android WebView，不替换网页业务结构。

## 网页源码检查

在仓库根目录使用 Node.js 22：

```bash
npm ci
npm run verify
npm test
```

需要运行真实浏览器回归时，先启动本地 HTTP 服务，再执行 `npm run test:browser`；若使用系统安装的 Chromium，可设置 `CHROMIUM_PATH` 指向浏览器可执行文件。CI 使用锁定的 Playwright 版本并安装对应 Chromium。

## Gradle 版本

Android GitHub Actions 固定使用 Gradle 8.9。当前源码包未包含 Gradle Wrapper；本地构建仍需自行安装 Gradle 8.9。

## 构建

需要 JDK 17、Android SDK Platform 35、Build Tools 35.x 与 Gradle 8.9：

```bash
cd android-apps
gradle :app:assembleDebug
```

Gradle 的 `verifyBuiltinStickers` 会先校验仓库内 352 项表情清单及每个资源文件，再由 `stageWebProject` 把仓库根目录的 `index.html`、JS/CSS/JSON 及 `assets/**` 暂存到 APK 的 `assets/site/`。构建不再依赖不存在的原始 ZIP 或 Python 脚本。入口为 `https://appassets.androidplatform.net/assets/site/index.html`。网页使用本地 HTTPS Origin，IndexedDB 与 localStorage 保存在该 APK 的 WebView 数据空间中；它们不会自动继承 GitHub Pages Origin 的数据。

## 文件处理

- `WebChromeClient.onShowFileChooser` 接通 Android 文件选择器，网页 `input[type=file]` 可读取用户选中的内容。
- 页面导出 Blob 时，原生桥接覆盖双人空间的 `triggerDownloadBlob(name, blob)`。用户点击“保存备份到手机”后，通过 `ACTION_CREATE_DOCUMENT` 选择目标位置，再以 24 KiB 分块传输。
- Java 桥接核对实际写入字节数与请求 Blob 大小一致后才完成保存；超过 1 GiB 的单个备份被拒绝。

## 从网页迁移

旧网页数据与 APK 本地 Origin 不同。请先在 GitHub Pages 网页导出“V4 总备份 ZIP”，再在 APK 中导入该 ZIP，并等待资源 SHA-256/CRC32 回读校验完成。相同包名的 APK 更新通常保留应用私有数据；卸载会清除本地数据库，需先导出备份。

## 验证边界

此工程目前提供可由 GitHub Actions 构建的 debug APK 工程；本工作环境没有 Android SDK、模拟器或真机，未在本机执行 APK 构建、文件选择器真机验证、重启持久化或卸载重装恢复测试。CI workflow 产物为 debug APK，不是签名 release APK。


## Android 系统备份策略

Manifest 将 `android:allowBackup` 设为 `false`，并同时配置 Android 旧版 `backup_rules.xml` 与 Android 12+ `data_extraction_rules.xml`，明确排除云端备份和设备间迁移。应用仍会正常把聊天、信件和媒体保存到本机 WebView 存储；V4 ZIP 只在用户主动点击备份后生成，且仍由用户选择 SAF 保存位置。手动导入也仍由用户选择备份文件触发。

## 系统返回键

系统返回键会先询问网页设置导航；若当前打开参数区分类子页面，则先返回参数区首页。只有网页没有可关闭的设置子页面时，才交回 Android Activity 的默认返回行为。

## 本次加固静态验收

在仓库根目录执行 `node tools/verify-twodeers-hardening.mjs`，检查 Android 自动备份排除配置、352 项内置表情资源、APK 构建资源前置校验、系统返回键接入、通知事件更新和备份导入校验，并对根目录 JS 与 `index.html` 内联脚本做语法检查。
