# 同步与备份格式 fixture

冻结样本只增不改，版本由对应实体或备份格式决定；新增实体格式不要求把旧实体一起升版。

## 历史同步 schema 1

`schema1-*.json` 是 Google Drive appDataFolder 里 **schema 1** 记录的冻结样本，每个文件 = `{ file, body }`：
`file` 是 Drive 文件元数据（`appProperties` 按上传口径），`body` 是下载得到的正文。

来源：2026-09-05 用扩展侧真实实现生成——归档记录出自 `bg/archive-model.js` 的 `normalize()` / `update()`
（入口形状取 `console/status.js` 的 `archiveSummary`）、历史与 tombstone 按 `bg/data.js` 的
`addHistory` / `deleteHistory` / `writeArchiveDelete`、state fragment 按 `deviceState` + `noteStorageChanges`、
文件元数据按 `bg/sync.js` 的上传分支。扩展代码已删除（代码保留在 tag `archive/extension-v0.25.1`），这些文件就是线格式的唯一真源。

规则：**不要重新生成、不要按新校验「修正」它们**。`schema1-wire-format.test.ts` 会把全部样本喂给
同步下行链路并要求逐条接收；任何一次校验收紧命中了存量形状，会先红在那里，而不是在用户的结果库里静默少几条。

`schema1-state-site-order.json` 是 2026-10-06 新增的 Desktop 站点顺序样本（不是扩展生成），使用同版本的 `amsConsole.selected` 与 `amsConsole.siteOrder` 主机名数组；旧 schema 1 样本保持不变。`workspace-order-sync.test.ts` 覆盖顺序往返、旧客户端更新选择、未知主机与本机重置后的恢复。

`schema1-state-participation.json` 是 2026-10-09 新增的发送勾选样本，`amsConsole.participating` 使用独立版本的主机名布尔映射。`participation-sync.test.ts` 覆盖未勾选、空范围、未知主机、本机重置与备份恢复；旧样本不修改。

`schema1-state-preferences.json` 与 `schema1-state-drafts.json` 是 2026-10-09 新增的独立偏好和设备草稿分支样本，分别使用 `polyask.preference.*`、`polyask.draft.*` setting，沿用 state schema 1。未知扩展字段可由旧客户端保留；草稿墓碑保留身份和上下文，不保留正文。相应 repository、同步和备份测试覆盖版本合并、设备覆盖及删除终态。

`schema1-state-preferences-proxy.json` 是 2026-10-12 新增的网络代理偏好样本，setting `polyask.preference.proxy` 的值为规范形式的代理配置（固定字段顺序、小写主机、不含密码）。旧客户端不认识该键，会原样带回。`preferences-proxy-boundary.test.ts` 覆盖投影往返、非规范值拒收，以及该值不进入偏好快照和 outbox；旧样本不修改。

## 新实体与备份

- `schema2-*.json`：决策卡及删除标记，实体 schema 2。
- `schema3-*.json`：任务文件夹、归属关系及删除标记，实体 schema 3。
- `backup-format1.json`：八类业务数据备份，`format: "polyask-backup"` / `version: 1`；不是 Drive 同步封装，不含设备身份。

`shared/sync.ts` 的 `SYNC_SCHEMA = 1` 继续用于旧 history/archive/state，`SUPPORTED_SYNC_SCHEMA = 5` 是客户端识别上限。决策卡和文件夹使用各自实体格式；已有样本始终保留，由对应 wire-format、同步和备份测试校验。

## 提问历史 schema 4 与备份 v2

- `schema4-question.json` / `schema4-questionAnswer.json`：逐次提问与独立站点尝试；Drive 元数据 ID 为正文 ID 的 SHA-256，不附正文或 URL 预览。
- `backup-format2.json`：包含新两类实体的业务备份；仍支持读取冻结的 version 1。
- 提问/回答保持 schema 4；当前客户端识别上限为 `SUPPORTED_SYNC_SCHEMA = 5`，旧实体格式保持不变。

## 偏好与草稿备份 v3

- `backup-v3-preferences-drafts.json`：新增 `preference` 与 `draft` 两类业务条目，不包含设备显示覆盖、是否跟随同步、草稿同步开关或原设备身份。仍读取版本 1 和 2。
- 恢复的草稿作为独立备份副本，保留关联上下文，避免与当前设备正在编辑的分支合并。

## 原图附件 schema 5（可选同步）

- `schema5-question-attachments.json` / `schema5-question-attachments-tombstone.json`：独立原图集及删除标记；正文保留 questionId，活记录携带有序 metadata/base64，墓碑不保留图片字段。现有 schema 1–4 样本保持冻结。
- 本机仓库及同步下行验证格式、哈希与字节；图片同步默认关闭，确认开启后传输新实体，客户端识别上限为 schema 5。旧样本不改写。
- `schema4-sync-pull.ts.txt` 冻结自 `1e04254` 的实际 schema 4 下行实现，测试以旧版上限 4 执行，证明 schema 5 会锁住旧客户端的全局上传且不触发删除。
- `image-sync-local-meta-v1.json` 记录仅本机的图片开关/确认键、reset 与投影排除契约；它不是 Drive 正文，也不进入业务备份。
