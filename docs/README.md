# 文档索引与维护规则

核对日期：2026-11-25。当前源码版本 1.37.2。发布状态以 `CHANGELOG.md` 的版本段为准。

## 当前契约

| 文件 | 用途 |
| --- | --- |
| `docs/acceptance.md` | 当前能力验收索引：九站六类能力、版本/日期/环境证据和跨平台、Drive、安装补验条件 |
| `docs/desktop.md` | 进程、IPC、布局、数据与草稿同步、schema 1–7 和备份 v1–6 兼容、代理、原生能力、任务准备及安全报告导出 |
| `docs/adapters.md` | 九站适配器协议、档位、图片与改版排查 |
| `docs/verify.md` | 现行验证手册：界面与交互验收三关、自动化门禁、真机只读巡检及待闭合事项 |
| `docs/verify-history.md` | 历次按日验证、站点复验与 TestLab 实测归档 |
| `docs/release.md` | 版本晋升、五包发布、三语文案、签名与升级条件 |
| `docs/desktop-oauth-security.md` | OAuth 配置、凭据卫生及历史处置记录 |
| `.agents/skills/polyask-electron/SKILL.md` | 项目 Electron 开发技能：升级、原生生命周期验证与性能分析入口 |

这些文件随源码维护；项目硬约束以 `CLAUDE.md` 为准。先从[当前能力验收表](acceptance.md)查证据范围，再到验证说明执行对应入口。文档核对不等于已完成远端配置、真实账号、原生系统或发布验收。

本版提问框滚动、深色字段和高倍缩放底栏的实测见[1.37.2 界面验收](acceptance.md#2026-11-24-提问框和底栏验收)。Gemini Chat/Task 切档与三语界面文案的验收范围见[1.37.1 切档与文案验收](acceptance.md#2026-11-22-gemini-切档与三语文案验收)。此前的主题切换、七款内置主题与阅读布局实测见[1.37.0 主题验收](acceptance.md#2026-11-21-七款内置主题验收)；Platinum 工作台界面改版、跨视图菜单/同帧运动与接手简化验收见[1.36.0 界面与简化验收](acceptance.md#2026-11-19-platinum-工作台界面改版与代码简化验收)；网页切档、设置菜单与恢复范围见[1.35.1 切档验收](acceptance.md#2026-11-18-网页模型切档维护验收)；隔离试玩版和自动保护快照的验收记录见[1.35.0 验收](acceptance.md#2026-11-15-维护体系试玩隔离与自动保护快照验收)。

README 的项目介绍图保存在 `assets/polyask-overview.png`，用途、文字与生成提示词见 [素材说明](../assets/README.md)。图片为功能示意，涉及的能力与站点名单变化时应同步更新。

## 新维护者可以跟读的三条路径

| 从一个具体问题入手 | 按调用顺序阅读 | 用什么验证判断 |
| --- | --- | --- |
| 两个页面都开着，为何只能采集一个？ | `renderer/index.tsx` 从工作区的 `selectedSites` 取得打开的页面，从 `participatingSites` 取得参与范围。手动采集读取参与站，比较只把其中已完成的站交给 `use-archive-capture.ts`，至少需要两站。 | `test/prompt-draft-confirmation-root.test.tsx` 用工具栏与命令分别采集 |
| 某站提交不确定，重试前会发生什么？ | `main/shell-ipc.ts` 校验并持锁，`run-broadcast.ts` 准备轮次，`question-capture-service.ts` 先采集旧轮并剔除已确认提交的站点，再由 `broadcast.ts` 派发。 | `test/broadcast-result-dispatch.test.ts`、`test/submission-upgrade.test.ts` |
| 同一问题发两次，保存了几条记录？ | `main/recent-prompt-service.ts` 按文本去重；`question-history-service.ts` 按轮次、站点和尝试留副本；手动采集另存 `archive`。浏览器前进、后退状态在 `site-navigation-controller.ts`。 | `test/recent-prompt-service.test.ts`、`test/question-capture-service.test.ts` 与上方桌面文档的 Drive 实体表 |

上表中的源码位于 `desktop/src/`，测试路径以 `desktop/` 为起点。

## 本地设计记录

产品调研、设计与实施计划、布局预览及资源采样仅保留在本机，受 `.gitignore` 忽略，不随仓库分发。它们用于本地追溯，不作为公开文档的必需依赖。已落实的行为、数据与兼容规则必须同步维护到上面的当前契约；真实环境验收缺口维护在验证文档中。

`docs/audit-2026-07.md` 是旧扩展 v0.6.1 的历史审计，因发布说明引用而保留，不作为当前 Desktop 的待办清单。同步与备份冻结样本的维护规则见 `desktop/test/fixtures/README.md`。

## 入库与维护

- `docs/` 默认忽略，仅 `.gitignore` 精确白名单中的正式文件入库。本地历史草稿、工具生成的计划和素材继续忽略，不批量加入仓库。
- `.gitignore` 只影响未跟踪文件；增加 `/docs/` 不会让已有文档退出版本管理。取消跟踪会使后续克隆缺少开发契约及引用文件，需要另行明确决定，不能当作常规忽略规则整理。
- 新增需公开的契约文档时，同时补白名单及本索引；本地设计与实施记录不放行。入库文档引用的本地文件必须可从仓库取得。
- 当前契约对照源码修改；历史方案与数据保留原始内容，通过状态说明或后续实施记录注明变化，不倒填未执行的验收。
- `CHANGELOG.md` 的“未发布”记录已实施但尚未发布的用户可感知变更；尚未实施的建议与选择记录在本地产品台账，影响交付的验收缺口记录在入库验证文档，不冒充已完成能力。
- 验证材料只公开合成夹具、必要的汇总指标和验收边界；账号标识、机器用户名/绝对路径、会话链接、真实正文和原始日志留在库外，验证材料按最小集合保留。测试档案保护及可重建产物清理见[测试材料与收尾](verify.md#测试材料与收尾)。
- 修改后运行 `bash scripts/verify.sh` 检查引用与仓库卫生；若涉及行为变化，再运行对应代码门禁。只改文档不需要重跑 Electron 全套。
