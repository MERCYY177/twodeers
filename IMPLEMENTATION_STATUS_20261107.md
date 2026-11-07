# 双人空间最终修复交付说明（2026-11-07）

## 本轮基线

基于用户上传的 `twodeers-final-modified-20261107.zip` 修改。未连接或修改远程仓库，未部署，未创建 Git 提交。未删除任何聊天、信箱、朋友圈、字卡、字体或媒体数据文件。

## 已实施的修复

### 1. 手动备份策略

- Android Manifest 设置 `android:allowBackup="false"`。
- 保留 `backup_rules.xml` 与 `data_extraction_rules.xml`，分别排除旧版系统备份、新版云备份及设备间迁移的数据目录。
- 应用的 `localStorage` / IndexedDB 本地持久化保持不变。
- V4 ZIP 仍由用户主动点击备份后生成；Android SAF 保存窗口仅在该操作后启动。未增加定时备份、后台 ZIP 生成或云端上传。
- 修正 Android SAF 保存窗口可能被重复启动的问题，增加保存选择器互斥状态，并保留分块写入及写入字节数核验。

### 2. 导入安全与渲染

- 在 `index.html` 中加入媒体 URL 白名单校验，允许项目现有的 HTTP(S)、同源相对地址、同源 Blob URL，以及受限的图片/音频/视频 Base64 Data URL；拒绝脚本协议、HTML/SVG Data URL、含引号/反斜杠/控制字符的 URL、跨源协议相对地址和相对路径穿越。
- 修复聊天消息时间、文本、媒体地址、头像地址等动态 HTML 插入位置；动态属性经过 HTML 属性转义，动态 URL 经过安全校验，系统消息使用 `textContent`。
- 修复朋友圈媒体、点赞头像、评论 ID、动态 ID、通知缩略图等相关渲染入口，避免不可信字段突破 HTML/CSS 属性上下文。
- 扩展旧版 JSON 与 V4 备份导入前检查：结构深度、数组数量、文本长度、媒体协议、Data URL 类型、资源路径及危险原型字段。
- 邮箱草稿图片预览 URL 在进入 HTML 属性前进行属性转义；内置表情预览 URL 限定在项目内置表情目录，防止任意路径注入。

### 3. V4 ZIP 清单完整性与容量保护

- manifest 资源路径必须唯一；ZIP 实际资源集合必须与 manifest 声明集合完全一致，不允许重复项、漏项或未声明文件。
- 检查 ZIP 本地文件头与中央目录一致性、条目不重叠、目录边界、磁盘编号、压缩方式、文件名和路径安全。
- SHA-256、CRC32、文件字节数均对每个资源复核。
- 限制 ZIP 总大小 1 GiB、单个 JSON 成员 128 MiB、manifest 16 MiB、中央目录 64 MiB；导出端同样检查最终 ZIP 大小，避免导出无法再次导入的超限备份。
- 旧版 JSON 在读取前限制为 128 MiB；V4 ZIP 在读取前限制为 1 GiB。

### 4. Android 工程

- Gradle 构建不再依赖缺失的原始表情 ZIP 和 Python 预处理脚本，改为校验项目中 352 项成品清单及其资源文件，再暂存网页资源。
- 增加 Android 13+ `OnBackInvokedCallback`，保留旧版 `onBackPressed` 兼容入口；优先调用网页 `window.__duoHandleSystemBack()`，设置子页面可先返回参数区。
- 移除 Android SAF 保存流程中重复启动文件保存选择器的问题。

### 5. 通知刷新

- 移除每 700ms 无条件重建通知按钮的定时器。
- 移除每 1200ms 全量扫描朋友圈动态来同步通知的轮询；改为相关数据操作、通知变化事件和页面可见性变化触发同步。保留真正用于自动动态/回复调度的独立定时任务。

## 本轮验证

`node tools/verify-twodeers-hardening.mjs` 通过，覆盖：

- 352 项内置表情资源存在性、文件字节数核对。
- Android 禁止自动备份、云端备份与设备迁移排除规则。
- Gradle 构建输入不再依赖不存在的源 ZIP/Python 脚本。
- Android 13+ 和旧版返回键代码路径、SAF 保存选择器单次启动。
- 旧版 JSON 与 V4 数据校验、危险协议拒绝、文本/属性转义。
- V4 正常 ZIP 可解析；未声明资源、重复 manifest 路径、资源路径不匹配、非零磁盘编号会被拒绝。
- JSON 128 MiB 读取上限。
- 根目录 11 个 JavaScript 文件语法、2 段可执行内联脚本语法。
- Android Manifest 与备份 XML 解析。

额外检查：

- HTML 解析后的 295 个静态 DOM ID 全部唯一（模板字符串中的多个运行时模板 ID 不作为静态 DOM 重复）。
- 5 段内嵌 CSS 解析无错误。
- HTML 中可识别的本地 `src` / `href` 资源引用没有缺失。
- 352 项表情图片全部解码成功，共 5,301 帧。
- ZIP 原始文件清单与工作目录比较：本轮仅修改 Android MainActivity、Android Manifest、Gradle、index、backup-v4、mailbox-manager、sticker-library、sticker-admin 和本验收脚本/说明文件相关内容；没有删减资源文件。

## 尚未完成、不能冒称通过的事项

1. **Android APK 实际构建**：当前交付包没有 Gradle Wrapper，当前执行环境没有 Gradle 安装和 Android SDK，因此未执行 `assembleDebug` / `assembleRelease`。Gradle 逻辑仅完成静态核对。
2. **真实 Android 真机测试**：尚未在设备上验证系统备份/迁移行为、SAF 实际保存、系统返回手势、WebView 长时间运行及重启恢复。
3. **完整浏览器 E2E**：当前环境的 Chromium 运行受系统策略限制，未能完成真实浏览器页面交互与移动端视觉验收。本轮的 Node 测试是逻辑/解析测试，不代表手机实测。
4. **6 个主题外部图片本地化**：原图 URL 当前无法可靠读取，未用不对应的图片替换，原主题 URL 和外观保持不变；这些装饰仍可能需要网络。
5. **聊天/朋友圈历史分页和 IndexedDB 迁移**：本轮未进行存储结构迁移，避免高风险操作损伤旧数据。大量历史数据仍可能增加整体状态加载、保存和渲染耗时，适合作为单独阶段实施。

## 保留的用户界面与数据约束

- 未改动聊天页、信箱、已读样式、表情面板、参数区二级页面的既有布局和交互要求。
- 未删除 11 个实际使用中的根目录 JS 模块。
- 未清理用户数据或替换主题视觉素材。
- 自动本地保存照常运行；Android 系统自动备份和设备迁移关闭；只有用户主动操作才生成 V4 手动备份。
