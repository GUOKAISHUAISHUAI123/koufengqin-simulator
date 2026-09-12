# 给后续 Agent 的上下文（必读）

本文代替已丢失的聊天记录。用户语言：**简体中文**。仓库：https://github.com/GUOKAISHUAISHUAI123/koufengqin-simulator（私有）。

## 这是什么

《三角洲行动》PC **守夜人口琴** 的练习 / 跟谱 / 代按工具。

- 主界面：浏览器也能打开的口风琴模拟（WebAudio）。
- 透明悬浮跟谱：必须走 **Electron**（浏览器做不到无边框透明置顶）。
- 「代按」：按谱向操作系统发送键盘 + 鼠标，人不用自己按。游戏内要先自己掏出口琴。

用户明确：**不要做 ACE 绕过、驱动伪装、硬件 HID、注入游戏**。代按只用系统键鼠模拟。对方开源项目 `xiaominaimoyu/auto_music_player`（MIT）是 Windows `SendInput` 自动演奏器；我们是 **看公开 README/玩法后用 JS 重写**，没有粘贴他们的 Python 源码。对方宣称「隐形水印」盖不到这份 Electron 代码上。

## 三角洲口琴模型（不要改错）

| 音 | 键 |
|---|---|
| 中音 1–7 | `Z X C V B N M` |
| 高音 | 按住 **鼠标右键** + 音键；高音 1 可用 `,` 直达（不再按右键） |
| 低音 | 按住 **鼠标左键** + 音键 |
| 半音 | 按住 **鼠标中键** |
| 八度优先于半音 | 同时要升降八度又要半音时，保八度、丢半音 |
| 不支持和弦 | 谱里和弦取第一个音 |

谱事件：`{ t, d, key, note, mouse }`。`t`/`d` 为秒；`mouse` 为 `[]` / `["left"]` / `["right"]` / `["middle"]`。

代按时序（与对方文档一致，实机可调）：

1. 鼠标修饰 down → 等 **30ms** → 音键 down  
2. 按住约 0.62–0.96 倍时值（开了 humanize）  
3. 音键 up → 等 **20ms** → 鼠标 up  
4. 相邻音同一修饰键则鼠标保持按住，不要 0ms 松开再按下  
5. 开始前 **3 秒倒计时** 切到游戏；**`/` 或 `?`** 暂停/继续；**F9**（或 F8）停止并 panic 松开全部键鼠  
6. 可选「结束按 Q」给 NPC 听旋律提交  

Windows：`SendInput` + **scancode**（`electron/input-driver.cjs`）。Mac：CoreGraphics。游戏以管理员运行时，本工具也要管理员，否则 UIPI 丢掉按键。

腾讯 ACE 可能把规律自动按键判异常。界面要保留风险提示。不要承诺竞技局安全。

## 目录与职责

| 路径 | 作用 |
|---|---|
| `index.html` | 全部 UI：模拟琴、曲库、跟谱 HUD（`?coach=1`）、代按按钮 |
| `electron/main.cjs` | 主窗 + 透明 overlay、IPC、F8、辅助功能检查、代按生命周期 |
| `electron/preload.cjs` | `window.koufengqin` |
| `electron/auto-player.cjs` | 谱 → 绝对时间 down/up 事件并调度 |
| `electron/input-driver.cjs` | Win SendInput / Mac CGEvent |
| `library/default-library.json` | 可导入的默认曲库（导出格式 `{ app, version, library }`） |
| `tools/` | 从音视频/简谱生成 events |

跟谱窗模式：`practice`（按对才滚）、`autoplay`（代按）。已去掉跟弹（有试听）。练习在 overlay **只校验音键**，不要求真按鼠标；练习时 Electron 用全局热键收 Z/X/C/V/B/N/M/,，不必点悬浮窗。可开「练习声音」（主窗发声）。跟谱窗仍用 `event.code` + `before-input-event`（窗有焦点时）。代按只保留 **NPC 自动演奏**（等间隔节奏，结束按 Q）；`/` 或 `?` 暂停/继续，**F9**（或 F8）停止并 panic 松开全部键鼠。热键用 `globalShortcut` + `GetAsyncKeyState` 轮询，避免焦点在其它窗口时失效。代按期间 overlay `setIgnoreMouseEvents(true, { forward: true })`。文案是「自动模拟键鼠弹奏」，不要写「自动往游戏里按」，不要突出游戏。

## 怎么跑

```bash
npm install
# 若 npm 拦住 install scripts：npm install-scripts approve electron && npm install-scripts approve koffi
npm start
```

- Mac 打包：`npm run pack:mac` → `dist/mac` 或 `dist/mac-arm64`。`.npmrc` 里有 electron 镜像。
- **Windows 打 exe**：`npm run pack:win` → `dist/口琴模拟器.exe`（portable，双击就能用，首次会 UAC 提权）。GitHub 超时就靠 `.npmrc` 里的 `electron_builder_binaries_mirror`。`npm run pack:win:dir` 出 `dist/win-unpacked`。`koffi` 必须进 asarUnpack。`library/**` 打进包，空 localStorage 也会从 `library/imported-songs.js` 带出曲库。
- 目标窗口以管理员运行时，exe 也要右键「以管理员身份运行」，否则 UIPI 丢掉按键。打包默认 `asInvoker`，保证双击能打开；管理员账号下还需关掉 GPU 沙箱，否则窗口起不来。

曲库默认来自 `library/imported-songs.js`（打包后复制到 `userData` 可写）。`library/default-library.json` 仍可手动导入。用户在本机后来导入/分析的曲 **没有** 进 git，除非再导出。

## 当前进度与已知坑

已完成：模拟器、曲库、Mac Electron 透明跟谱、练习/代按（Mac CGEvent 路径 + Win SendInput 代码）、默认曲库 JSON 上传 GitHub。

未完成 / 未验证：

1. **Windows 实机代按**（`koffi` 的 `INPUT` 结构体对齐 40 字节问题可能导致 SendInput 静默失败，要用记事本或游戏试 Z）。  
2. **Windows 实机双击 `dist/口琴模拟器.exe`** 验证曲库、练习热键、代按 `/` 与 F9。  
3. 本机 `git push` 曾因 Git 智能 HTTP 超时失败，代码是用 GitHub **Contents/Git Data API** 推上去的；换网络后普通 `git push` 可能又可用。远程 SHA 与本地 commit 不一定相同，内容以 GitHub `main` 为准。  
4. GitHub 登录用过精细化 PAT；新仓库要加入 token 的仓库名单才有写权限。  
5. 不要把 token 写进 git。

## 用户下一步（Windows Cursor）

优先顺序建议：

1. clone 私有仓库 → `npm install` → `npm start`  
2. 导入 `library/default-library.json`  
3. 记事本前台测「代按」是否打出 z/x/c 和鼠标键  
4. 三角洲里掏口琴、非竞技处短谱试吹；失败再调 `SETTLE_MS` / `RELEASE_MS`  
5. 通了再加 `pack:win` 出 exe；游戏管理员运行则 exe 也管理员运行  

改 UI 后尽量在 Electron 里点一遍，不要只截一张图。
