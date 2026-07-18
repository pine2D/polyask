#!/usr/bin/env bash
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

echo "[syntax] 检查 JavaScript"
mapfile -t JS_FILES < <(git ls-files --cached --others --exclude-standard -- '*.js')
for file in "${JS_FILES[@]}"; do
  node --check "$file"
done

echo "[json] 检查 JSON"
mapfile -t JSON_FILES < <(git ls-files --cached --others --exclude-standard -- '*.json')
for file in "${JSON_FILES[@]}"; do
  node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$file"
done

echo "[size] 检查 JS 单文件不超过 300 行"
for file in "${JS_FILES[@]}"; do
  lines=$(wc -l < "$file")
  [ "$lines" -le 300 ] || { echo "✗ $file: $lines 行" >&2; exit 1; }
done

echo "[test] 后台窗口与提交安全边界"
node scripts/test-background.js

git diff --check
echo "[verify] 全部通过"
