# PolyAsk 项目级 Impeccable

技能安装在 `.agents/skills/impeccable/`，仅作用于本项目；没有全局安装，也不是 Desktop 的构建或运行依赖。
固定来源见本目录的 `installation.json`。技能载荷和平台引擎均为可重建的本地工具产物，不入库，不纳入应用源码的行数门禁。

## 恢复安装

使用 Codex 自带的 `skill-installer`，将 `installation.json` 指定 revision 下的 source 安装到仓库 `.agents/skills/`，不要使用默认全局目标。
也可把该 revision 的 `.agents/skills/impeccable/` 原样复制到本项目相同位置，并保留上游 `LICENSE` 和 `NOTICE.md`。
目标已有安装时先核对版本，不覆盖其他技能。

技能会在后续会话中被发现；当前会话可直接读取它的 `SKILL.md` 与相关 reference。

从仓库根目录执行引擎时使用项目内缓存：

```bash
IMPECCABLE_HOME="$PWD/.impeccable/cache" sh .agents/skills/impeccable/scripts/impeccable context --target desktop/src/renderer
IMPECCABLE_HOME="$PWD/.impeccable/cache" sh .agents/skills/impeccable/scripts/impeccable detect --json desktop/src/renderer
```

首次运行会下载 VERSION 指定的引擎，需要联网。以上缓存位置不要求修改 shell 或系统配置。
本项目使用手动 detector 检查，未安装自动编辑 hooks。检测器返回 2 表示发现问题，1 表示扫描失败，0 表示没有主要发现。

## 设计使用边界

- 桌面工作台按 Operate 模式，回答阅读按 Read 模式处理；遵守 `CLAUDE.md` 与 `docs/desktop.md` 的产品约束。
- 保留靛蓝品牌、系统字体、三语、键盘操作、两档密度与读屏反馈。
- 站点网页是独立原生视图，外壳 CSS 不得冒充站点布局或改变发送契约。
- 结合实际截图审查 detector 结果；不能把网页模板规则机械套到桌面工具上。
- 一次性审查、设计方案和截图放在 Git 忽略的 `docs/` 或 `/tmp/`；已实施规范写回公开契约。
