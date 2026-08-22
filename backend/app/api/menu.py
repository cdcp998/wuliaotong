"""导航管理（动态菜单）：菜单树 CRUD + 按角色权限动态返回可见菜单（《需求》动态导航）。

规则：
- 可见性 = visible=1 且（未绑定权限码=公开，或绑定的权限码（逗号分隔=任一）用户拥有）
- 不同角色登录后仅看到被授权的菜单；前端据此动态渲染侧边导航
"""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.auth import _permission_codes
from app.core.deps import get_current_user, require_permission
from app.core.response import BizError, E_NOT_FOUND, E_PARAM, ok
from app.db import get_db
from app.models.sys import SysMenu, SysUser
from app.schemas.menu import MenuNodeOut, MenuReq

from fastapi import APIRouter, Depends

router = APIRouter(tags=["导航管理"], dependencies=[Depends(get_current_user)])

MAX_MENU_DEPTH = 4  # 菜单层级上限（顶级分组=1 层）


def _menu_tree(menus: list[SysMenu]) -> list[dict]:
    """按 parent_id 构建多级树（调用方已排序）。"""
    nodes: dict[int, dict] = {}
    for m in menus:
        nodes[m.id] = MenuNodeOut(
            id=m.id, parent_id=m.parent_id, name=m.name, path=m.path, icon=m.icon,
            perm_code=m.perm_code, visible=m.visible, sort=m.sort, remark=m.remark,
        ).model_dump()
        nodes[m.id]["children"] = []
    tree: list[dict] = []
    for m in menus:
        node = nodes[m.id]
        if m.parent_id and m.parent_id in nodes:
            nodes[m.parent_id]["children"].append(node)
        else:
            tree.append(node)
    return tree


def _depth(db: Session, menu: SysMenu) -> int:
    """菜单层级（顶级=1）。"""
    d = 1
    cur = menu
    seen = 0
    while cur.parent_id and seen < MAX_MENU_DEPTH + 2:
        parent = db.get(SysMenu, cur.parent_id)
        if parent is None:
            break
        d += 1
        cur = parent
        seen += 1
    return d


def _is_descendant(db: Session, node_id: int, ancestor_id: int) -> bool:
    """node_id 是否为 ancestor_id 的子孙（防环）。"""
    cur = db.get(SysMenu, node_id)
    seen = 0
    while cur and cur.parent_id and seen < MAX_MENU_DEPTH + 2:
        if cur.parent_id == ancestor_id:
            return True
        cur = db.get(SysMenu, cur.parent_id)
        seen += 1
    return False


@router.get("/menus")
def my_menus(user: SysUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    """当前用户可见菜单树（动态导航渲染）：visible=1 且权限匹配；无子项的父级自动剔除。"""
    perms = set(_permission_codes(db, user))
    all_menus = db.scalars(select(SysMenu).order_by(SysMenu.sort, SysMenu.id)).all()

    def _visible(m: SysMenu) -> bool:
        if m.visible != 1:
            return False
        if not m.perm_code:
            return True  # 公开菜单
        return any(code in perms for code in (c.strip() for c in m.perm_code.split(",") if c.strip()))

    visible_ids = {m.id for m in all_menus if _visible(m)}
    # 保留规则：真叶子（全树无子项）可见即保留；分组仅在「有可见子项」时保留（空分组剔除）
    keep = set()
    for m in all_menus:
        if m.id not in visible_ids:
            continue
        all_kids = [c for c in all_menus if c.parent_id == m.id]
        if not all_kids:
            keep.add(m.id)  # 真叶子可见
        elif any(c.id in visible_ids for c in all_kids):
            keep.add(m.id)  # 分组有可见子项
    tree_menus = [m for m in all_menus if m.id in keep]
    return ok(_menu_tree(tree_menus))


@router.get("/menus/all", dependencies=[Depends(require_permission("sys:role"))])
def all_menus(db: Session = Depends(get_db)) -> dict:
    """全量菜单树（导航管理页用，含隐藏项）。"""
    menus = db.scalars(select(SysMenu).order_by(SysMenu.sort, SysMenu.id)).all()
    return ok(_menu_tree(list(menus)))


@router.post("/menus", dependencies=[Depends(require_permission("sys:role"))])
def create_menu(req: MenuReq, db: Session = Depends(get_db)) -> dict:
    """新建菜单/分组。"""
    if req.parent_id:
        parent = db.get(SysMenu, req.parent_id)
        if parent is None:
            raise BizError(E_PARAM, "父级菜单不存在")
        if _depth(db, parent) >= MAX_MENU_DEPTH:
            raise BizError(E_PARAM, f"菜单最多 {MAX_MENU_DEPTH} 级")
    m = SysMenu(**req.model_dump())
    db.add(m)
    db.commit()
    db.refresh(m)
    return ok(MenuNodeOut.model_validate(m, from_attributes=True).model_dump())


@router.put("/menus/{menu_id}", dependencies=[Depends(require_permission("sys:role"))])
def update_menu(menu_id: int, req: MenuReq, db: Session = Depends(get_db)) -> dict:
    """编辑菜单；支持调整父级（校验层级上限与防环）。"""
    m = db.get(SysMenu, menu_id)
    if m is None:
        raise BizError(E_NOT_FOUND, "菜单不存在")
    if req.parent_id == menu_id:
        raise BizError(E_PARAM, "父级不能是自己")
    if req.parent_id and req.parent_id != m.parent_id:
        parent = db.get(SysMenu, req.parent_id)
        if parent is None:
            raise BizError(E_PARAM, "父级菜单不存在")
        if _is_descendant(db, parent.id, menu_id):
            raise BizError(E_PARAM, "父级不能是自己的子菜单")
        if _depth(db, parent) >= MAX_MENU_DEPTH:
            raise BizError(E_PARAM, f"菜单最多 {MAX_MENU_DEPTH} 级")
    for k, v in req.model_dump().items():
        setattr(m, k, v)
    db.commit()
    return ok()


@router.delete("/menus/{menu_id}", dependencies=[Depends(require_permission("sys:role"))])
def delete_menu(menu_id: int, db: Session = Depends(get_db)) -> dict:
    """删除菜单；有子菜单禁止删除（先删子级）。"""
    m = db.get(SysMenu, menu_id)
    if m is None:
        raise BizError(E_NOT_FOUND, "菜单不存在")
    child_cnt = db.scalar(select(func.count()).select_from(SysMenu).where(SysMenu.parent_id == menu_id)) or 0
    if child_cnt:
        raise BizError(E_PARAM, "存在子菜单，禁止删除（请先删除子菜单）")
    db.delete(m)
    db.commit()
    return ok()
