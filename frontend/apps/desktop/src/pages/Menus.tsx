import { useCallback, useEffect, useMemo, useState } from "react";
import { App, AutoComplete, Button, Form, Input, InputNumber, Popconfirm, Select, Space, Switch, Tag, theme, Tree } from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined, MenuOutlined, CheckOutlined, CloseOutlined } from "@ant-design/icons";
import type { DataNode } from "antd/es/tree";

import { adminApi, menuApi, type MenuNode } from "@wlt/shared";

/** 可选图标（与 AppLayout 的 ICON_MAP 保持一致）。 */
const ICON_OPTIONS = [
  "DashboardOutlined", "ShopOutlined", "AppstoreOutlined", "AuditOutlined", "ContactsOutlined",
  "NumberOutlined", "BankOutlined", "InboxOutlined", "FileTextOutlined", "FileSearchOutlined",
  "DatabaseOutlined", "TableOutlined", "LineChartOutlined", "SwapOutlined", "ExportOutlined",
  "EditOutlined", "SearchOutlined", "FundOutlined", "ProfileOutlined", "RobotOutlined",
  "SettingOutlined", "UserOutlined", "SafetyCertificateOutlined", "ApartmentOutlined",
  "HddOutlined", "MenuOutlined",
  "DeploymentUnitOutlined", "EnvironmentOutlined", "AlertOutlined", "CloudDownloadOutlined",
  "ToolOutlined", "ProjectOutlined", "UnorderedListOutlined", "ReadOutlined", "DesktopOutlined",
].map((v) => ({ value: v, label: v }));

/** 已注册的路由（main.tsx 中存在的页面路径；菜单 path 必须指向其一才能导航）。 */
const ROUTE_OPTIONS = [
  "/dashboard", "/reports", "/warehouses", "/materials-data", "/delete-reviews",
  "/suppliers", "/units", "/system/settings", "/system/users", "/system/roles",
  "/system/logs", "/system/backups", "/system/register-applies", "/system/departments",
  "/system/menus", "/transfers", "/checks", "/other-io", "/history-price",
  "/requisitions/apply", "/requisitions/query", "/requisitions",
  "/purchase-in", "/purchase-plans", "/stock", "/ocr/delivery", "/ai-suggestions", "/llm-logs",
  "/system/modules", "/cable/map", "/cable/list", "/cable/faults",
  "/task/board", "/task/list", "/knowledge", "/knowledge/write", "/device/list", "/device/tasks",
].map((v) => ({ value: v, label: v }));

/** 拍平菜单树（父级下拉 / 树渲染）。 */
function flattenMenus(nodes: MenuNode[], depth = 0): { node: MenuNode; depth: number }[] {
  const out: { node: MenuNode; depth: number }[] = [];
  for (const n of nodes) {
    out.push({ node: n, depth });
    if (n.children?.length) out.push(...flattenMenus(n.children, depth + 1));
  }
  return out;
}

/** 导航管理（电脑端，sys:role）：左侧菜单树 + 右侧编辑面板（《UI设计方案.md》v2）。 */
export function MenusPage() {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const [tree, setTree] = useState<MenuNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [perms, setPerms] = useState<{ code: string; name: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<MenuNode | null>(null);
  const [parentPreset, setParentPreset] = useState(0);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTree(await menuApi.menusAll());
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
    adminApi.permissions().then((ps) => setPerms(ps.map((p) => ({ code: p.code, name: p.name })))).catch(() => undefined);
  }, [load]);

  const flat = useMemo(() => flattenMenus(tree), [tree]);
  const parentOptions = useMemo(() => {
    const out: { value: number; label: string }[] = [{ value: 0, label: "顶级分组" }];
    for (const { node, depth } of flat) {
      if (editing && node.id === editing.id) continue; // 编辑时排除自身
      out.push({ value: node.id, label: `${"　".repeat(depth)}${node.name}` });
    }
    return out;
  }, [flat, editing]);

  const permOptions = useMemo(
    () => [
      { value: "", label: "公开（所有人可见）" },
      ...perms.map((p) => ({ value: p.code, label: `${p.name}（${p.code}）` })),
    ],
    [perms]
  );

  const treeData: DataNode[] = useMemo(() => treeDataOf(tree), [tree, token]);

  function treeDataOf(nodes: MenuNode[]): DataNode[] {
    return nodes.map((n) => ({
      key: String(n.id),
      title: (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap", width: "100%" }}>
          <span style={{ fontWeight: 600 }}>{n.name}</span>
          {n.path && <Tag style={{ fontSize: 11, marginInlineEnd: 0, color: "#3B5BDB", background: "#EAEFFF", borderColor: "transparent", borderRadius: 6 }}>{n.path}</Tag>}
          {n.perm_code ? <Tag style={{ fontSize: 11, marginInlineEnd: 0, borderRadius: 6 }}>{n.perm_code}</Tag> : <Tag style={{ fontSize: 11, marginInlineEnd: 0, borderRadius: 6 }} color="green">公开</Tag>}
          {n.visible === 0 && <Tag color="red" style={{ fontSize: 11, marginInlineEnd: 0 }}>已隐藏</Tag>}
          <span style={{ marginLeft: "auto", opacity: 0.7 }}>
            <Button type="text" size="small" icon={<PlusOutlined />} title="新建子菜单" onClick={(e) => { e.stopPropagation(); openCreate(n.id); }} />
            <Button type="text" size="small" icon={<EditOutlined />} title="编辑" onClick={(e) => { e.stopPropagation(); openEdit(n); }} />
            <Popconfirm title={`删除菜单「${n.name}」？`} description="有子菜单会被系统拒绝" onConfirm={() => void remove(n)}>
              <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={(e) => e.stopPropagation()} />
            </Popconfirm>
          </span>
        </span>
      ),
      children: n.children?.length ? treeDataOf(n.children) : undefined,
    }));
  }

  function openCreate(parentId: number) {
    setEditing(null);
    setParentPreset(parentId);
    setOpen(true);
  }

  function openEdit(n: MenuNode) {
    setEditing(n);
    setParentPreset(n.parent_id);
    setOpen(true);
  }

  async function save() {
    const v = await form.validateFields();
    const body = {
      parent_id: v.parent_id ?? 0,
      name: v.name.trim(),
      path: (v.path ?? "").trim(),
      icon: v.icon ?? "",
      perm_code: (v.perm_code ?? "").trim(),
      visible: v.visible ? 1 : 0,
      sort: v.sort ?? 0,
      remark: v.remark ?? "",
    };
    setSaving(true);
    try {
      if (editing) {
        await menuApi.update(editing.id, body);
        message.success("菜单已更新");
      } else {
        await menuApi.create(body);
        message.success("菜单已创建");
      }
      setOpen(false);
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function remove(n: MenuNode) {
    try {
      await menuApi.remove(n.id);
      message.success("菜单已删除");
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "删除失败");
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 1480, margin: "0 auto" }}>
      {/* 页头 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>导航管理</h2>
          <p style={{ margin: "6px 0 0", fontSize: 12.5, color: token.colorTextSecondary }}>
            动态控制左侧导航：多级菜单树 · 名称/图标/路由 · 显示隐藏 · 绑定权限码（逗号分隔=任一命中可见，空=公开）；不同角色仅见被授权菜单
          </p>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreate(0)}>新建顶级分组</Button>
        </Space>
      </div>

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* 左：菜单树 */}
        <div className="wlt-glass" style={{ flex: 1, minWidth: 340, padding: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <MenuOutlined style={{ color: token.colorPrimary }} />
            <span style={{ fontSize: 14, fontWeight: 700, flex: 1 }}>菜单树（点击行可选中）</span>
            <Tag style={{ marginInlineEnd: 0, borderRadius: 999 }}>{flat.length} 节点</Tag>
          </div>
          <Tree
            showIcon
            blockNode
            defaultExpandAll
            treeData={treeData}
            selectable={false}
            style={{ background: "transparent" }}
          />
          {!tree.length && !loading && <div style={{ color: token.colorTextTertiary, textAlign: "center", padding: 32 }}>暂无菜单，点击「新建顶级分组」开始</div>}
          <div style={{ fontSize: 11, color: token.colorTextTertiary, borderTop: `1px solid ${token.colorBorder}`, paddingTop: 10, marginTop: 10 }}>
            提示：拖拽图标可调整同级排序（当前以「排序」数值控制）；点击行内 + / ✎ / 🗑 快捷操作
          </div>
        </div>

        {/* 右：编辑面板 */}
        <div className="wlt-glass" style={{ width: 400, padding: 16, display: "flex", flexDirection: "column", gap: 12, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 700, flex: 1 }}>{editing ? `编辑菜单：${editing.name}` : open ? (parentPreset !== 0 ? "新建子菜单" : "新建顶级分组") : "编辑菜单"}</span>
            {editing && <Tag style={{ marginInlineEnd: 0, borderRadius: 999 }} color="blue">编辑中</Tag>}
          </div>
          {!open ? (
            <div style={{ textAlign: "center", padding: "48px 12px", color: token.colorTextTertiary, display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
              <MenuOutlined style={{ fontSize: 36, color: "#CBD6EC" }} />
              <div style={{ fontWeight: 600 }}>菜单编辑面板</div>
              <div style={{ fontSize: 12, lineHeight: 1.6 }}>点击左侧树的编辑按钮，或「新建顶级分组 / 新建子菜单」打开表单：名称 → 路由 → 图标 → 权限码 → 显示与排序</div>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreate(0)}>新建顶级分组</Button>
            </div>
          ) : (
            <Form form={form} layout="vertical" style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              <Form.Item name="parent_id" label="上级" rules={[{ required: true, message: "请选择上级" }]} extra="顶级分组=一级；菜单挂到分组下，可再嵌套" style={{ marginBottom: 12 }}>
                <Select options={parentOptions} />
              </Form.Item>
              <Form.Item name="name" label="名称" rules={[{ required: true, message: "请输入名称" }, { max: 50, message: "不超过 50 字" }]} style={{ marginBottom: 12 }}>
                <Input placeholder="如 库存查询" maxLength={50} />
              </Form.Item>
              <Form.Item name="path" label="路由（分组留空）" style={{ marginBottom: 12 }}>
                <AutoComplete placeholder="从已注册路由选择或手输" options={ROUTE_OPTIONS} filterOption={(input, o) => (o?.value ?? "").toLowerCase().includes(input.toLowerCase())} />
              </Form.Item>
              <Form.Item name="icon" label="图标" style={{ marginBottom: 12 }}>
                <Select showSearch placeholder="选择图标" options={ICON_OPTIONS} optionFilterProp="label" />
              </Form.Item>
              <Form.Item name="perm_code" label="绑定权限码（逗号分隔=任一命中可见；留空=公开）" extra="从现有权限点选择，或手输多个权限码" style={{ marginBottom: 12 }}>
                <AutoComplete placeholder="公开 / base:product / base:product,base:category" options={permOptions} filterOption={(input, o) => (o?.value ?? "").toLowerCase().includes(input.toLowerCase())} />
              </Form.Item>
              <Space size={24}>
                <Form.Item name="visible" label="显示" valuePropName="checked">
                  <Switch />
                </Form.Item>
                <Form.Item name="sort" label="排序（小在前）">
                  <InputNumber min={0} style={{ width: 120 }} />
                </Form.Item>
              </Space>
              <Form.Item name="remark" label="备注">
                <Input maxLength={255} />
              </Form.Item>
              <div style={{ display: "flex", gap: 10, borderTop: `1px solid ${token.colorBorder}`, paddingTop: 12 }}>
                <Button icon={<CloseOutlined />} style={{ width: 120 }} onClick={() => setOpen(false)}>取消</Button>
                <Button type="primary" icon={<CheckOutlined />} loading={saving} style={{ flex: 1 }} onClick={() => void save()}>保存菜单</Button>
              </div>
            </Form>
          )}
        </div>
      </div>
    </div>
  );
}
