#!/usr/bin/env bash
# =====================================================================
# 分层测试执行脚本（《开发规范.md》§6 测试执行分层策略）
#
# 原则：普通改动只跑与本次修改相关的针对性测试；只有发布、主干构建、
# 关键变更才跑全量测试。测试用例本身不变，仅控制触发时机与执行范围。
#
# 用法（仓库根目录执行）：
#   scripts/run_tests.sh                 # 默认：针对性（按 git diff 自动映射）
#   scripts/run_tests.sh --full          # 全量：后端 pytest 全量 + 前端两端 tsc + build
#   scripts/run_tests.sh --files="tests/test_auth.py tests/test_init.py"  # 指定测试文件
#   scripts/run_tests.sh --backend-only  # 只处理后端（配合 --files 指定文件）
#   scripts/run_tests.sh --frontend-only # 只处理前端类型检查
#   scripts/run_tests.sh --dry-run       # 只打印将执行的命令，不真正执行（验证映射用）
#   scripts/run_tests.sh --changed="file1 file2"  # 显式指定变更文件列表（CI 用 git diff 传入）
#
# 触发全量的场景（任一命中即全量，安全回退）：
#   1) 关键路径变更：app/models/**、sql/*.sql、app/db.py、app/config.py、
#      app/main.py、app/scheduler.py、app/core/**、app/services/stock.py、
#      app/api/init.py（安装流程）、backend/scripts/**、frontend 根配置
#   2) 变更文件无法映射到具体测试（新模块、未知路径）
#   3) --full 显式指定（发布 / 主干构建 / 关键变更）
# =====================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

FULL=0
DRY_RUN=0
BACKEND_ONLY=0
FRONTEND_ONLY=0
FILES=""
CHANGED_OVERRIDE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --full) FULL=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --files=*) FILES="${1#--files=}" ;;
    --changed=*) CHANGED_OVERRIDE="${1#--changed=}" ;;
    --backend-only) BACKEND_ONLY=1 ;;
    --frontend-only) FRONTEND_ONLY=1 ;;
    -h|--help)
      grep '^#' "$0" | head -32 | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "未知参数: $1（--help 查看用法）" >&2; exit 1 ;;
  esac
  shift
done

# ---- Python / npm 环境 ----
if [ -x "$ROOT/backend/.venv/Scripts/python.exe" ]; then
  PY="$ROOT/backend/.venv/Scripts/python.exe"
elif command -v python >/dev/null 2>&1; then
  PY=python
else
  echo "[run_tests] 找不到 Python（backend/.venv 或 PATH）" >&2
  exit 1
fi
HAS_NPM=0
command -v npm >/dev/null 2>&1 && [ -d frontend/node_modules ] && HAS_NPM=1

# ---- 版本一致性门禁（《开发规范.md》§9）：前后端版本号必须一致，任一漂移禁止提交 ----
echo "[run_tests] 版本一致性校验（§9）"
if ! "$PY" scripts/check_version.py; then
  echo "[run_tests] 版本号漂移，禁止继续" >&2
  exit 1
fi

# ---- 关键路径（命中任一 → 全量）----
CRITICAL_PATTERNS=(
  "backend/app/models/"
  "backend/sql/"
  "backend/app/db.py"
  "backend/app/config.py"
  "backend/app/main.py"
  "backend/app/scheduler.py"
  "backend/app/core/"
  "backend/app/services/stock.py"
  "backend/app/api/init.py"
  "backend/scripts/"
  "backend/requirements.txt"
  "frontend/package.json"
  "frontend/package-lock.json"
)

# ---- 变更文件 → 后端测试文件映射（普通路径）----
# app/api/<mod>.py 与 app/schemas/<mod>.py 共用此表；key 前缀匹配
API_MODULE_TESTS=(
  "auth|tests/test_auth.py tests/test_auth_ext.py"
  "system|tests/test_settings.py tests/test_storage.py tests/test_llm_log.py"
  "stock|tests/test_stock.py tests/test_advanced.py"
  "base_data|tests/test_base_data.py tests/test_product_code.py tests/test_company_import.py tests/test_supplier_link.py tests/test_supplier_norm.py"
  "requisition|tests/test_requisition.py"
  "report|tests/test_report.py tests/test_report_summary.py"
  "ocr|tests/test_ocr.py tests/test_delivery_ocr.py tests/test_paddle_engine.py"
  "admin|tests/test_admin.py"
  "advanced|tests/test_advanced.py tests/test_stock.py"
  "files|tests/test_storage.py"
  "storage|tests/test_storage.py"
  "notification|tests/test_requisition.py"
  "init|tests/test_init.py tests/test_settings.py"
)
# app/services/<name>.py 映射；key 前缀匹配（子目录取首段目录名）
SERVICE_MODULE_TESTS=(
  "storage|tests/test_storage.py"
  "quota|tests/test_quota.py"
  "backup|tests/test_admin.py"
  "dedupe|tests/test_dedupe.py"
  "correction|tests/test_correction.py"
  "product_template_learn|tests/test_product_template_learn.py"
  "ai/alert_text|tests/test_alert_text.py"
  "ai/report_summary|tests/test_report_summary.py"
  "ocr|tests/test_ocr.py tests/test_delivery_ocr.py tests/test_paddle_engine.py tests/test_generic_parser.py tests/test_barcode.py"
)

lookup() { # lookup "key" <列表> → 前缀匹配，输出测试文件（未命中输出空）
  local key="$1"; shift
  local entry
  for entry in "$@"; do
    local k="${entry%%|*}"
    case "$key" in
      "$k"*) echo "${entry#*|}"; return 0 ;;
    esac
  done
  return 1
}

# ---- 收集变更文件（默认工作区+暂存区+未跟踪；--changed 空格分隔显式指定）----
if [ -n "$CHANGED_OVERRIDE" ]; then
  CHANGED="$CHANGED_OVERRIDE"
else
  CHANGED="$(git status --porcelain | sed 's/^...//')"
fi
# 统一为每行一个文件（--changed 的空格分隔在此转成多行），供下方 while read 按行处理
CHANGED="$(echo $CHANGED | tr ' ' '\n' | sed '/^$/d')"
if [ -z "$CHANGED" ]; then
  echo "[run_tests] 工作区无变更，按全量回退"
  FULL=1
fi

BACKEND_TESTS=""
FRONTEND_TARGETS=""
if [ "$FULL" -eq 0 ] && [ -n "$FILES" ]; then
  # 显式指定测试文件：跳过 diff 分析
  BACKEND_TESTS="$FILES"
  FULL=0
elif [ "$FULL" -eq 0 ]; then
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    case "$f" in
      AI开发文档/*|开源发布/*|*.md|*.bat) continue ;;          # 纯文档/脚本文件无需测试
      frontend/node_modules/*|frontend/*/dist/*|backend/.venv/*) continue ;;  # 产物/依赖目录
    esac
    critical=0
    for pat in "${CRITICAL_PATTERNS[@]}"; do
      case "$f" in
        "$pat"*) critical=1 ;;
      esac
    done
    if [ "$critical" -eq 1 ]; then
      echo "[run_tests] 命中关键路径：$f → 升级为全量"
      FULL=1
      break
    fi
    case "$f" in
      backend/tests/*.py)
        BACKEND_TESTS="$BACKEND_TESTS ${f#backend/}"
        ;;
      backend/app/api/*.py)
        mod="$(basename "$f" .py)"
        t="$(lookup "$mod" "${API_MODULE_TESTS[@]}")" || true
        if [ -n "$t" ]; then BACKEND_TESTS="$BACKEND_TESTS $t"; else FULL=1; echo "[run_tests] api/$mod 无映射 → 全量"; fi
        ;;
      backend/app/schemas/*.py)
        mod="$(basename "$f" .py)"
        t="$(lookup "$mod" "${API_MODULE_TESTS[@]}")" || true
        if [ -n "$t" ]; then BACKEND_TESTS="$BACKEND_TESTS $t"; else FULL=1; echo "[run_tests] schemas/$mod 无映射 → 全量"; fi
        ;;
      backend/app/services/*.py)
        name="${f#backend/app/services/}"
        name="${name%.py}"
        t="$(lookup "$name" "${SERVICE_MODULE_TESTS[@]}")" || true
        if [ -n "$t" ]; then BACKEND_TESTS="$BACKEND_TESTS $t"; else FULL=1; echo "[run_tests] services/$name 无映射 → 全量"; fi
        ;;
      backend/app/models/*|backend/app/core/*)
        FULL=1; echo "[run_tests] $f 属关键层 → 全量"; break
        ;;
      backend/*.py)
        FULL=1; echo "[run_tests] $f 属后端未映射路径 → 全量"; break
        ;;
      scripts/*)
        FULL=1; echo "[run_tests] $f 属测试基础设施变更 → 全量"; break
        ;;
      frontend/packages/shared/*)
        FRONTEND_TARGETS="$FRONTEND_TARGETS desktop mobile"
        ;;
      frontend/apps/desktop/*)
        FRONTEND_TARGETS="$FRONTEND_TARGETS desktop"
        ;;
      frontend/apps/mobile/*)
        FRONTEND_TARGETS="$FRONTEND_TARGETS mobile"
        ;;
      frontend/*)
        FULL=1; echo "[run_tests] $f 属前端根配置/未知路径 → 全量"; break
        ;;
    esac
  done <<< "$CHANGED"
fi

# 整理去重（去除首尾空格，避免空列表被误判为有值）
BACKEND_TESTS="$(echo $BACKEND_TESTS | tr ' ' '\n' | sort -u | tr '\n' ' ' | sed 's/^ *//;s/ *$//')"
FRONTEND_TARGETS="$(echo $FRONTEND_TARGETS | tr ' ' '\n' | sort -u | tr '\n' ' ' | sed 's/^ *//;s/ *$//')"

# ---- 组装命令 ----
CMDS=()
if [ "$FULL" -eq 1 ]; then
  echo "[run_tests] 执行范围：全量（发布/主干/关键变更场景）"
  if [ "$BACKEND_ONLY" -eq 0 ]; then
    CMDS+=("cd backend && $PY -m compileall -q app tests scripts")
    CMDS+=("cd backend && $PY -m pytest tests -q")
  fi
  if [ "$BACKEND_ONLY" -eq 0 ] && [ "$FRONTEND_ONLY" -eq 0 ] && [ "$HAS_NPM" -eq 1 ]; then
    CMDS+=("cd frontend && npm run typecheck")
    CMDS+=("cd frontend && npm run build -w wlt-desktop && npm run build -w wlt-mobile")
  fi
else
  echo "[run_tests] 执行范围：针对性（本次变更相关）"
  if [ -n "$BACKEND_TESTS" ] && [ "$FRONTEND_ONLY" -eq 0 ]; then
    CMDS+=("cd backend && $PY -m pytest $BACKEND_TESTS -q")
  elif [ "$FRONTEND_ONLY" -eq 0 ]; then
    echo "[run_tests] 后端无相关测试文件，跳过后端测试"
  fi
  if [ -n "$FRONTEND_TARGETS" ] && [ "$BACKEND_ONLY" -eq 0 ] && [ "$HAS_NPM" -eq 1 ]; then
    for tgt in $FRONTEND_TARGETS; do
      CMDS+=("cd frontend && npx tsc --noEmit -p apps/$tgt")
    done
  fi
fi

if [ ${#CMDS[@]} -eq 0 ]; then
  echo "[run_tests] 本次变更无需测试（如纯文档改动），跳过。"
  exit 0
fi

if [ "$DRY_RUN" -eq 1 ]; then
  echo "---- 计划执行（--dry-run）----"
  for c in "${CMDS[@]}"; do echo "  $c"; done
  exit 0
fi

FAILED=0
for c in "${CMDS[@]}"; do
  echo ">>> $c"
  if ! bash -c "$c"; then
    echo "[run_tests] 命令失败：$c" >&2
    FAILED=1
  fi
done
[ "$FAILED" -eq 1 ] && exit 1
echo "[run_tests] 全部通过 ✅"
