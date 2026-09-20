# PolyAsk · AI 众答

同一个问题，一次发给九个 AI，回答并排摆在一个窗口里看。

PolyAsk 是个桌面应用。它把 Claude、ChatGPT、Gemini、DeepSeek、豆包、千问、Kimi、元宝、智谱清言这九个网站原样装进一个窗口，你在顶部输入一次，各家各自作答，你横向比。用的是各站自己的网页和你自己的账号，不经过任何中转服务器，也不用申请 API key。

## 它能做什么

发一次，九处答。勾上要问的站点，选「深度思考」还是「快速」，回车。每家在自己的格子里作答，勾 1 个铺满，勾 4 个四宫格，再多就翻页，换页不会打断正在生成的回答。想盯着某一家看，切到聚焦模式，主站放大，其余的缩在右边继续跑。

档位一键统一。九个网站的模型菜单长得各不一样，PolyAsk 替你逐站去点。`Alt+T` 全体切到深度思考，`Alt+Y` 全体切回快速，发送前会先把档位摆好再提交。

带图提问。最多 4 张 PNG 或 JPEG，总共不超过 10 MiB，一次发给收图的 6 家：Claude、ChatGPT、DeepSeek、豆包、Kimi、元宝。Gemini、千问、智谱清言收不了图，发送前会提醒你把它们勾掉，不会悄悄漏发。

把回答留下来。一键把各家的回答汇成一份 Markdown，复制走，或者存进结果库。结果库能搜、能收藏、能打标签写备注、能标出哪家答得最好，两份回答还可以逐段对照着看。

让 AI 帮你综合。从一条结果里挑几家的回答，交给其中一家在新会话里综合成一份，综合结果也存回那条记录。

多台电脑同步。连上 Google Drive 之后，站点选择、分组、提问历史、提示词模板和结果库会在你的设备之间合并。PolyAsk 只用 Drive 里自己的隐藏目录，碰不到你的其他文件。

## 「深度思考」和「快速」各对应什么

| 站点 | 深度思考 | 快速 |
|---|---|---|
| Claude | Fable 5.1，思考强度最高档（现在是 Max） | Sonnet 5，默认强度 |
| ChatGPT | GPT-5.6 Sol，思考强度最高档 | GPT-5.6 Sol，最低档 |
| Gemini | 最新的 Pro，扩展思考 | 最新的 Flash |
| DeepSeek | 深度思考开 | 深度思考关 |
| 豆包 | 专家 | 快速 |
| 千问 | Qwen3.7-千问，思考研究 | Qwen3.8-Max，快速 |
| Kimi | K3，极致 | K3，标准 |
| 元宝 | Hy4 preview（站点只给专家模式） | Hy3，即时 |
| 智谱清言 | 极致，没有这档就用深度 | 快速 |

「最高档」「最新的 Pro」这类说法是按网站当时在场的选项现取的，网站加减档位时会自动跟着走，括号里只是眼下的实际值。

网站改版是这类工具的头号故障源。哪家切档突然不灵了，按 `Alt+H` 打开站点状态，可以重新检查、重载、清缓存，还能复制一份诊断报告贴到 [issue](https://github.com/pine2D/polyask/issues/new/choose) 里。报告里只有版本、系统、显示缩放和各站的检查结果，没有对话内容，也没有网址。

## 安装

到 [Releases](https://github.com/pine2D/polyask/releases) 下载对应系统的文件：

| 系统 | 文件 | 怎么装 |
| --- | --- | --- |
| Windows x64 | `polyask-desktop-vX.Y.Z-windows-x64.exe` | 运行安装程序 |
| Windows x64 便携版 | `polyask-desktop-vX.Y.Z-windows-x64-portable.zip` | 完整解压，运行 `PolyAsk Portable/App/polyask-desktop.exe` |
| Ubuntu / Debian x64 | `polyask-desktop-vX.Y.Z-linux-x64.deb` | `sudo apt install ./polyask-desktop-vX.Y.Z-linux-x64.deb` |
| macOS Apple Silicon | `polyask-desktop-vX.Y.Z-macos-arm64.zip` | 解压，打开 `PolyAsk.app` |
| macOS Intel | `polyask-desktop-vX.Y.Z-macos-x64.zip` | 解压，打开 `PolyAsk.app` |

这五个包都没有签名，第一次启动会被系统拦一下。Windows 在 SmartScreen 里点「更多信息」再点「仍要运行」。macOS 先把 `PolyAsk.app` 拖进「应用程序」，被拦后到「系统设置 → 隐私与安全性」页面底部点「仍要打开」；macOS 15 之后右键「打开」那条老路已经不管用了。

没有自动更新。设置页的「检查更新」会带你去最新的 Release 页，下载新包覆盖装即可。每个包旁边都有同名的 `.sha256`，不放心可以核对一下。

Windows 便携版把程序和数据分开放：`App` 是程序，`PolyAsk Data` 是设置、登录状态和本机数据。升级时退出 PolyAsk，用新包里的整个 `App` 目录替换旧的，`PolyAsk Data` 留着别动，登录状态就都还在。

## 登录与隐私

- 九个网站要在 PolyAsk 里各登录一次。登录状态存在本机，PolyAsk 不去读浏览器里的 Cookie。
- PolyAsk 不伪装浏览器、不关网页的安全机制，只以你登录的身份操作网页。每个站点在受限的视图里运行，只能访问该站和它的登录页，外部链接交给系统浏览器打开。
- 图片只收 PNG 和 JPEG，一次最多 4 张、总共 10 MiB，图片只发给你勾选的站点，不上传到别处。
- Google Drive 同步的数据是明文，没有端到端加密。PolyAsk 只申请 Drive 应用专属目录的权限，读不到你的其他文件。断开连接不删任何数据，设置页的「重置全部本机数据」只清本机，云端照旧。
- 没发出去的草稿只留在本机。系统通知默认关着，开了也不会带问题或回答的正文。

## 快捷键

初次使用可以从顶部「更多 → 开始使用」打开四步指南，也可以按 `F1` 搜索「开始使用」。指南按需打开，不改变站点选择，也不会自动发送问题；关闭后草稿仍在。

| 键 | 功能 |
|---|---|
| `Alt+T` | 全体切到深度思考 |
| `Alt+Y` | 全体切到快速 |
| `Alt+Q` | 聚焦提问框 |
| `Alt+K` 或 `F1` | 命令面板，能搜命令、站点分组、提示词模板和最近的提问 |
| `Alt+S` | 站点与分组 |
| `Alt+H` | 站点状态 |
| `Alt+1` / `Alt+2` / `Alt+3` | 跳到第几页 |
| `Ctrl+PageDown` / `Ctrl+PageUp` | 聚焦下一个 / 上一个站点 |
| `Ctrl+Shift+PageDown` / `Ctrl+Shift+PageUp` | 下一组 / 上一组站点 |
| `Alt+←` / `Alt+→` | 站内后退 / 前进 |
| `Alt+C` | 收集回答 |
| `Alt+N` | 给勾选的站点开新会话 |
| `Alt+R` | 重试失败的站点 |
| `Ctrl+,` | 设置 |

macOS 上把 `Ctrl` 换成 `Cmd`。焦点在网页里时这些键照样有效。

## 你该知道的限制

- 包没签名、没公证，也不会自动更新。
- 网站一改版，对应站点的切档或发送就可能失灵。碰到了先复制诊断报告报障，别自己反复重发。
- 发送后网站没回话、不确定发没发出去时，PolyAsk 会交给你手动重试，不会替你再发一遍。只有 Kimi 会先只读核实一下页面上是不是已经有这条消息。

## 曾经的 Chrome 扩展

PolyAsk 以前也有 Chrome 扩展，最后一版是 v0.25.1，从 1.0.0 起停止维护并从仓库删除，代码留在 tag `archive/extension-v0.25.1`。扩展写进 Google Drive 的数据和桌面版是同一格式，连同一个账号就能接着用。

## 给开发者

源码在 `desktop/` 目录，`npm install` 之后 `npm test` 跑门禁、`npm start` 起开发态。进程边界、各站适配规则和真机验证方法分别在 `docs/desktop.md`、`docs/adapters.md`、`docs/verify.md`。

## License

MIT，见 [LICENSE](LICENSE)。
