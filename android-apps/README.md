# 双人空间 Android 壳工程

该工程只负责把仓库根目录当前网页应用封装进 Android WebView，不替换网页业务结构。四个产品变体（贝贝鹿、鹿1、鹿2、鹿3）共用 MainActivity 与主题资源，系统浅/深色适配在公共原生壳层完成。

## 构建

需要 JDK 17、Android SDK Platform 35、Build Tools 35.x 与 Gradle 8.9：

```bash
cd android-apps
gradle :app:assembleDebug
```

Gradle 的 `stageWebProject` 任务会把仓库根目录的 `index.html`、JS/CSS/JSON 及 `assets/**` 暂存到 APK 的 `assets/site/`，入口为 `https://appassets.androidplatform.net/assets/site/index.html`。网页使用本地 HTTPS Origin，IndexedDB 与 localStorage 保存在该 APK 的 WebView 数据空间中；它们不会自动继承 GitHub Pages Origin 的数据。

## 文件处理

- `WebChromeClient.onShowFileChooser` 接通 Android 文件选择器，网页 `input[type=file]` 可读取用户选中的内容。
- 页面导出 Blob 时，原生桥接覆盖双人空间的 `triggerDownloadBlob(name, blob)`。用户点击“保存备份到手机”后，通过 `ACTION_CREATE_DOCUMENT` 选择目标位置，再以 24 KiB 分块传输。
- Java 桥接核对实际写入字节数与请求 Blob 大小一致后才完成保存；超过 1 GiB 的单个备份被拒绝。

## 从网页迁移

旧网页数据与 APK 本地 Origin 不同。请先在 GitHub Pages 网页导出“V4 总备份 ZIP”，再在 APK 中导入该 ZIP，并等待资源 SHA-256/CRC32 回读校验完成。相同包名的 APK 更新通常保留应用私有数据；卸载会清除本地数据库，需先导出备份。

## 系统深色模式

Android 10 及以上通过 `values-night-v29` 中的 `android:isLightTheme=false` 告知 WebView 当前应用主题为深色；浅色资源显式声明为 true。WebView 的 `prefers-color-scheme` 随系统主题变化，网页现有 `mode: system` 与深色 CSS 负责界面配色。WebView 算法式强制变暗保持关闭，避免与网页自身深色配色叠加。

Android CI 使用 Android 14 Google APIs 模拟器切换系统浅色和深色，并对贝贝鹿、鹿1、鹿2、鹿3四个变体逐一执行集成测试。轻量探针 Activity 放在 `src/debug`，只进入 debug APK，不进入 release APK；它使用应用实际的 `AppTheme`，直接核对原生 `isLightTheme`、WebView `prefers-color-scheme` 和算法式二次变暗开关。完整网页的 `mode: system` 从浅→深→浅响应由 Playwright 浏览器回归测试单独验证，避免把整个业务首页的初始化负担混入原生主题信号测试。CI 按系统主题分两轮运行四个变体的 instrumentation tests，避免为每个变体重复启动 Gradle。

## 验证边界

GitHub Actions 负责构建四个 debug APK，并执行 Android 模拟器上的系统浅/深色集成测试；这不等同于在所有厂商真机上完成兼容性验证。CI 产物为 debug APK，不是签名 release APK。
