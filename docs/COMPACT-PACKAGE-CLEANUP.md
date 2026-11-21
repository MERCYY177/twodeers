# 精简包清理记录

本文件记录 `twodeers-phase37-compact.zip` 相对 Phase 37 完整修复包的清理范围。

## 已删除

- `PHASE2-CHANGELOG.md` 至 `PHASE25-CHANGELOG.md`：旧阶段记录不参与运行；当前测试与工作流未引用这批文件。保留 Phase 26–37 记录，避免破坏现有验收矩阵和 CI 路径契约。
- `test-results/`：历史 Chromium 启动尝试和旧运行结果，不是测试输入或运行资源；测试执行时会自行创建结果目录。当前验收状态保留在 `PHASE37-VALIDATION.md`。
- `android-apps/index.html`：README 的静态 HTML 渲染副本；Android Gradle 构建明确从仓库根目录暂存真实 `index.html`，不会使用此文件。
- `assets/css/style.css`：只被上述 Android 子目录静态 HTML 引用；主应用使用 `index.html` 内嵌样式，APK staging 不需要该文件。
- `assets/builtin-theme/theme-864cd155a6b5d78b.svg`：经主页面和全部主题预设文本检索，没有任何引用。
- `.github/workflows/package-source.yml`：只在已过期的单一历史分支上、且仅修改自身 workflow 时触发的一次性打包流程，不属于当前构建/验证流程。
- `.github/workflows/sticker-source-inventory.yml`：手动工作流依赖仓库中的 `sticker-source/*.zip`，但本项目没有 `sticker-source/` 目录或源 ZIP，执行会在枚举输入目录时失败。已生成的 352 项离线清单和图片资源继续保留。

## 明确保留

- `index.html` 直接加载的全部 19 个根目录 JavaScript 模块。
- 352 项内置表情清单及全部 352 个被引用的资源。路径百分号解码后与磁盘文件逐一匹配，缺失 0、孤儿 0。
- 10 个仍被聊天气泡预设引用的主题装饰图片。
- Android Gradle、Manifest、Java 桥接、资源 XML 和 README。
- 全部当前测试、测试夹具、静态验证工具、有效 GitHub Actions 工作流和当前验收文档。
- Phase 26–37 变更记录以及 Phase 37 验证报告；这些文件仍被测试或工作流路径契约引用，故未删除。

## 影响与限制

清理不改动任何业务源码、存储格式、媒体文件内容、备份数据结构、Android 权限代码或主题预设。它主要减少历史记录和开发环境遗留文件。压缩包仍然较大，是因为 352 项内置表情主要为已经压缩过的 GIF/JPEG，约占全部源码包体积的绝大部分；删除它们会减少应用内置表情功能，不属于安全清理。
