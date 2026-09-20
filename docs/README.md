# 文档索引与维护规则

核对日期：2026-09-20。当前源码版本 1.0.2，包含尚未发布的改动；发布状态以 `CHANGELOG.md` 的版本段为准。

## 当前契约

| 文件 | 用途 |
| --- | --- |
| `docs/desktop.md` | 进程、IPC、布局、数据、同步、备份与资源观察边界 |
| `docs/adapters.md` | 九站适配器协议、档位、图片与改版排查 |
| `docs/verify.md` | 自动化门禁、真实环境验证及尚未闭合事项 |
| `docs/release.md` | 版本晋升、五包发布、三语文案、签名与升级条件 |
| `docs/desktop-oauth-security.md` | OAuth 配置、凭据卫生及历史处置记录 |

这些文件随源码维护；项目硬约束以 `CLAUDE.md` 为准。文档核对不等于已完成远端配置、真实账号、原生系统或发布验收。

## 产品设计与实施记录

| 文件 | 当前状态 |
| --- | --- |
| `docs/product-optimization-2026-09-20.md` | 总台账：已实施、待验收及暂缓事项的入口 |
| `docs/task-folders-design-2026-09-20.md`、`docs/task-folders-plan-2026-09-20.md` | 文件夹设计与已完成实施计划；真实 Drive 双设备验收待补 |
| `docs/backup-restore-design-2026-09-20.md` | 备份设计与已完成实施记录；真实 Drive 恢复待补 |
| `docs/resource-baseline-2026-09-20.json` | WSL2 未登录环境两分钟原始样本，冻结，不代表优化收益或长期稳定性 |

四份 HTML 是历史候选方案，保留虚构数据与演示交互，不是运行中的产品界面：

- `docs/product-layout-options-2026-09-20.html`：已选 A，单行精炼。
- `docs/decision-card-options-2026-09-20.html`：已选方案 1，列表＋详情。
- `docs/task-folder-options-2026-09-20.html`：已选方案 2，左侧任务导航。
- `docs/backup-restore-options-2026-09-20.html`：已选方案 1，集中核对。

`docs/audit-2026-07.md` 是旧扩展 v0.6.1 的历史审计，因发布说明引用而保留，不作为当前 Desktop 的待办清单。同步与备份冻结样本的维护规则见 `desktop/test/fixtures/README.md`。

## 入库与维护

- `docs/` 默认忽略，仅 `.gitignore` 精确白名单中的正式文件入库。本地历史草稿、工具生成的计划和素材继续忽略，不批量加入仓库。
- `.gitignore` 只影响未跟踪文件；增加 `/docs/` 不会让已有文档退出版本管理。取消跟踪会使后续克隆缺少开发契约及引用文件，需要另行明确决定，不能当作常规忽略规则整理。
- 新增需要长期保留的契约、设计或验收记录时，同时补白名单及本索引。入库文档引用的本地文件必须可从仓库取得。
- 当前契约对照源码修改；历史方案与数据保留原始内容，通过状态说明或后续实施记录注明变化，不倒填未执行的验收。
- `CHANGELOG.md` 的“未发布”记录已实施但尚未发布的用户可感知变更；尚未实施的建议、选择与验收缺口记录在产品台账，不冒充已完成能力。
- 修改后运行 `bash scripts/verify.sh` 检查引用与仓库卫生；若涉及行为变化，再运行对应代码门禁。只改文档不需要重跑 Electron 全套。
