# TwoDeers 源码说明

这是 TwoDeers 网页应用与 Android WebView 壳工程的完整源码包。当前交付包含网页运行模块、主题资源、自动化测试、源码检查工具和 Android 工程。

## 目录结构

```text
.
├── index.html                 # 网页主入口
├── *.js                       # 页面运行时模块，由 index.html 直接加载
├── assets/                    # 内置主题等静态资源
├── tests/                     # Node 自动化测试与浏览器 smoke 测试（.mjs）
├── tools/                     # 源码结构与集成检查工具（.mjs）
├── android-apps/               # Android WebView 壳工程；构建说明见其 README.md
├── docs/
│   ├── maintenance/            # 当前仍适用的专项维护记录
│   └── history/                # 过往升级、返修和阶段性交付报告
├── package.json
└── package-lock.json
```

## 关于 JavaScript 文件

根目录中的 `.js` 文件是网页运行时模块，不是临时脚本。`index.html` 通过相对路径直接加载它们，测试和源码检查也按这些路径读取。因此这些模块有意保留在根目录；移动它们必须同时修改 HTML 引用、测试读取路径及相关构建配置。本次文件整理没有移动或改写任何运行时 `.js` 文件。

`.mjs` 文件已经按用途放在 `tests/` 和 `tools/`：前者用于回归测试和浏览器验收，后者用于源码结构检查。它们不在普通页面启动时执行，但建议在继续开发时保留。

## 常用检查命令

```bash
npm test          # 运行 Node 自动化测试
npm run verify    # 检查模块接入、源码结构及关键功能标记
npm run test:browser  # 运行 Playwright 浏览器 smoke 测试（需要安装依赖和可用浏览器）
```

## 当前交付说明（2026-11-06）

- 本次整理只调整 Markdown 文档的目录和文件名，没有改动业务代码、JavaScript 模块、测试代码或资源文件。
- 表情包删除保护的专项修复说明：[`docs/maintenance/2026-11-06-sticker-delete-guard.md`](docs/maintenance/2026-11-06-sticker-delete-guard.md)。
- 旧版升级、返修与审计记录统一归档在 [`docs/history/`](docs/history/README.md)，这些文件是阶段性历史记录，不应替代当前源码与测试结果。
- 本次整理后重新执行：`npm test` 为 **90/90 通过**，`npm run verify` 通过。
- 浏览器 smoke / Android 真机验证不因这次文档整理而改变状态；请勿把 Node 测试结果理解为全平台验收通过。

## 重要说明

本项目源码包不是 APK，也不代表已经部署。修改远程仓库、合并分支、部署网页或构建 Android 安装包，需要另行执行对应流程。
