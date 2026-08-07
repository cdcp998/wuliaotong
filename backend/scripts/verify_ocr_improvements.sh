#!/usr/bin/env bash
# 送货单 OCR 改进：完整验证 + 提交脚本（开发规范 L1~L4 门禁）。
# 用法（git-bash，仓库根目录 G:\phpstudy_pro\进销存）：bash backend/scripts/verify_ocr_improvements.sh
# 只提交白名单文件；工作区其余未提交改动保持原样。输出摘要见最后 SUMMARY。
set -u
cd "$(dirname "$0")/../.." || exit 1
ROOT="$(pwd)"
PY="$ROOT/backend/.venv/Scripts/python.exe"
LOGDIR="$ROOT/backend/logs"
PASS=0; FAIL=0
ok()   { echo "== OK: $1"; PASS=$((PASS+1)); }
bad()  { echo "== FAIL: $1"; FAIL=$((FAIL+1)); }

echo "########## 1) L1 compileall ##########"
if "$PY" -m compileall -q backend/app backend/tests; then ok "compileall"; else bad "compileall"; fi

echo "########## 2) L2 pytest 全量 ##########"
(cd backend && PYTHONIOENCODING=utf-8 "$PY" -m pytest -q > "$LOGDIR/pytest-out.txt" 2>&1); EC=$?
tail -5 "$LOGDIR/pytest-out.txt"
if [ $EC -eq 0 ]; then ok "pytest ($(grep -oE '[0-9]+ passed' "$LOGDIR/pytest-out.txt" | head -1))"; else bad "pytest exit=$EC（详见 $LOGDIR/pytest-out.txt）"; fi

echo "########## 3) 真实图端到端（新格式 + 已知格式） ##########"
(cd backend && PYTHONIOENCODING=utf-8 "$PY" scripts/e2e_delivery_ocr.py > "$LOGDIR/e2e-out.txt" 2>&1); EC=$?
grep '^E2E:' "$LOGDIR/e2e-out.txt" || tail -20 "$LOGDIR/e2e-out.txt"
if [ $EC -eq 0 ]; then ok "e2e"; else bad "e2e exit=$EC（详见 $LOGDIR/e2e-out.txt）"; fi

echo "########## 4) 前端 typecheck + build ##########"
(cd frontend && npm run typecheck > "$LOGDIR/tsc-out.txt" 2>&1); EC=$?
if [ $EC -eq 0 ]; then ok "前端 typecheck"; else bad "前端 typecheck exit=$EC（详见 $LOGDIR/tsc-out.txt）"; fi
(cd frontend && npm run build > "$LOGDIR/build-out.txt" 2>&1); EC=$?
if [ $EC -eq 0 ]; then ok "前端 build"; else bad "前端 build exit=$EC（详见 $LOGDIR/build-out.txt）"; fi

echo "########## 5) 清理临时文件 ##########"
rm -f backend/data/tmp/ocr_new_dump.json && ok "清理 ocr_new_dump.json"

echo "########## 6) git 提交（白名单） ##########"
if [ $FAIL -gt 0 ]; then
  echo "== 存在失败项，按规范不提交（修复后重跑本脚本）"
else
  git add \
    "AI开发文档/AI赋能设计.md" \
    "AI开发文档/后端API设计.md" \
    "AI开发文档/开发进度记录.md" \
    "backend/app/api/ocr.py" \
    "backend/app/api/files.py" \
    "backend/app/services/ocr/generic_parser.py" \
    "backend/app/services/ocr/sample_archive.py" \
    "backend/tests/test_generic_parser.py" \
    "backend/tests/test_ocr.py" \
    "backend/tests/test_delivery_ocr.py" \
    "backend/tests/test_quota.py" \
    "frontend/apps/desktop/src/pages/DeliveryOcr.tsx" \
    "frontend/apps/mobile/src/pages/Inbound.tsx"
  if git diff --cached --quiet; then
    echo "== 无新改动，跳过提交"
  else
    git commit -m "fix(ocr): 通用解析兼容 Paddle numpy 坐标（端到端新格式 4 条明细）+ 测试隔离修复；文档同步"
    if [ $? -eq 0 ]; then ok "git commit(ocr)"; else bad "git commit(ocr)"; fi
  fi
  # 启动器（chore，独立提交）
  git add README.md "启动后端.bat" "启动桌面端.bat" "启动手机端.bat" "一键启动全部.bat"
  if git diff --cached --quiet; then
    echo "== 无新改动，跳过提交"
  else
    git commit -m "chore(scripts): 前后端一键启动器（.bat）与 README 启动说明"
    if [ $? -eq 0 ]; then ok "git commit(scripts)"; else bad "git commit(scripts)"; fi
  fi
  echo "---- git status --short（应只剩无关改动）----"
  git status --short
fi

echo "########## SUMMARY ##########"
echo "PASS=$PASS FAIL=$FAIL"
echo "日志：$LOGDIR/pytest-out.txt、$LOGDIR/e2e-out.txt、$LOGDIR/tsc-out.txt、$LOGDIR/build-out.txt"
