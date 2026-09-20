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

## 新实体与备份

- `schema2-*.json`：决策卡及删除标记，实体 schema 2。
- `schema3-*.json`：任务文件夹、归属关系及删除标记，实体 schema 3。
- `backup-format1.json`：八类业务数据备份，`format: "polyask-backup"` / `version: 1`；不是 Drive 同步封装，不含设备身份。

`shared/sync.ts` 的 `SYNC_SCHEMA = 1` 继续用于旧 history/archive/state，`SUPPORTED_SYNC_SCHEMA = 3` 是客户端识别上限。决策卡和文件夹使用各自实体格式；已有样本始终保留，由对应 wire-format、同步和备份测试校验。
