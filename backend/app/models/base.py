"""基础资料 ORM 模型（对应《数据库设计.md》§2.3，8 张表）。"""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy import BigInteger, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.sys import TimestampMixin


class BaseSupplier(TimestampMixin, Base):
    __tablename__ = "base_supplier"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(30), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    contact: Mapped[str] = mapped_column(String(50), nullable=False, default="")
    phone: Mapped[str] = mapped_column(String(20), nullable=False, default="")
    address: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    remark: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    status: Mapped[int] = mapped_column(Integer, nullable=False, default=1)  # 1启用 0停用


class BaseCategory(TimestampMixin, Base):
    __tablename__ = "base_category"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    parent_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    name: Mapped[str] = mapped_column(String(50), nullable=False)
    path: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    sort: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class BaseProduct(TimestampMixin, Base):
    __tablename__ = "base_product"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)  # 商品编码（纯数字）
    material_code: Mapped[str] = mapped_column(String(50), nullable=False, default="")  # 物料编码（公司系统编码，可空，空则提示管理员补录）
    barcode: Mapped[str] = mapped_column(String(50), nullable=False, default="")
    sku: Mapped[str] = mapped_column(String(50), nullable=False, default="")
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    category_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    spec: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    unit_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    purchase_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    min_stock: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False, default=0)
    max_stock: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False, default=0)
    image_file_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    status: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    remark: Mapped[str] = mapped_column(String(255), nullable=False, default="")


class BaseUnit(TimestampMixin, Base):
    __tablename__ = "base_unit"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(20), nullable=False, unique=True)
    remark: Mapped[str] = mapped_column(String(100), nullable=False, default="")


class BaseProductUnit(Base):
    __tablename__ = "base_product_unit"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    product_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    unit_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    rate: Mapped[Decimal] = mapped_column(Numeric(12, 4), nullable=False, default=1)
    is_default: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class BaseProductSupplier(Base):
    """材料-供应商多对多关联（材料可关联多家供应商）。"""

    __tablename__ = "base_product_supplier"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    product_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    supplier_id: Mapped[int] = mapped_column(BigInteger, nullable=False)


class BaseWarehouse(TimestampMixin, Base):
    __tablename__ = "base_warehouse"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(30), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    address: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    manager_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    remark: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    status: Mapped[int] = mapped_column(Integer, nullable=False, default=1)


class BaseDepartment(TimestampMixin, Base):
    """组织单位（部门）：角色所属单位，关联可用货架。"""

    __tablename__ = "base_department"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(30), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    remark: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    status: Mapped[int] = mapped_column(Integer, nullable=False, default=1)


class BaseDepartmentShelf(Base):
    """单位-货架关联：单位下可用显示的仓库货架。"""

    __tablename__ = "base_department_shelf"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    department_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    shelf_id: Mapped[int] = mapped_column(BigInteger, nullable=False)


class BaseShelf(TimestampMixin, Base):
    __tablename__ = "base_shelf"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    warehouse_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    code: Mapped[str] = mapped_column(String(30), nullable=False)
    name: Mapped[str] = mapped_column(String(50), nullable=False, default="")
    remark: Mapped[str] = mapped_column(String(255), nullable=False, default="")


class BaseLocation(TimestampMixin, Base):
    __tablename__ = "base_location"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    warehouse_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    shelf_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    layer_no: Mapped[int] = mapped_column(Integer, nullable=False)
    code: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    remark: Mapped[str] = mapped_column(String(255), nullable=False, default="")
