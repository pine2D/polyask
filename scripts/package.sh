#!/usr/bin/env bash
# 把 PolyAsk 打包成可上传 Chrome Web Store / 加载的 zip。
# 只含运行时文件，排除文档与开发产物。版本号取自 manifest.json。
# 用法：bash scripts/package.sh   →   产出 dist/polyask-v<version>.zip
set -euo pipefail
cd "$(dirname "$0")/.."   # 仓库根

command -v zip >/dev/null || { echo "需要 zip 命令（Debian/Ubuntu: sudo apt install zip）" >&2; exit 1; }

# 从 manifest.json 提取版本号（无需 node）
VERSION=$(grep -m1 '"version"' manifest.json | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')
[ -n "$VERSION" ] || { echo "无法从 manifest.json 解析版本号" >&2; exit 1; }

OUT="dist/polyask-v${VERSION}.zip"
RUNTIME=(manifest.json background.js bg icons content console popup)

# 运行时文件齐全性校验（缺一即扩展静默不工作）
for p in "${RUNTIME[@]}"; do
  [ -e "$p" ] || { echo "缺少运行时文件: $p" >&2; exit 1; }
done

mkdir -p dist
rm -f "$OUT"
# 排除任何隐藏文件 / .DS_Store / 临时备份
zip -r -q "$OUT" "${RUNTIME[@]}" -x '*/.*' -x '*.DS_Store' -x '*~'

echo "✓ 打包完成: $OUT ($(du -h "$OUT" | cut -f1))"
echo "包含条目："
zip -sf "$OUT" | sed '1d;$d' | sed 's/^/  /'
