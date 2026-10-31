# 双人空间 Android 壳工程

该工程只负责把仓库根目录当前网页应用封装进 Android WebView，不替换网页业务结构。

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

## 验证边界

此工程目前提供可由 GitHub Actions 构建的 debug APK 工程；本工作环境没有 Android SDK、模拟器或真机，未在本机执行 APK 构建、文件选择器真机验证、重启持久化或卸载重装恢复测试。CI workflow 产物为 debug APK，不是签名 release APK。
