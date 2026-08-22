import { useCallback, useEffect, useMemo, useState } from "react";
import { App, AutoComplete, Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Tag, Tree, theme } from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
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
].map((v) => ({ value: v, label: v }));

/** 已注册的路由（main.tsx 中存在的页面路径；菜单 path 必须指向其一才能导航）。 */
const ROUTE_OPTIONS = [
  "/dashboard", "/reports", "/warehouses", "/materials-data", "/delete-reviews",
  "/suppliers", "/units", "/system/settings", "/system/users", "/system/roles",
  "/system/logs", "/system/backups", "/system/register-applies", "/system/departments",
  "/system/menus", "/transfers", "/checks", "/other-io", "/history-price",
  "/requisitions/apply", "/requisitions/query", "/requisitions",
  "/purchase-in", "/purchase-plans", "/stock", "/ocr/delivery", "/ai-suggestions", "/llm-logs",
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

/** 导航管理（电脑端，sys:role）：动态菜单树 CRUD —— 名称/图标/路由/权限码/显示隐藏/排序/多级。 */
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
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span>{n.name}</span>
          {n.path && <Tag style={{ fontSize: 11, marginInlineEnd: 0, color: "#1668dc", background: "#f0f7ff", borderColor: "#bcd9ff" }}>{n.path}</Tag>}
          {n.perm_code ? <Tag style={{ fontSize: 11, marginInlineEnd: 0 }}>{n.perm_code}</Tag> : <Tag style={{ fontSize: 11, marginInlineEnd: 0 }} color="green">公开</Tag>}
          {n.visible === 0 && <Tag color="red" style={{ fontSize: 11, marginInlineEnd: 0 }}>已隐藏</Tag>}
          <span style={{ opacity: 0.6 }}>
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
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>导航管理</h2>
          <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "#646a73" }}>
            动态控制左侧导航：多级菜单树 · 名称/图标/路由 · 显示隐藏 · 绑定权限码（逗号分隔=任一命中可见，空=公开）；不同角色仅见被授权菜单
          </p>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreate(0)}>新建顶级分组</Button>
        </Space>
      </div>

      <div style={{ border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 10, padding: 16, background: token.colorBgContainer }}>
        <Tree
          showIcon
          blockNode
          defaultExpandAll
          treeData={treeData}
          selectable={false}
          style={{ background: "transparent" }}
        />
        {!tree.length && !loading && <div style={{ color: "#646a73", textAlign: "center", padding: 32 }}>暂无菜单，点击「新建顶级分组」开始</div>}
      </div>

      {/* 新建 / 编辑 */}
      <Modal
        title={editing ? `编辑菜单：${editing.name}` : parentPreset !== 0 ? "新建子菜单" : "新建顶级分组"}
        open={open}
        onOk={() => void save()}
        onCancel={() => setOpen(false)}
        confirmLoading={saving}
        width={520}
        destroyOnHidden
        afterOpenChange={(o) => {
          if (!o) return;
          if (editing) {
            form.setFieldsValue({ parent_id: editing.parent_id, name: editing.name, path: editing.path, icon: editing.icon, perm_code: editing.perm_code, visible: editing.visible === 1, sort: editing.sort, remark: editing.remark });
          } else {
            form.resetFields();
            form.setFieldsValue({ parent_id: parentPreset, visible: true, sort: 0 });
          }
        }}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="parent_id" label="上级" rules={[{ required: true, message: "请选择上级" }]} extra="顶级分组=一级；菜单挂到分组下，可再嵌套">
            <Select options={parentOptions} />
          </Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: "请输入名称" }, { max: 50, message: "不超过 50 字" }]}>
            <Input placeholder="如 库存查询" maxLength={50} />
          </Form.Item>
          <Space size={12} style={{ display: "flex" }} align="start">
            <Form.Item name="path" label="路由（分组留空）" style={{ flex: 1 }}>
              <AutoComplete placeholder="从已注册路由选择或手输" options={ROUTE_OPTIONS} filterOption={(input, o) => (o?.value ?? "").toLowerCase().includes(input.toLowerCase())} />
            </Form.Item>
            <Form.Item name="icon" label="图标">
              <Select style={{ width: 190 }} showSearch placeholder="选择图标" options={ICON_OPTIONS} optionFilterProp="label" />
            </Form.Item>
          </Space>
          <Form.Item name="perm_code" label="绑定权限码（逗号分隔=任一命中可见；留空=公开）" extra="从现有权限点选择，或手输多个权限码">
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
        </Form>
      </Modal>
    </div>
  );
}
