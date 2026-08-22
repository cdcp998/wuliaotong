"""测试数据清理工具（《开发规范.md》§6 测试执行分层策略配套）。

供 B 类测试模块（大量写入、零清理）的模块级 fixture 调用：删除测试运行产生的业务数据，
保证「测试完毕数据移除」——不向共用存储池/业务表留下任何测试垃圾。

删除策略（保守精确，仅按可归因模式匹配，避免误删真实数据）：
1. 测试命名模式：仓库 code（TA/TB/WH/RP/DP+P3/P2P+6hex）、用户 username（mg/reg/cp/... + hex）、
   供应商 code（SUP...）、商品物料编码（CM/MC+hex）、固定测试商品名、测试分类名
2. 关联删除：货架/库位/商品单位/商品供应商、库存/流水、各单据（头+明细）、
   期初、领用、通知（按测试用户/单据）、注册申请、OCR 记录、AI 建议、测试文件（含磁盘）
3. 保留：admin/tester_user 等真实账号、种子数据（角色/权限/单位/默认分类）、本地默认存储、
   非测试模式的真实业务数据、操作日志与 LLM 日志（无法精确归因，不删）
"""
from __future__ import annotations

import os
import re
from pathlib import Path

from sqlalchemy import select, text

from app.db import SessionLocal
from app.models.advanced import (
    StkCheck,
    StkCheckItem,
    StkOtherIo,
    StkOtherIoItem,
    StkTransfer,
    StkTransferItem,
)
from app.models.base import (
    BaseCategory,
    BaseDepartment,
    BaseDepartmentShelf,
    BaseLocation,
    BaseProduct,
    BaseProductSupplier,
    BaseProductUnit,
    BaseShelf,
    BaseSupplier,
    BaseUnit,
    BaseWarehouse,
)
from app.models.ocr import AiSuggestion, OcrRecord
from app.models.requisition import OutRequisition, OutRequisitionItem
from app.models.stock import (
    PchPurchaseIn,
    PchPurchaseInItem,
    StkOpening,
    StkOpeningItem,
    StkStock,
    StkStockLog,
)
from app.models.sys import (
    SysFile,
    SysNotification,
    SysRegisterApply,
    SysRole,
    SysRolePermission,
    SysUser,
)

# ---- 测试命名模式（仅匹配测试创建的数据）----
# 测试仓库 code：前缀 + 6 位 hex（AW 预警/CK 盘点/CKE/CKE2、QW 其他、TA/TB 调拨、DP/DPT 单位、WH 领用/条码、RP 报表）
WH_CODE = re.compile(r"^(AW|CK|CKE|QW|TA|TB|DP|DPT|WH|RP)[0-9a-f]{6}$")
USER_NAME = re.compile(r"^(mg|reg|reg2|cp|cpca|cpc?|fg|peuser|deptuser|ai_worker_AI)[0-9a-f]{6,}$")
SUPPLIER_CODE = re.compile(r"^(SUP[A-Z]?[0-9a-fA-F]{6,8}|SUP\d+)$")
# OCR 自动新增供应商：OCR{时间戳}{序号}
SUPPLIER_CODE_OCR = re.compile(r"^OCR\d+$")
PRODUCT_MATERIAL = re.compile(r"^(CM|MC)[0-9a-f]{6}")
# 公司模板导入商品：code=CM{hex}01
PRODUCT_CODE_CM = re.compile(r"^CM[0-9a-f]{6}\d+$")
CATEGORY_NAME = re.compile(r"^(机械件|轴承类|标准件|P2测试分类|类|三)[0-9a-fA-F]{6,8}(二|三|四|子)?$")
# 部门（单位自动编码测试）：自动码{hex}[改|2]；机加车间（所属单位测试）
DEPT_NAME = re.compile(r"^(自动码[0-9a-f]{6,8}(改|2)?|机加车间)$")
# 测试角色：冒烟角色 role{ts} / AI 处理员(测试) ai_only_AI{hex} / 所属单位角色 dp{hex}
ROLE_CODE = re.compile(r"^(role\d+|ai_only_AI[0-9a-f]+|dp[0-9a-f]{6,8})$|^机加角色$")
# 历史测试商品 code（带字母的 hex 编码，真实商品自动编号为纯数字，不会冲突）：
# PDP/QTP/ALP 盘点/其他/预警物料、P1/P2 轴承/螺丝、P2P 商品
PRODUCT_CODE_OLD = re.compile(r"^(PDP|QTP|ALP|P1|P2|P2P|OCRP)[0-9a-f]{6,8}$")
# OCR/AI 自动新增商品：OCRP{hex}、AI{时间戳}
PRODUCT_CODE_AI = re.compile(r"^AI\d{14}$")
# 当前测试商品固定名（code 为 9+数字 与真实编码同构，只能按测试专属名删除）
TEST_PRODUCT_NAMES = (
    "P4物料", "P3物料", "报表物料", "送货单材料", "条码品", "期初物料", "调整物料", "盘内物料", "账外物料",
    "P2商品", "新型密封圈", "螺丝M6", "预警物料", "轴承6204-2RS", "其他物料", "盘点物料",
    "无编码件", "带物料编码", "自动编码", "表头材料", "数字编码", "冒烟材料", "x",
    "网络测试仪 NF-918S", "800万网络摄像头 TL-IPC682XD-A", "网络视频监控测试仪 SSC-GO01",
    "充电笔式光纤红光笔 100mW", "网络测试仪", "测温仪", "800万网络摄像头", "充电笔式", "备修造有限",
    "测温热成像仪", "千兆POE交换机", "网络监控测试仪", "扫描仪",
    "缓存测试商品", "缓存测试2改", "缓存测试商品改名", "容量型硬盘录像机", "业无线WiFi 6", "PTZ枪球一体 机", "硬盘录像机", "X",
    "预警文案测试物料", "模板学习测试物料",
)
# 测试单位（名称带 6 位 hex 后缀 + x 尾巴，如 件{hex}x；仅删未被材料引用的）
UNIT_NAME = re.compile(r"^(件|个|套)[0-9a-fA-F]{6,8}x$")
# 供应商名：{hex}五金 或 {hex}五金有限公司 / {hex}送货单供应商
SUPPLIER_NAME = re.compile(r"^[0-9a-fA-F]{6,8}(五金(有限公司)?|送货单供应商)$")

# 商品名含 tag 的匹配（轴承{hex} / 条码材料{hex} / P2P{hex} / 查重材料{hex} 等）
PRODUCT_NAME_TAGGED = re.compile(r"^(轴承|条码材料|条码品|条码未命中|P2P|材料|查重材料|关联材料|自动新增物料|冒烟关联材料|螺丝|不锈钢螺丝)[0-9a-fA-F]{6,8}")
# 三级分类测试商品：三{hex}料A/B/C
PRODUCT_NAME_3LVL = re.compile(r"^三[0-9a-fA-F]{6,8}料[ABC]$")


def _match_ids(db, model, id_field, ids: set[int]) -> None:
    if not ids:
        return
    for row in db.scalars(select(model).where(id_field.in_(ids))).all():
        db.delete(row)


def cleanup_test_data() -> None:
    """删除全部可归因的测试数据（含历史残留，自动收敛）。"""
    db = SessionLocal()
    try:
        db.rollback()
        # ---- 1) 收集测试实体 id ----
        test_wh_ids = {w.id for w in db.scalars(select(BaseWarehouse)).all() if WH_CODE.match(w.code)}
        test_user_ids = {u.id for u in db.scalars(select(SysUser)).all() if USER_NAME.match(u.username)}
        test_sup_ids = {
            s.id
            for s in db.scalars(select(BaseSupplier)).all()
            if SUPPLIER_CODE.match(s.code) or SUPPLIER_CODE_OCR.match(s.code) or SUPPLIER_NAME.match(s.name)
        }
        test_cat_ids = {
            c.id for c in db.scalars(select(BaseCategory)).all() if CATEGORY_NAME.match(c.name)
        }
        products = db.scalars(select(BaseProduct)).all()
        test_product_ids = {
            p.id
            for p in products
            if p.name in TEST_PRODUCT_NAMES
            or PRODUCT_NAME_TAGGED.match(p.name)
            or PRODUCT_NAME_3LVL.match(p.name)
            or PRODUCT_CODE_OLD.match(p.code)
            or PRODUCT_CODE_AI.match(p.code)
            or PRODUCT_CODE_CM.match(p.code)
            or PRODUCT_MATERIAL.match(p.material_code or "")
        }
        # 测试仓库内的货架/库位
        test_shelf_ids = {
            s.id for s in db.scalars(select(BaseShelf)).all() if s.warehouse_id in test_wh_ids
        }
        test_loc_ids = {
            l.id for l in db.scalars(select(BaseLocation)).all() if l.warehouse_id in test_wh_ids
        }
        # ---- 2) 收集测试单据（按仓库/供应商/商品关联）----
        def _bills(model, *conds):
            q = select(model)
            for c in conds:
                if c is not None:
                    q = q.where(c)
            return {b.id for b in db.scalars(q).all()}

        if test_wh_ids or test_sup_ids:
            pch_ids = _bills(
                PchPurchaseIn,
                PchPurchaseIn.warehouse_id.in_(test_wh_ids) if test_wh_ids else None,
                PchPurchaseIn.supplier_id.in_(test_sup_ids) if test_sup_ids else None,
            )
        else:
            pch_ids = set()
        req_ids = _bills(OutRequisition, OutRequisition.warehouse_id.in_(test_wh_ids)) if test_wh_ids else set()
        trf_ids = (
            _bills(
                StkTransfer,
                StkTransfer.from_warehouse_id.in_(test_wh_ids),
                StkTransfer.to_warehouse_id.in_(test_wh_ids),
            )
            if test_wh_ids
            else set()
        )
        chk_ids = _bills(StkCheck, StkCheck.warehouse_id.in_(test_wh_ids)) if test_wh_ids else set()
        oio_ids = _bills(StkOtherIo, StkOtherIo.warehouse_id.in_(test_wh_ids)) if test_wh_ids else set()
        opn_ids = _bills(StkOpening, StkOpening.warehouse_id.in_(test_wh_ids)) if test_wh_ids else set()

        # ---- 3) 删除（明细 → 主表；先删子表避免残留）----
        _match_ids(db, PchPurchaseInItem, PchPurchaseInItem.bill_id, pch_ids)
        _match_ids(db, OutRequisitionItem, OutRequisitionItem.requisition_id, req_ids)
        _match_ids(db, StkTransferItem, StkTransferItem.transfer_id, trf_ids)
        _match_ids(db, StkCheckItem, StkCheckItem.check_id, chk_ids)
        _match_ids(db, StkOtherIoItem, StkOtherIoItem.bill_id, oio_ids)
        _match_ids(db, StkOpeningItem, StkOpeningItem.bill_id, opn_ids)
        _match_ids(db, PchPurchaseIn, PchPurchaseIn.id, pch_ids)
        _match_ids(db, OutRequisition, OutRequisition.id, req_ids)
        _match_ids(db, StkTransfer, StkTransfer.id, trf_ids)
        _match_ids(db, StkCheck, StkCheck.id, chk_ids)
        _match_ids(db, StkOtherIo, StkOtherIo.id, oio_ids)
        _match_ids(db, StkOpening, StkOpening.id, opn_ids)
        # 库存与流水（按测试商品/仓库/库位）
        _match_ids(db, StkStockLog, StkStockLog.product_id, test_product_ids)
        _match_ids(db, StkStockLog, StkStockLog.warehouse_id, test_wh_ids)
        _match_ids(db, StkStock, StkStock.product_id, test_product_ids)
        _match_ids(db, StkStock, StkStock.warehouse_id, test_wh_ids)
        # 基础资料关联
        _match_ids(db, BaseProductSupplier, BaseProductSupplier.product_id, test_product_ids)
        _match_ids(db, BaseProductUnit, BaseProductUnit.product_id, test_product_ids)
        _match_ids(db, BaseDepartmentShelf, BaseDepartmentShelf.shelf_id, test_shelf_ids)
        _match_ids(db, BaseLocation, BaseLocation.id, test_loc_ids)
        _match_ids(db, BaseShelf, BaseShelf.id, test_shelf_ids)
        _match_ids(db, BaseProduct, BaseProduct.id, test_product_ids)
        _match_ids(db, BaseWarehouse, BaseWarehouse.id, test_wh_ids)
        _match_ids(db, BaseSupplier, BaseSupplier.id, test_sup_ids)
        # 历史孤儿单据（仓库已被清理，warehouse_id 悬空——删除保护只拦存在仓库的删除，测试清理后必产生孤儿）
        alive_wh = {w.id for w in db.scalars(select(BaseWarehouse)).all()}

        def _orphan_bills(model, *id_fields):
            ids = set()
            for b in db.scalars(select(model)).all():
                for f in id_fields:
                    if getattr(b, f) not in alive_wh:
                        ids.add(b.id)
                        break
            return ids

        orphan_req = _orphan_bills(OutRequisition, "warehouse_id")
        orphan_pch = _orphan_bills(PchPurchaseIn, "warehouse_id")
        orphan_trf = _orphan_bills(StkTransfer, "from_warehouse_id", "to_warehouse_id")
        orphan_chk = _orphan_bills(StkCheck, "warehouse_id")
        orphan_oio = _orphan_bills(StkOtherIo, "warehouse_id")
        orphan_opn = _orphan_bills(StkOpening, "warehouse_id")
        _match_ids(db, PchPurchaseInItem, PchPurchaseInItem.bill_id, orphan_pch)
        _match_ids(db, OutRequisitionItem, OutRequisitionItem.requisition_id, orphan_req)
        _match_ids(db, StkTransferItem, StkTransferItem.transfer_id, orphan_trf)
        _match_ids(db, StkCheckItem, StkCheckItem.check_id, orphan_chk)
        _match_ids(db, StkOtherIoItem, StkOtherIoItem.bill_id, orphan_oio)
        _match_ids(db, StkOpeningItem, StkOpeningItem.bill_id, orphan_opn)
        _match_ids(db, PchPurchaseIn, PchPurchaseIn.id, orphan_pch)
        _match_ids(db, OutRequisition, OutRequisition.id, orphan_req)
        _match_ids(db, StkTransfer, StkTransfer.id, orphan_trf)
        _match_ids(db, StkCheck, StkCheck.id, orphan_chk)
        _match_ids(db, StkOtherIo, StkOtherIo.id, orphan_oio)
        _match_ids(db, StkOpening, StkOpening.id, orphan_opn)
        # 孤儿货架/库位/库存流水（warehouse 已删；流水还可能因商品已删而悬空）
        alive_prod = {p.id for p in db.scalars(select(BaseProduct)).all()}
        orphan_shelf = {s.id for s in db.scalars(select(BaseShelf)).all() if s.warehouse_id not in alive_wh}
        orphan_loc = {l.id for l in db.scalars(select(BaseLocation)).all() if l.warehouse_id not in alive_wh}
        orphan_log = {
            g.id
            for g in db.scalars(select(StkStockLog)).all()
            if g.warehouse_id not in alive_wh or g.product_id not in alive_prod
        }
        orphan_stock = {
            g.id
            for g in db.scalars(select(StkStock)).all()
            if g.warehouse_id not in alive_wh or g.product_id not in alive_prod
        }
        _match_ids(db, BaseDepartmentShelf, BaseDepartmentShelf.shelf_id, orphan_shelf)
        _match_ids(db, BaseLocation, BaseLocation.id, orphan_loc)
        _match_ids(db, BaseShelf, BaseShelf.id, orphan_shelf)
        _match_ids(db, StkStockLog, StkStockLog.id, orphan_log)
        _match_ids(db, StkStock, StkStock.id, orphan_stock)
        # 孤儿文件（biz_id 指向已删单据；biz_id=0 的 OCR 原图无法归因，保留）
        alive_bills = (
            {b.id for b in db.scalars(select(PchPurchaseIn)).all()}
            | {b.id for b in db.scalars(select(OutRequisition)).all()}
            | {b.id for b in db.scalars(select(StkTransfer)).all()}
            | {b.id for b in db.scalars(select(StkCheck)).all()}
            | {b.id for b in db.scalars(select(StkOtherIo)).all()}
            | {b.id for b in db.scalars(select(StkOpening)).all()}
        )
        orphan_files = [
            f
            for f in db.scalars(select(SysFile)).all()
            if f.biz_id != 0 and f.biz_id not in alive_bills
        ]
        for f in orphan_files:
            try:
                fp = Path(f.file_path)
                if not fp.is_absolute():
                    from app.models.sys import SysStorage

                    st = db.get(SysStorage, f.storage_id) if f.storage_id else None
                    base = Path(st.path) if st else Path("data/files")
                    fp = base / f.file_path
                fp.unlink(missing_ok=True)
            except OSError:
                pass
            db.delete(f)
        # 测试部门（先删单位-货架关联与部门本身）
        test_dept_ids = {
            d.id for d in db.scalars(select(BaseDepartment)).all() if DEPT_NAME.match(d.name)
        }
        _match_ids(db, BaseDepartmentShelf, BaseDepartmentShelf.department_id, test_dept_ids)
        _match_ids(db, BaseDepartment, BaseDepartment.id, test_dept_ids)
        # 测试角色（先删角色-权限关联）
        test_role_ids = {
            r.id for r in db.scalars(select(SysRole)).all() if ROLE_CODE.match(r.code)
        }
        _match_ids(db, SysRolePermission, SysRolePermission.role_id, test_role_ids)
        _match_ids(db, SysRole, SysRole.id, test_role_ids)
        # 分类（先子后父：父分类可能被子分类引用；三级体系递归收集全部子孙）
        sub: set[int] = set()
        queue = list(test_cat_ids)
        while queue:
            cur = queue.pop()
            children = {
                c.id for c in db.scalars(select(BaseCategory)).all() if c.parent_id == cur
            }
            new = children - sub - test_cat_ids
            sub |= new
            queue.extend(new)
        _match_ids(db, BaseCategory, BaseCategory.id, sub)
        _match_ids(db, BaseCategory, BaseCategory.id, test_cat_ids)
        # 测试单位（在商品删除之后执行，未被任何材料引用的才删）
        used_units = {u.unit_id for u in db.scalars(select(BaseProduct)).all()}
        test_unit_ids = {
            u.id for u in db.scalars(select(BaseUnit)).all() if UNIT_NAME.match(u.name) and u.id not in used_units
        }
        _match_ids(db, BaseUnit, BaseUnit.id, test_unit_ids)
        # OCR / AI 建议（按文件/商品/用户关联）
        bill_ids = pch_ids | req_ids | trf_ids | chk_ids | oio_ids | opn_ids
        test_file_ids = {
            f.id for f in db.scalars(select(SysFile)).all() if f.uploader_id in test_user_ids or f.biz_id in bill_ids
        }
        ocr_ids = {
            r.id
            for r in db.scalars(select(OcrRecord)).all()
            if r.file_id in test_file_ids or r.matched_product_id in test_product_ids or r.user_id in test_user_ids
        }
        _match_ids(db, OcrRecord, OcrRecord.id, ocr_ids)
        _match_ids(db, AiSuggestion, AiSuggestion.new_product_id, test_product_ids)
        # 通知（按测试用户关联；预警类通知接收人为真实角色账号，无法精确归因，保留）
        note_ids = {n.id for n in db.scalars(select(SysNotification)).all() if n.user_id in test_user_ids}
        _match_ids(db, SysNotification, SysNotification.id, note_ids)
        # 注册申请（按用户名模式）与测试用户
        reg_ids = {
            r.id for r in db.scalars(select(SysRegisterApply)).all() if USER_NAME.match(r.username)
        }
        _match_ids(db, SysRegisterApply, SysRegisterApply.id, reg_ids)
        _match_ids(db, SysUser, SysUser.id, test_user_ids)
        # 测试文件记录（含磁盘文件）
        for f in db.scalars(select(SysFile).where(SysFile.id.in_(test_file_ids))).all():
            try:
                fp = Path(f.file_path)
                if not fp.is_absolute():
                    from app.models.sys import SysStorage

                    st = db.get(SysStorage, f.storage_id) if f.storage_id else None
                    base = Path(st.path) if st else Path("data/files")
                    fp = base / f.file_path
                fp.unlink(missing_ok=True)
            except OSError:
                pass
            db.delete(f)
        # ---- 隔离测试库（TEST_DB_URL 已设置）额外清理 ----
        # 测试库内无真实业务数据：按 admin 上传/匹配真实商品/直接落库创建的 OCR 记录、
        # AI 建议与上传文件无法精确归因（见上方注释），在此全量清除，保证零残留。
        if os.getenv("TEST_DB_URL", ""):
            all_ocr = {r.id for r in db.scalars(select(OcrRecord)).all()}
            _match_ids(db, OcrRecord, OcrRecord.id, all_ocr - ocr_ids)
            all_ai = {a.id for a in db.scalars(select(AiSuggestion)).all()}
            _match_ids(db, AiSuggestion, AiSuggestion.id, all_ai)
            leftover_files = {
                f.id for f in db.scalars(select(SysFile)).all() if f.id not in test_file_ids
            }
            for f in db.scalars(select(SysFile).where(SysFile.id.in_(leftover_files))).all():
                try:
                    fp = Path(f.file_path)
                    if not fp.is_absolute():
                        from app.models.sys import SysStorage

                        st = db.get(SysStorage, f.storage_id) if f.storage_id else None
                        base = Path(st.path) if st else Path("data/files")
                        fp = base / f.file_path
                    fp.unlink(missing_ok=True)
                except OSError:
                    pass
                db.delete(f)
        # ---- 模块插件（cable）测试数据：按 T- 前缀精确清理（表由模块 install.sql 创建）----
        from app.core.migration_utils import table_exists

        def _exec(sql: str) -> None:
            try:
                db.execute(text(sql))
            except Exception:  # noqa: BLE001 表不存在/列缺失时静默（模块未安装过）
                db.rollback()

        if table_exists(db, "cable"):
            _exec("DELETE FROM cable_point WHERE cable_id IN (SELECT id FROM cable WHERE code LIKE 'T-%')")
            _exec("DELETE FROM cable_marker WHERE cable_id IN (SELECT id FROM cable WHERE code LIKE 'T-%')")
            _exec("DELETE FROM cable_fault WHERE cable_id IN (SELECT id FROM cable WHERE code LIKE 'T-%') OR description LIKE 'T-%'")
            _exec("DELETE FROM fault_file WHERE fault_id NOT IN (SELECT id FROM cable_fault)")
            _exec("DELETE FROM map_download_task WHERE region_id IN (SELECT id FROM map_cache_region WHERE name LIKE 'T-%')")
            _exec("DELETE FROM map_cache_region WHERE name LIKE 'T-%'")
            _exec("DELETE FROM cable WHERE code LIKE 'T-%'")
        # ---- 模块插件（task）测试数据：任务标题 T- 前缀 ----
        if table_exists(db, "maintenance_task"):
            _exec("DELETE FROM task_record_file WHERE record_id IN (SELECT id FROM task_record WHERE task_id IN (SELECT id FROM maintenance_task WHERE title LIKE 'T-%'))")
            _exec("DELETE FROM task_record WHERE task_id IN (SELECT id FROM maintenance_task WHERE title LIKE 'T-%')")
            _exec("DELETE FROM task_requisition WHERE task_type = 'cable' AND task_id IN (SELECT id FROM maintenance_task WHERE title LIKE 'T-%')")
            _exec("DELETE FROM maintenance_task WHERE title LIKE 'T-%'")
        # ---- 模块插件（knowledge）测试数据：标题/主题 T- 前缀 ----
        if table_exists(db, "knowledge_article"):
            _exec("DELETE FROM knowledge_material_link WHERE article_id IN (SELECT id FROM knowledge_article WHERE title LIKE 'T-%')")
            _exec("DELETE FROM knowledge_article_revision WHERE article_id IN (SELECT id FROM knowledge_article WHERE title LIKE 'T-%')")
            _exec("DELETE FROM knowledge_article WHERE title LIKE 'T-%' OR source_task_id IN (SELECT id FROM knowledge_generate_task WHERE input LIKE '%T-%')")
            _exec("DELETE FROM knowledge_generate_task WHERE input LIKE '%T-%' OR article_id NOT IN (SELECT id FROM knowledge_article)")
        # 隔离测试库：模块状态/配置复位（cable/task 安装/启停/地图源配置不影响其他测试；migration 记录保留）
        if os.getenv("TEST_DB_URL", "") and table_exists(db, "sys_module"):
            db.execute(text("UPDATE sys_module SET state='NOT_INSTALLED', last_error='', config=NULL WHERE code IN ('cable','task','knowledge','device') AND (state <> 'NOT_INSTALLED' OR config IS NOT NULL)"))
            db.commit()
        db.commit()
    finally:
        db.close()
