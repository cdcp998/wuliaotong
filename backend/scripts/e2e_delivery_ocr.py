"""送货单 OCR 改进端到端验证脚本（用新代码 in-process TestClient，直连开发库）。

用法：cd backend && .venv/Scripts/python.exe scripts/e2e_delivery_ocr.py
输出：关键结果以 "E2E:" 前缀打印，便于 grep。
注意：会向开发库写入 sys_file/ocr_record/供应商 等测试数据（项目惯例允许）。
"""
from __future__ import annotations

import json
import sys
import time
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]  # backend/
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient

from app.main import app

NEW_IMG = ROOT.parent / "testdata" / "进货单" / "新格式进货单.JPG"
KNOWN_IMG = ROOT.parent / "testdata" / "进货单" / "OCR进货单测试.jpg"


def _login(c: TestClient) -> None:
    r = c.post("/api/v1/auth/login", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 200 and r.json()["code"] == 0, r.text
    print("E2E: login ok")


def _upload(c: TestClient, path: Path) -> int:
    with path.open("rb") as f:
        r = c.post(
            "/api/v1/files/upload?biz_type=purchase_bill",
            files={"file": (path.name, f, "image/jpeg")},
        )
    assert r.json()["code"] == 0, r.text
    fid = r.json()["data"]["file_id"]
    print(f"E2E: upload {path.name} -> file_id={fid}")
    return fid


def _recognize(c: TestClient, file_id: int) -> dict:
    r = c.post(f"/api/v1/ocr/recognize?file_id={file_id}&ocr_type=1&mode=auto")
    assert r.json()["code"] == 0, r.text
    task_id = r.json()["data"]["task_id"]
    for _ in range(75):  # 最长 150s（每 2s）
        time.sleep(2)
        r = c.get(f"/api/v1/ocr/tasks/{task_id}")
        body = r.json()
        if body["code"] != 0:
            return {"error": body["message"]}
        if body["data"]["status"] in ("done", "failed"):
            return body["data"]
    return {"error": "poll timeout"}


def _show(task: dict, tag: str) -> None:
    st = task.get("structured") or {}
    items = st.get("items") or []
    print(f"E2E: [{tag}] status={task.get('status')} engine={st.get('_engine')} "
          f"supplier={st.get('supplier_name')!r} bill_no={st.get('bill_no')!r} "
          f"warnings={st.get('warnings')} items={len(items)} lines={len(st.get('lines') or [])}")
    for it in items:
        print(f"E2E:   item name={it.get('product_name')!r} spec={it.get('spec')!r} "
              f"qty={it.get('qty')!r} price={it.get('price')!r} amount={it.get('amount')!r}")


def _check_archive(file_id: int) -> None:
    root = ROOT / "data" / "ocr_training" / "送货单"
    hits = sorted(root.glob(f"*/*_f{file_id}_*")) if root.is_dir() else []
    print(f"E2E: archive files for file_id={file_id}: {[p.name for p in hits]}")
    for p in hits:
        if p.suffix == ".json":
            try:
                meta = json.loads(p.read_text(encoding="utf-8"))
                print(f"E2E:   sidecar keys={list(meta.keys())} "
                      f"has_structured={'structured' in meta}")
            except Exception as e:  # noqa: BLE001
                print(f"E2E:   sidecar read failed: {e}")


def main() -> None:
    c = TestClient(app)
    _login(c)

    # 1) 新格式送货单（用户指定验证图）：期望通用解析命中 4 条明细
    fid = _upload(c, NEW_IMG)
    task = _recognize(c, fid)
    _show(task, "新格式进货单.JPG")
    _check_archive(fid)

    # 2) 已知格式回归：期望模板命中或视觉兜底，明细 ≥1
    fid2 = _upload(c, KNOWN_IMG)
    task2 = _recognize(c, fid2)
    _show(task2, "OCR进货单测试.jpg")
    _check_archive(fid2)

    print("E2E: done")


if __name__ == "__main__":
    main()
