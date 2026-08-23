import { useCallback, useEffect, useMemo, useState } from "react";
import { App, AutoComplete, Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Tag, theme, Tree } from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined, MenuOutlined, CheckOutlined, CloseOutlined, AppstoreOutlined } from "@ant-design/icons";
import type { DataNode } from "antd/es/tree";

import { adminApi, menuApi, useAuthStore, type MenuNode } from "@wlt/shared";

import { ICON_MAP } from "../components/AppLayout";

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

/** 判断菜单项当前用户是否可见（无权限码=公开；逗号分隔任一命中；管理员全可见）。 */
function menuVisible(node: MenuNode, hasAnyPerm: (cs: string[]) => boolean, isSuper: boolean): boolean {
  if (isSuper || !node.perm_code) return true;
  const codes = node.perm_code.split(",").map((s) => s.trim()).filter(Boolean);
  if (!codes.length) return true;
  return hasAnyPerm(codes);
}

/** 图标（字符串名）→ 组件。 */
function ic(name?: string): React.ReactNode {
  return (name && ICON_MAP[name]) || <AppstoreOutlined />;
}

/** 导航管理（电脑端，sys:role）：左菜单树 + 中侧边栏实时预览（无权限灰化）+ 弹窗编辑（《UI设计方案.md》v2）。 */
export function MenusPage() {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const hasAnyPerm = useAuthStore((s) => s.hasAnyPerm);
  const isSuper = useAuthStore((s) => s.user?.role?.code === "super_admin");
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

  const treeData = useMemo(() => treeDataOf(tree), [tree, token]);

  function treeDataOf(nodes: MenuNode[]): DataNode[] {
    return nodes.map((n) => ({
      key: String(n.id),
      title: (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap", width: "100%" }}>
          <span style={{ fontWeight: 600 }}>{n.name}</span>
          {n.path && <Tag style={{ fontSize: 11, marginInlineEnd: 0, color: "#3B5BDB", background: "#EAEFFF", borderColor: "transparent", borderRadius: 999 }}>{n.path}</Tag>}
          {n.perm_code
            ? <Tag style={{ fontSize: 11, marginInlineEnd: 0, color: "#5B6478", background: "#EFF3FC", borderColor: "transparent", borderRadius: 999 }}>{n.perm_code}</Tag>
            : <Tag style={{ fontSize: 11, marginInlineEnd: 0, color: "#15803D", background: "#E8F9EF", borderColor: "transparent", borderRadius: 999 }}>公开</Tag>}
          {n.visible === 0 && <Tag style={{ fontSize: 11, marginInlineEnd: 0, color: "#DC2626", background: "#FDEBEC", borderColor: "transparent", borderRadius: 999 }}>已隐藏</Tag>}
          <span style={{ marginLeft: "auto", opacity: 0.7 }}>
            <Button type="text" size="small" icon={<PlusOutlined style={{ color: "#5B7FFF" }} />} title="新建子菜单" onClick={(e) => { e.stopPropagation(); openCreate(n.id); }} />
            <Button type="text" size="small" icon={<EditOutlined style={{ color: "#5B7FFF" }} />} title="编辑" onClick={(e) => { e.stopPropagation(); openEdit(n); }} />
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
    form.resetFields();
    form.setFieldsValue({ parent_id: parentId, visible: true, sort: 0 });
    setOpen(true);
  }

  function openEdit(n: MenuNode) {
    setEditing(n);
    setParentPreset(n.parent_id);
    form.resetFields();
    form.setFieldsValue({
      parent_id: n.parent_id,
      name: n.name,
      path: n.path ?? "",
      icon: n.icon ?? "",
      perm_code: n.perm_code ?? "",
      visible: n.visible !== 0,
      sort: n.sort ?? 0,
      remark: n.remark ?? "",
    });
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

  /** 侧边栏实时预览：按当前用户权限渲染导航，无权限项灰化（菜单文本前用 id-preview 标识）。 */
  function renderPreview(nodes: MenuNode[]): React.ReactNode {
    return nodes.map((n) => {
      const isGroup = (n.children?.length ?? 0) > 0;
      const hasChildrenVisible = n.children?.some((c) => menuVisible(c, hasAnyPerm, isSuper) && c.visible !== 0);
      if (isGroup && !hasChildrenVisible) return null;
      const visible = n.visible !== 0;
      const canSee = menuVisible(n, hasAnyPerm, isSuper);
      const dim = !canSee || !visible;
      return (
        <div key={String(n.id)} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 8, background: isGroup ? "rgba(91,127,255,.04)" : "transparent", opacity: dim ? 0.4 : 1, fontWeight: isGroup ? 700 : 500, fontSize: isGroup ? 13 : 12.5, color: isGroup ? "#1E2433" : "#5B6478" }}>
            <span style={{ color: "#5B7FFF" }}>{ic(n.icon)}</span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.name}</span>
            {!canSee && <span style={{ marginLeft: "auto", fontSize: 10, color: token.colorTextTertiary }}>无权限</span>}
            {n.visible === 0 && <span style={{ marginLeft: canSee ? "auto" : 6, fontSize: 10, color: token.colorError }}>已隐藏</span>}
          </div>
          {isGroup && (
            <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingLeft: 26, borderLeft: `1px dashed ${token.colorBorder}` }}>
              {n.children?.map((c) => {
                const cVisible = menuVisible(c, hasAnyPerm, isSuper);
                const cDim = !cVisible || c.visible === 0;
                return (
                  <div key={String(c.id)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 8, opacity: cDim ? 0.4 : 1, fontSize: 12.5, color: "#5B6478" }}>
                    <span style={{ color: "#5B7FFF", width: 16, display: "inline-flex" }}>{ic(c.icon)}</span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                    {!cVisible && <span style={{ marginLeft: "auto", fontSize: 10, color: token.colorTextTertiary }}>无权限</span>}
                    {c.visible === 0 && <span style={{ marginLeft: cVisible ? "auto" : 6, fontSize: 10, color: token.colorError }}>已隐藏</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    });
  }

  return (
    <div style={{ padding: 24 }}>
      {/* 页头 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>导航管理</h2>
          <p style={{ margin: "6px 0 0", fontSize: 12.5, color: token.colorTextSecondary }}>
            左侧菜单树 · 右侧侧边栏预览 · 编辑以弹窗打开（新建/编辑/删除均弹窗确认）
          </p>
        </div>
        <Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreate(0)}>新建顶级分组</Button>
        </Space>
      </div>

      <div style={{ display: "flex", gap: 16, alignItems: "stretch", flexWrap: "wrap" }}>
        {/* 左：菜单树 */}
        <div className="wlt-glass" style={{ flex: 1, minWidth: 360, padding: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <MenuOutlined style={{ color: token.colorPrimary }} />
            <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>菜单树（{flat.length} 节点）</span>
          </div>
          <Tree
            key={String(tree.length)}
            className="wlt-menu-tree"
            showIcon
            blockNode
            showLine
            defaultExpandAll
            treeData={treeData}
            selectable={false}
            style={{ background: "transparent" }}
          />
          {!tree.length && !loading && <div style={{ color: token.colorTextTertiary, textAlign: "center", padding: 32 }}>暂无菜单，点击「新建顶级分组」开始</div>}
          <div style={{ fontSize: 11, color: token.colorTextTertiary, borderTop: `1px solid ${token.colorBorder}`, paddingTop: 10, marginTop: 10 }}>
            提示：行内 ＋ / ✎ / 🗑 快捷操作；同级排序以「排序」数值控制
          </div>
        </div>

        {/* 右：侧边栏实时预览（设计页 52：250px） */}
        <div className="wlt-glass" style={{ width: 250, padding: 14, flexShrink: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, flex: 1 }}>侧边栏预览</span>
          </div>
          <div
            style={{
              flex: 1,
              background: "#F6F8FE",
              border: `1px solid #E4EAF6`,
              borderRadius: 12,
              padding: 10,
              overflow: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 2,
              minHeight: 380,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", marginBottom: 6 }}>
              <span style={{ width: 26, height: 26, borderRadius: 8, background: "linear-gradient(135deg,#5B7FFF,#7C93FF)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700 }}>物</span>
              <span style={{ fontWeight: 700, fontSize: 13.5 }}>物料通</span>
            </div>
            {tree.length ? renderPreview(tree) : <div style={{ textAlign: "center", color: token.colorTextTertiary, padding: 32, fontSize: 12 }}>暂无菜单</div>}
          </div>
          <div style={{ fontSize: 10, color: token.colorTextTertiary, marginTop: 8, lineHeight: 1.6 }}>
            灰色 = 无权限 或 已隐藏（按角色过滤后不显示），保存后真实侧栏与此一致
          </div>
        </div>
      </div>

      {/* 弹窗编辑 */}
      <Modal
        title={editing ? `编辑菜单：${editing.name}` : parentPreset !== 0 ? `新建子菜单` : "新建顶级分组"}
        open={open}
        onOk={() => void save()}
        okText="保存菜单"
        confirmLoading={saving}
        onCancel={() => setOpen(false)}
        okButtonProps={{ icon: <CheckOutlined /> }}
        cancelButtonProps={{ icon: <CloseOutlined /> }}
        width={440}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" style={{ marginTop: 4 }}>
          <Form.Item name="parent_id" label="上级" rules={[{ required: true, message: "请选择上级" }]} extra="顶级分组=一级；菜单挂到分组下，可再嵌套">
            <Select options={parentOptions} />
          </Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: "请输入名称" }, { max: 50, message: "不超过 50 字" }]}>
            <Input placeholder="如 库存查询" maxLength={50} />
          </Form.Item>
          <Form.Item name="path" label="路由（分组留空）">
            <AutoComplete placeholder="从已注册路由选择或手输" options={ROUTE_OPTIONS} filterOption={(input, o) => (o?.value ?? "").toLowerCase().includes(input.toLowerCase())} />
          </Form.Item>
          <Form.Item name="icon" label="图标">
            <Select showSearch placeholder="选择图标" options={ICON_OPTIONS} optionFilterProp="label" />
          </Form.Item>
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
          <Form.Item name="remark" label="备注" style={{ marginBottom: 0 }}>
            <Input maxLength={255} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
