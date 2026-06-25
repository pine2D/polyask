#!/usr/bin/env bash
# sync-to-sch.sh — 适配器单向同步：本仓(唯一源) → simple-chat-hub-extension
#
# 用法：在本仓改完 content/adapters-*.js 后，跑一次：
#   scripts/sync-to-sch.sh
# 它把本仓适配器替换前缀(__AMS→__SCH、content/→custom/)后写到 sch，
# sch 那边无需再手改。单向：sch 不是源，永远只从本仓推。
set -euo pipefail

SCH="${SCH:-$HOME/projects/simple-chat-hub-extension}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/content"
DST="$SCH/src/extension/custom"

[ -d "$DST" ] || { echo "✗ 找不到 sch 适配器目录：$DST（设 SCH=路径 覆盖）" >&2; exit 1; }

for f in adapters-intl.js adapters-cn.js; do
  perl -pe 's/window\.__AMS/window.__SCH/g; s{content/adapters}{custom/adapters}g' \
    "$SRC/$f" > "$DST/$f"
  echo "→ $f"
done
echo "✓ 适配器已单向同步到 simple-chat-hub-extension"
