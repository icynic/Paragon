# Paragon

用视频学语言的浏览器小工具。选择本地视频文件（`.mkv` / `.mp4` / `.webm`），挑选音轨和上下两条字幕，就可以边看边学。

所有视频处理都在浏览器本地完成（基于 [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm)），视频不会上传到任何服务器。

## 功能

- 从视频中提取音轨和内嵌的文本字幕（如 SRT、ASS，ASS 会保留原样式和位置）
- 双语字幕：上方显示学习语言，下方显示母语
- 悬停单词查看翻译，点击查看释义
- 上一句 / 下一句字幕跳转、播放速度调节、字幕大小调节
- 界面支持中文和英文

## 本地运行

需要 Node.js 18 或更高版本。

```bash
npm install
npm run dev
```

然后在浏览器打开终端里显示的地址（默认是 `http://localhost:5173/paragon/`）。

## 其他命令

```bash
npm run build           # 构建到 dist/
npm run preview         # 预览构建结果
npm run test:subtitles  # 运行字幕相关的单元测试
```

## 说明

- ffmpeg.wasm 需要 `SharedArrayBuffer`，所以页面必须是跨源隔离的（COOP/COEP 响应头）。开发服务器已在 `vite.config.js` 中配置好；部署时托管平台也需要发送这两个响应头。
- ffmpeg 核心文件运行时从 unpkg.com 加载。
- 翻译使用 [MyMemory](https://mymemory.translated.net/) API，单词释义来自 [Wiktionary](https://en.wiktionary.org/)，查词时会把所选文本发送给这些服务。
- `vite.config.js` 中的 `base` 设为 `/paragon/`，如果部署路径不同需要修改。
