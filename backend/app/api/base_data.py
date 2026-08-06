"""基础资料接口：分类/单位/供应商/商品/仓库/货架/库位 + Excel 导入导出（《后端API设计.md》§2）。

权限点：base:category / base:product / base:supplier / base:warehouse / base:stock-location。
删除语义：基础资料不做物理删除，DELETE = 停用（status=0）；有引用关系的禁止停用。
"""
from __future__ import annotations

import io
import re
import uuid
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.responses import StreamingResponse
from openpyxl import Workbook, load_workbook
from sqlalchemy import func, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, require_permission
from app.core.response import BizError, E_NOT_FOUND, E_PARAM, ok
from app.db import get_db
from app.models.base import (
    BaseCategory,
    BaseLocation,
    BaseProduct,
    BaseProductUnit,
    BaseShelf,
    BaseSupplier,
    BaseUnit,
    BaseWarehouse,
)
from app.schemas.base import (
    CategoryNode,
    CategoryReq,
    LocationOut,
    LocationReq,
    PageData,
    ProductOut,
    ProductReq,
    ShelfOut,
    ShelfReq,
    SupplierOut,
    SupplierReq,
    UnitOut,
    UnitReq,
    WarehouseOut,
    WarehouseReq,
)

router = APIRouter(tags=["基础资料"], dependencies=[Depends(get_current_user)])
# 静态路径路由（/products/import-template、/products/export）必须优先于 /products/{product_id} 注册
static_router = APIRouter(tags=["基础资料"], dependencies=[Depends(get_current_user)])

_DECIMAL_RE = re.compile(r"^\d+(\.\d+)?$")

# 商品导入列（与模板/导出一致，顺序固定）
PRODUCT_IMPORT_COLUMNS = ["编码", "条码", "SKU", "名称", "分类", "规格", "单位", "进价", "下限", "上限"]


def _parse_dec(v: str, field: str) -> Decimal:
    if not _DECIMAL_RE.match(v):
        raise BizError(E_PARAM, f"{field} 必须是数字")
    return Decimal(v)


def _category_path(db: Session, parent_id: int) -> str:
    if parent_id == 0:
        return "/"
    parent = db.get(BaseCategory, parent_id)
    if parent is None:
        raise BizError(E_PARAM, "父分类不存在")
    return f"{parent.path}{parent.id}/"


def _rebuild_path(db: Session, cat: BaseCategory) -> None:
    """重算分类 path（含子孙）。"""
    cat.path = _category_path(db, cat.parent_id)
    children = db.scalars(select(BaseCategory).where(BaseCategory.parent_id == cat.id)).all()
    for child in children:
        _rebuild_path(db, child)


# ============================ 分类 ============================


@router.get("/categories")
def list_categories(db: Session = Depends(get_db)) -> dict:
    cats = db.scalars(
        select(BaseCategory).order_by(BaseCategory.sort, BaseCategory.id)
    ).all()
    nodes: dict[int, dict] = {c.id: {"id": c.id, "parent_id": c.parent_id, "name": c.name, "sort": c.sort, "children": []} for c in cats}
    tree: list[dict] = []
    for c in cats:
        node = nodes[c.id]
        if c.parent_id and c.parent_id in nodes:
            nodes[c.parent_id]["children"].append(node)
        else:
            tree.append(node)
    return ok(tree)


@router.post("/categories", dependencies=[Depends(require_permission("base:category"))])
def create_category(req: CategoryReq, db: Session = Depends(get_db)) -> dict:
    cat = BaseCategory(
        parent_id=req.parent_id,
        name=req.name,
        sort=req.sort,
        path=_category_path(db, req.parent_id),
    )
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return ok(CategoryNode(id=cat.id, parent_id=cat.parent_id, name=cat.name, sort=cat.sort).model_dump())


@router.put("/categories/{cat_id}", dependencies=[Depends(require_permission("base:category"))])
def update_category(cat_id: int, req: CategoryReq, db: Session = Depends(get_db)) -> dict:
    cat = db.get(BaseCategory, cat_id)
    if cat is None:
        raise BizError(E_NOT_FOUND, "分类不存在")
    if req.parent_id == cat_id:
        raise BizError(E_PARAM, "父分类不能是自己")
    cat.parent_id = req.parent_id
    cat.name = req.name
    cat.sort = req.sort
    _rebuild_path(db, cat)
    db.commit()
    return ok()


@router.delete("/categories/{cat_id}", dependencies=[Depends(require_permission("base:category"))])
def delete_category(cat_id: int, db: Session = Depends(get_db)) -> dict:
    cat = db.get(BaseCategory, cat_id)
    if cat is None:
        raise BizError(E_NOT_FOUND, "分类不存在")
    child_cnt = db.scalar(select(func.count()).select_from(BaseCategory).where(BaseCategory.parent_id == cat_id)) or 0
    product_cnt = db.scalar(select(func.count()).select_from(BaseProduct).where(BaseProduct.category_id == cat_id)) or 0
    if child_cnt or product_cnt:
        raise BizError(E_PARAM, "分类下存在子分类或商品，禁止删除")
    db.delete(cat)
    db.commit()
    return ok()


# ============================ 单位 ============================


@router.get("/units")
def list_units(db: Session = Depends(get_db)) -> dict:
    units = db.scalars(select(BaseUnit).order_by(BaseUnit.id)).all()
    return ok([UnitOut(id=u.id, name=u.name, remark=u.remark).model_dump() for u in units])


@router.post("/units", dependencies=[Depends(require_permission("base:product"))])
def create_unit(req: UnitReq, db: Session = Depends(get_db)) -> dict:
    if db.scalar(select(BaseUnit.id).where(BaseUnit.name == req.name)):
        raise BizError(E_PARAM, "单位已存在")
    unit = BaseUnit(name=req.name, remark=req.remark)
    db.add(unit)
    db.commit()
    db.refresh(unit)
    return ok(UnitOut(id=unit.id, name=unit.name, remark=unit.remark).model_dump())


@router.put("/units/{unit_id}", dependencies=[Depends(require_permission("base:product"))])
def update_unit(unit_id: int, req: UnitReq, db: Session = Depends(get_db)) -> dict:
    unit = db.get(BaseUnit, unit_id)
    if unit is None:
        raise BizError(E_NOT_FOUND, "单位不存在")
    exists = db.scalar(select(BaseUnit.id).where(BaseUnit.name == req.name, BaseUnit.id != unit_id))
    if exists:
        raise BizError(E_PARAM, "单位已存在")
    unit.name = req.name
    unit.remark = req.remark
    db.commit()
    return ok()


@router.delete("/units/{unit_id}", dependencies=[Depends(require_permission("base:product"))])
def delete_unit(unit_id: int, db: Session = Depends(get_db)) -> dict:
    unit = db.get(BaseUnit, unit_id)
    if unit is None:
        raise BizError(E_NOT_FOUND, "单位不存在")
    used = db.scalar(select(func.count()).select_from(BaseProductUnit).where(BaseProductUnit.unit_id == unit_id)) or 0
    if used:
        raise BizError(E_PARAM, "单位已被商品引用，禁止删除")
    db.delete(unit)
    db.commit()
    return ok()


# ============================ 供应商 ============================


@router.get("/suppliers")
def list_suppliers(
    keyword: str = Query("", max_length=100),
    status: int | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> dict:
    stmt = select(BaseSupplier)
    if keyword:
        stmt = stmt.where(or_(BaseSupplier.name.like(f"%{keyword}%"), BaseSupplier.code.like(f"%{keyword}%")))
    if status is not None:
        stmt = stmt.where(BaseSupplier.status == status)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(BaseSupplier.id.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return ok(PageData(
        list=[SupplierOut.model_validate(s, from_attributes=True).model_dump() for s in rows],
        total=total, page=page, page_size=page_size,
    ).model_dump())


@router.post("/suppliers", dependencies=[Depends(require_permission("base:supplier"))])
def create_supplier(req: SupplierReq, db: Session = Depends(get_db)) -> dict:
    if db.scalar(select(BaseSupplier.id).where(BaseSupplier.code == req.code)):
        raise BizError(E_PARAM, "供应商编码已存在")
    sup = BaseSupplier(**req.model_dump())
    db.add(sup)
    db.commit()
    db.refresh(sup)
    return ok(SupplierOut.model_validate(sup, from_attributes=True).model_dump())


@router.put("/suppliers/{sup_id}", dependencies=[Depends(require_permission("base:supplier"))])
def update_supplier(sup_id: int, req: SupplierReq, db: Session = Depends(get_db)) -> dict:
    sup = db.get(BaseSupplier, sup_id)
    if sup is None:
        raise BizError(E_NOT_FOUND, "供应商不存在")
    exists = db.scalar(select(BaseSupplier.id).where(BaseSupplier.code == req.code, BaseSupplier.id != sup_id))
    if exists:
        raise BizError(E_PARAM, "供应商编码已存在")
    for k, v in req.model_dump().items():
        setattr(sup, k, v)
    db.commit()
    return ok()


@router.delete("/suppliers/{sup_id}", dependencies=[Depends(require_permission("base:supplier"))])
def delete_supplier(sup_id: int, db: Session = Depends(get_db)) -> dict:
    sup = db.get(BaseSupplier, sup_id)
    if sup is None:
        raise BizError(E_NOT_FOUND, "供应商不存在")
    sup.status = 0  # 软删除：停用
    db.commit()
    return ok()


SUPPLIER_IMPORT_COLUMNS = ["编码", "名称", "联系人", "电话", "地址"]


@router.post("/suppliers/import", dependencies=[Depends(require_permission("base:supplier"))])
async def import_suppliers(file: UploadFile = File(...), db: Session = Depends(get_db)) -> dict:
    data = await file.read()
    wb = load_workbook(io.BytesIO(data), read_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        raise BizError(E_PARAM, "文件为空")
    headers = [str(h).strip() if h else "" for h in rows[0]]
    if headers[:5] != SUPPLIER_IMPORT_COLUMNS:
        raise BizError(E_PARAM, f"表头必须为：{'/'.join(SUPPLIER_IMPORT_COLUMNS)}")
    success, fail_rows = 0, []
    for idx, row in enumerate(rows[1:], start=2):
        vals = [str(v).strip() if v is not None else "" for v in row] + [""] * 5
        code, name = vals[0], vals[1]
        if not name:
            fail_rows.append({"row": idx, "reason": "名称为空"})
            continue
        if not code:
            code = "SUP" + uuid.uuid4().hex[:6].upper()
        if db.scalar(select(BaseSupplier.id).where(BaseSupplier.code == code)):
            fail_rows.append({"row": idx, "reason": f"编码 {code} 已存在"})
            continue
        db.add(BaseSupplier(code=code, name=name, contact=vals[2], phone=vals[3], address=vals[4]))
        success += 1
    db.commit()
    return ok({"success_count": success, "fail_rows": fail_rows})


# ============================ 商品 ============================


def _product_out(db: Session, p: BaseProduct) -> dict:
    cat = db.get(BaseCategory, p.category_id)
    unit = db.get(BaseUnit, p.unit_id)
    units = db.scalars(
        select(BaseProductUnit).where(BaseProductUnit.product_id == p.id).order_by(BaseProductUnit.is_default.desc())
    ).all()
    return ProductOut(
        id=p.id, code=p.code, barcode=p.barcode, sku=p.sku, name=p.name,
        category_id=p.category_id, category_name=cat.name if cat else "",
        spec=p.spec, unit_id=p.unit_id, unit_name=unit.name if unit else "",
        purchase_price=p.purchase_price, min_stock=p.min_stock, max_stock=p.max_stock,
        status=p.status, remark=p.remark,
        units=[{"id": u.id, "unit_id": u.unit_id, "unit_name": (db.get(BaseUnit, u.unit_id).name if db.get(BaseUnit, u.unit_id) else ""), "rate": format(u.rate, "f"), "is_default": u.is_default} for u in units],
    ).model_dump()


def _apply_units(db: Session, product_id: int, unit_id: int, units: list) -> None:
    """写入多单位换算：默认单位与 unit_id 一致（不存在则自动补）。

    units 元素为 dict（来自 schema model_dump）。
    """
    db.execute(BaseProductUnit.__table__.delete().where(BaseProductUnit.product_id == product_id))
    items = [u for u in units if (u.get("unit_id") or 0) > 0]
    if not any(u.get("is_default") for u in items):
        items.append({"unit_id": unit_id, "rate": "1", "is_default": 1})
    for u in items:
        uid = u["unit_id"]
        if db.get(BaseUnit, uid) is None:
            raise BizError(E_PARAM, f"单位 id={uid} 不存在")
        db.add(
            BaseProductUnit(
                product_id=product_id,
                unit_id=uid,
                rate=_parse_dec(u.get("rate", "1"), "换算率"),
                is_default=1 if u.get("is_default") else 0,
            )
        )


@router.get("/products")
def list_products(
    keyword: str = Query("", max_length=100),
    category_id: int = Query(0),
    barcode: str = Query("", max_length=50),
    status: int = Query(1, description="1 启用（默认） / 0 停用；全部数据见导出接口"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> dict:
    stmt = select(BaseProduct)
    if keyword:
        like = f"%{keyword}%"
        stmt = stmt.where(or_(BaseProduct.name.like(like), BaseProduct.code.like(like), BaseProduct.sku.like(like), BaseProduct.barcode.like(like)))
    if category_id:
        stmt = stmt.where(BaseProduct.category_id == category_id)
    if barcode:
        stmt = stmt.where(BaseProduct.barcode == barcode)
    if status is not None:
        stmt = stmt.where(BaseProduct.status == status)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(BaseProduct.id.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return ok(PageData(
        list=[_product_out(db, p) for p in rows],
        total=total, page=page, page_size=page_size,
    ).model_dump())


@router.post("/products", dependencies=[Depends(require_permission("base:product"))])
def create_product(req: ProductReq, db: Session = Depends(get_db)) -> dict:
    if db.scalar(select(BaseProduct.id).where(BaseProduct.code == req.code)):
        raise BizError(E_PARAM, "商品编码已存在")
    if db.get(BaseUnit, req.unit_id) is None:
        raise BizError(E_PARAM, "基本单位不存在")
    p = BaseProduct(
        code=req.code, barcode=req.barcode, sku=req.sku, name=req.name,
        category_id=req.category_id, spec=req.spec, unit_id=req.unit_id,
        purchase_price=_parse_dec(req.purchase_price, "进价"),
        min_stock=_parse_dec(req.min_stock, "下限"), max_stock=_parse_dec(req.max_stock, "上限"),
        image_file_id=req.image_file_id, remark=req.remark,
    )
    db.add(p)
    db.flush()
    try:
        _apply_units(db, p.id, req.unit_id, [u.model_dump() for u in req.units])
        db.commit()
    except IntegrityError:
        db.rollback()
        raise BizError(E_PARAM, "商品编码已存在")
    return ok(_product_out(db, db.get(BaseProduct, p.id)))


@router.get("/products/{product_id}")
def get_product(product_id: int, db: Session = Depends(get_db)) -> dict:
    p = db.get(BaseProduct, product_id)
    if p is None:
        raise BizError(E_NOT_FOUND, "商品不存在")
    return ok(_product_out(db, p))


@router.put("/products/{product_id}", dependencies=[Depends(require_permission("base:product"))])
def update_product(product_id: int, req: ProductReq, db: Session = Depends(get_db)) -> dict:
    p = db.get(BaseProduct, product_id)
    if p is None:
        raise BizError(E_NOT_FOUND, "商品不存在")
    if db.scalar(select(BaseProduct.id).where(BaseProduct.code == req.code, BaseProduct.id != product_id)):
        raise BizError(E_PARAM, "商品编码已存在")
    for k, v in req.model_dump(exclude={"units"}).items():
        setattr(p, k, _parse_dec(v, k) if k in ("purchase_price", "min_stock", "max_stock") else v)
    try:
        _apply_units(db, p.id, req.unit_id, [u.model_dump() for u in req.units])
        db.commit()
    except IntegrityError:
        db.rollback()
        raise BizError(E_PARAM, "商品编码已存在")
    return ok()


@router.delete("/products/{product_id}", dependencies=[Depends(require_permission("base:product"))])
def delete_product(product_id: int, db: Session = Depends(get_db)) -> dict:
    p = db.get(BaseProduct, product_id)
    if p is None:
        raise BizError(E_NOT_FOUND, "商品不存在")
    p.status = 0  # 软删除：停用
    db.commit()
    return ok()


def _product_export_rows(db: Session) -> list[list]:
    rows = db.scalars(select(BaseProduct).order_by(BaseProduct.id)).all()
    out = []
    for p in rows:
        cat = db.get(BaseCategory, p.category_id)
        unit = db.get(BaseUnit, p.unit_id)
        out.append([
            p.code, p.barcode, p.sku, p.name, cat.name if cat else "",
            p.spec, unit.name if unit else "", format(p.purchase_price, "f"),
            format(p.min_stock, "f"), format(p.max_stock, "f"),
            "启用" if p.status == 1 else "停用",
        ])
    return out


@static_router.get("/products/import-template", dependencies=[Depends(require_permission("base:product"))])
def product_import_template() -> StreamingResponse:
    wb = Workbook()
    ws = wb.active
    ws.title = "商品导入"
    ws.append(PRODUCT_IMPORT_COLUMNS)
    ws.append(["P001", "6901234567890", "SKU001", "示例商品", "五金件", "M8x30", "件", "1.50", "10", "1000"])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": "attachment; filename=product_import_template.xlsx"})


@router.post("/products/import", dependencies=[Depends(require_permission("base:product"))])
async def import_products(file: UploadFile = File(...), db: Session = Depends(get_db)) -> dict:
    data = await file.read()
    wb = load_workbook(io.BytesIO(data), read_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        raise BizError(E_PARAM, "文件为空")
    headers = [str(h).strip() if h else "" for h in rows[0]]
    if headers[:10] != PRODUCT_IMPORT_COLUMNS:
        raise BizError(E_PARAM, f"表头必须为：{'/'.join(PRODUCT_IMPORT_COLUMNS)}")
    success, fail_rows = 0, []
    for idx, row in enumerate(rows[1:], start=2):
        vals = [str(v).strip() if v is not None else "" for v in row] + [""] * 10
        code, name, unit_name = vals[0], vals[3], vals[6]
        if not code or not name:
            fail_rows.append({"row": idx, "reason": "编码或名称为空"})
            continue
        if db.scalar(select(BaseProduct.id).where(BaseProduct.code == code)):
            fail_rows.append({"row": idx, "reason": f"编码 {code} 已存在"})
            continue
        # 单位：存在则复用，不存在自动创建（默认单位）
        unit = db.scalar(select(BaseUnit).where(BaseUnit.name == unit_name)) if unit_name else None
        if unit is None:
            unit = BaseUnit(name=unit_name or "件", remark="导入自动创建")
            db.add(unit)
            db.flush()
        # 分类：存在则复用，不存在自动创建（顶级）
        cat_name = vals[4]
        cat = db.scalar(select(BaseCategory).where(BaseCategory.name == cat_name, BaseCategory.parent_id == 0)) if cat_name else None
        if cat is None and cat_name:
            cat = BaseCategory(parent_id=0, name=cat_name, path="/")
            db.add(cat)
            db.flush()
        try:
            p = BaseProduct(
                code=code, barcode=vals[1], sku=vals[2], name=name,
                category_id=cat.id if cat else 0, spec=vals[5], unit_id=unit.id,
                purchase_price=Decimal(vals[7]) if _DECIMAL_RE.match(vals[7]) else Decimal(0),
                min_stock=Decimal(vals[8]) if _DECIMAL_RE.match(vals[8]) else Decimal(0),
                max_stock=Decimal(vals[9]) if _DECIMAL_RE.match(vals[9]) else Decimal(0),
            )
            db.add(p)
            db.flush()
            db.add(BaseProductUnit(product_id=p.id, unit_id=unit.id, rate=Decimal(1), is_default=1))
            success += 1
        except IntegrityError:
            db.rollback()
            fail_rows.append({"row": idx, "reason": f"编码 {code} 已存在"})
    db.commit()
    return ok({"success_count": success, "fail_rows": fail_rows})


@static_router.get("/products/export", dependencies=[Depends(require_permission("base:product"))])
def export_products(db: Session = Depends(get_db)) -> StreamingResponse:
    wb = Workbook()
    ws = wb.active
    ws.title = "商品"
    ws.append(PRODUCT_IMPORT_COLUMNS + ["状态"])
    for row in _product_export_rows(db):
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": "attachment; filename=products.xlsx"})


# ============================ 仓库 / 货架 / 库位 ============================


@router.get("/warehouses")
def list_warehouses(db: Session = Depends(get_db)) -> dict:
    rows = db.scalars(select(BaseWarehouse).order_by(BaseWarehouse.id)).all()
    return ok([WarehouseOut.model_validate(w, from_attributes=True).model_dump() for w in rows])


@router.post("/warehouses", dependencies=[Depends(require_permission("base:warehouse"))])
def create_warehouse(req: WarehouseReq, db: Session = Depends(get_db)) -> dict:
    if db.scalar(select(BaseWarehouse.id).where(BaseWarehouse.code == req.code)):
        raise BizError(E_PARAM, "仓库编码已存在")
    w = BaseWarehouse(**req.model_dump())
    db.add(w)
    db.commit()
    db.refresh(w)
    return ok(WarehouseOut.model_validate(w, from_attributes=True).model_dump())


@router.put("/warehouses/{wh_id}", dependencies=[Depends(require_permission("base:warehouse"))])
def update_warehouse(wh_id: int, req: WarehouseReq, db: Session = Depends(get_db)) -> dict:
    w = db.get(BaseWarehouse, wh_id)
    if w is None:
        raise BizError(E_NOT_FOUND, "仓库不存在")
    if db.scalar(select(BaseWarehouse.id).where(BaseWarehouse.code == req.code, BaseWarehouse.id != wh_id)):
        raise BizError(E_PARAM, "仓库编码已存在")
    for k, v in req.model_dump().items():
        setattr(w, k, v)
    db.commit()
    return ok()


@router.delete("/warehouses/{wh_id}", dependencies=[Depends(require_permission("base:warehouse"))])
def delete_warehouse(wh_id: int, db: Session = Depends(get_db)) -> dict:
    w = db.get(BaseWarehouse, wh_id)
    if w is None:
        raise BizError(E_NOT_FOUND, "仓库不存在")
    shelf_cnt = db.scalar(select(func.count()).select_from(BaseShelf).where(BaseShelf.warehouse_id == wh_id)) or 0
    if shelf_cnt:
        raise BizError(E_PARAM, "仓库下存在货架，禁止删除")
    w.status = 0  # 软删除
    db.commit()
    return ok()


@router.get("/warehouses/{wh_id}/shelves")
def list_shelves(wh_id: int, db: Session = Depends(get_db)) -> dict:
    rows = db.scalars(select(BaseShelf).where(BaseShelf.warehouse_id == wh_id).order_by(BaseShelf.code)).all()
    return ok([ShelfOut.model_validate(s, from_attributes=True).model_dump() for s in rows])


@router.post("/shelves", dependencies=[Depends(require_permission("base:warehouse"))])
def create_shelf(req: ShelfReq, db: Session = Depends(get_db)) -> dict:
    if db.get(BaseWarehouse, req.warehouse_id) is None:
        raise BizError(E_PARAM, "仓库不存在")
    dup = db.scalar(select(BaseShelf.id).where(BaseShelf.warehouse_id == req.warehouse_id, BaseShelf.code == req.code))
    if dup:
        raise BizError(E_PARAM, "同仓库下货架编码已存在")
    s = BaseShelf(**req.model_dump())
    db.add(s)
    db.commit()
    db.refresh(s)
    return ok(ShelfOut.model_validate(s, from_attributes=True).model_dump())


@router.put("/shelves/{shelf_id}", dependencies=[Depends(require_permission("base:warehouse"))])
def update_shelf(shelf_id: int, req: ShelfReq, db: Session = Depends(get_db)) -> dict:
    s = db.get(BaseShelf, shelf_id)
    if s is None:
        raise BizError(E_NOT_FOUND, "货架不存在")
    for k, v in req.model_dump().items():
        setattr(s, k, v)
    db.commit()
    return ok()


@router.delete("/shelves/{shelf_id}", dependencies=[Depends(require_permission("base:warehouse"))])
def delete_shelf(shelf_id: int, db: Session = Depends(get_db)) -> dict:
    s = db.get(BaseShelf, shelf_id)
    if s is None:
        raise BizError(E_NOT_FOUND, "货架不存在")
    loc_cnt = db.scalar(select(func.count()).select_from(BaseLocation).where(BaseLocation.shelf_id == shelf_id)) or 0
    if loc_cnt:
        raise BizError(E_PARAM, "货架下存在库位，禁止删除")
    db.delete(s)
    db.commit()
    return ok()


@router.get("/locations")
def list_locations(
    warehouse_id: int = Query(0),
    shelf_id: int = Query(0),
    db: Session = Depends(get_db),
) -> dict:
    stmt = select(BaseLocation)
    if warehouse_id:
        stmt = stmt.where(BaseLocation.warehouse_id == warehouse_id)
    if shelf_id:
        stmt = stmt.where(BaseLocation.shelf_id == shelf_id)
    rows = db.scalars(stmt.order_by(BaseLocation.code)).all()
    return ok([LocationOut.model_validate(l, from_attributes=True).model_dump() for l in rows])


@router.post("/locations", dependencies=[Depends(require_permission("base:stock-location"))])
def create_location(req: LocationReq, db: Session = Depends(get_db)) -> dict:
    shelf = db.get(BaseShelf, req.shelf_id)
    if shelf is None:
        raise BizError(E_PARAM, "货架不存在")
    if shelf.warehouse_id != req.warehouse_id:
        raise BizError(E_PARAM, "货架与仓库不匹配")
    wh = db.get(BaseWarehouse, req.warehouse_id)
    code = req.code or f"{wh.code}-{shelf.code}-{req.layer_no:02d}"
    if db.scalar(select(BaseLocation.id).where(BaseLocation.code == code)):
        raise BizError(E_PARAM, f"库位编码 {code} 已存在")
    loc = BaseLocation(warehouse_id=req.warehouse_id, shelf_id=req.shelf_id, layer_no=req.layer_no, code=code, remark=req.remark)
    db.add(loc)
    db.commit()
    db.refresh(loc)
    return ok(LocationOut.model_validate(loc, from_attributes=True).model_dump())


@router.put("/locations/{loc_id}", dependencies=[Depends(require_permission("base:stock-location"))])
def update_location(loc_id: int, req: LocationReq, db: Session = Depends(get_db)) -> dict:
    loc = db.get(BaseLocation, loc_id)
    if loc is None:
        raise BizError(E_NOT_FOUND, "库位不存在")
    for k, v in req.model_dump().items():
        setattr(loc, k, v)
    db.commit()
    return ok()


@router.delete("/locations/{loc_id}", dependencies=[Depends(require_permission("base:stock-location"))])
def delete_location(loc_id: int, db: Session = Depends(get_db)) -> dict:
    loc = db.get(BaseLocation, loc_id)
    if loc is None:
        raise BizError(E_NOT_FOUND, "库位不存在")
    stock_cnt = db.execute(text("SELECT COUNT(*) FROM stk_stock WHERE location_id = :id"), {"id": loc_id}).scalar() or 0
    if stock_cnt:
        raise BizError(E_PARAM, "库位存在库存，禁止删除")
    db.delete(loc)
    db.commit()
    return ok()
