import "./web-badging";

// 子帧只安装角标策略，站点适配与命令 IPC 仍只允许主帧。
if (process.isMainFrame) require("./site");
