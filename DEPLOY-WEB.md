# TwoDeers 网页部署包

此项目的内置表情包共有 **352 张**。网页运行时会读取：

`assets/builtin-stickers/manifest.json`

不能只部署原始源码和 `sticker-source/*.zip`；浏览器不会自动解压源 ZIP。

## 生成可直接部署的网页目录

在项目根目录安装 Python 3、Pillow 和 pillow-heif 后运行：

```bash
python3 -m pip install Pillow pillow-heif
```


```bash
python3 tools/build-web-site.py --output-dir dist
```

也可以运行：

```bash
npm run build:web
```

构建脚本会：
1. 复制网页入口、运行时 JS/CSS/JSON 和原有 assets；
2. 从两个源 ZIP 提取 352 张图片；
3. 将 18 张 HEIF 转成 JPEG；
4. 使用原生 HEIF 解码读取完整显示区域和方向信息，保持原图宽高比例；
5. 为每张图片写入源尺寸、输出尺寸和帧数元数据；
6. 检查清单中的 352 个资源全部存在、可解码、尺寸匹配；
7. 对 GIF 检查动画帧数，防止构建时静默丢帧。

## 部署

将 `dist/` 目录中的**全部内容**上传到静态网站托管服务的站点根目录（不要只上传 index.html，也不要只上传源码 ZIP）。

若使用 GitHub Actions，分支 `feature/builtin-sticker-library` 的 Web deploy workflow 会自动生成名为 `twodeers-web-deploy-352-stickers` 的部署 ZIP artifact。

## 资源数量

- JPEG：199
- GIF：131
- PNG：4
- HEIF：18（使用 pillow-heif 原生解码，构建后转成 JPEG）
- 合计：352

`wmqt (6).gif` 已按确认排除。
