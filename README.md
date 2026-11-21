# 双人空间（TwoDeers）

双人空间是一个以浏览器本地存储为基础的双人聊天与生活记录应用，同时提供 Android WebView 壳工程。

## 运行网页

直接通过静态 HTTPS 网站托管根目录 `index.html`。不要只复制 HTML 文件：运行时还需要同目录的 JavaScript 模块和 `assets/` 离线资源。

## 本地回归

需要 Node.js 22 或兼容版本。在项目根目录执行：

```bash
node tools/verify-twodeers-hardening.mjs
```

专项测试位于 `tests/`，可单独执行，例如：

```bash
node tests/phase37-audit-fixes.test.mjs
```

本项目没有 npm 依赖清单，不需要 `npm install`。

## Android 构建

Android 壳工程位于 `android-apps/`。需要 JDK 17、Android SDK Platform 35、Build Tools 35.x 和 Gradle 8.9：

```bash
cd android-apps
gradle :app:assembleDebug
```

当前源码包不包含 Gradle Wrapper。APK 构建会从项目根目录暂存 `index.html`、全部根目录 JavaScript 和 `assets/**`；请勿删除未被 GitHub Pages 路径直接引用的离线资源。

## 目录说明

- `index.html`：主应用入口。
- 根目录 `*.js`：主页面加载的业务模块。
- `assets/builtin-stickers/`：352 项离线内置表情及其清单。
- `assets/builtin-theme/`：聊天气泡美化所需装饰资源。
- `android-apps/`：Android WebView 工程。
- `tests/`、`tools/`：自动化回归和静态硬化检查。
- `.github/workflows/`：持续集成和构建工作流。
- `docs/`：浏览器验收矩阵及测试覆盖说明。
- `PHASE26` 至 `PHASE37` 变更记录：保留当前仍被测试/CI 引用的阶段历史，以及最新修复记录。

## 精简说明

本包清理了历史阶段冗余记录、旧浏览器尝试输出、未被引用的主题资源、重复的 Android 子目录 README 网页，以及无法在当前仓库输入条件下运行的旧工作流。应用使用的内置表情、主题图片、运行时模块、Android 构建源文件、测试和有效 CI 工作流均保留。
