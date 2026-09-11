# 口风琴模拟

这是一个可直接在浏览器打开的单文件口风琴模拟器。

## 主文件

- `index.html`：浏览器应用本体，包含弹奏、曲库、重命名、导入、根据音乐添加曲库等功能。
- `tools/generate_song.py`：从视频或音频生成弹奏脚本。
- `tools/example-score.txt`：简谱对齐示例，`.1` 表示高音 1，也就是模拟器里的鼠标右键升调。
- `tools/requirements.txt`：分析脚本依赖。

## 交给其他 agent

把整个文件夹交给它：

`koufengqin-simulator/`

这个文件夹已经包含前端页面和生成脚本。若要复现或继续改造“通过视频、音频匹配并生成弹奏脚本”的能力，不要只给 `index.html`。

## 运行页面

浏览器直接打开：

`index.html`

Mac 桌面应用（透明跟谱窗需要走这条，浏览器做不到无边框透明置顶）：

```bash
cd koufengqin-simulator
npm install
npm start
```

主窗口是模拟器。点「悬浮跟谱」会再开一个无边框、透明、始终置顶的跟谱窗，可拖到游戏画面上方。打包成 `.app`：

```bash
npm run pack:mac
```

产物在 `dist/mac` 或 `dist/mac-arm64`。

默认曲库在 `library/default-library.json`（三角洲片段、歌唱祖国按图版、金玉良缘按图版、歌唱祖国自动识别版）。换电脑后应用会带上 `index.html` 里的三首内置曲；若要一次导入全部四首，在曲库面板点「导入曲库」选这个 JSON。

曲库运行时还存在浏览器 `localStorage` 里。曲库卡片支持选中、播放、重命名、复制谱、删除。

不同浏览器的 `localStorage` 互相隔离，所以在一个浏览器里重命名或新增曲目，不会自动同步到另一个浏览器。跨浏览器迁移时，在曲库面板点击“导出曲库”，到另一个浏览器里点击“导入曲库”选择导出的 JSON 文件。

播放时，谱子预览会高亮当前正在播放的事件行，并自动滚动到当前行。

编辑已有曲目时，在曲库卡片点“编辑谱”。页面会把曲名和事件 JSON 填到“编辑/导入按键谱”区域。修改后点“保存覆盖”会替换原曲；点“另存为新曲目”会保留原曲并新增一首。

也可以直接在谱子预览里编辑。点时间、音符、按键、调式或时长单元格即可输入，按回车或点到别处会保存到当前曲目。调式可填 `原调`、`left`、`right`、`middle`，也支持 `right+middle` 这类组合。

## 从视频/音频自动生成谱

先准备 Python 环境：

```bash
cd koufengqin-simulator
python3 -m venv .venv
.venv/bin/pip install -r tools/requirements.txt
```

纯自动识别：

```bash
.venv/bin/python tools/generate_song.py /path/to/music.mov -o song-events.json --title "新曲目"
```

如果有图片简谱或手写简谱，推荐用“简谱定音 + 视频调节奏”：

```bash
.venv/bin/python tools/generate_song.py /path/to/music.mov --score tools/example-score.txt -o song-events.json --title "三角洲片段"
```

生成的 `song-events.json` 里有 `events` 数组。可以在页面的“导入按键谱”里粘贴这个数组，或者让 agent 把它写进 `index.html` 的默认曲库。

## 按键约定

- `z x c v b n m ,` 对应 `1 2 3 4 5 6 7 i`
- `mouse: ["right"]` 表示高音，等同鼠标右键升调
- `mouse: ["left"]` 表示低音
- `mouse: ["middle"]` 表示半音
