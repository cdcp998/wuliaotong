import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Checkbox, Form, Input, Modal, Popconfirm, Select, Space, Tag, Tooltip, theme } from "antd";
import { SafetyCertificateOutlined, UserOutlined, KeyOutlined, PlusOutlined, SearchOutlined, CheckOutlined, CloseOutlined, ReloadOutlined, DeleteOutlined } from "@ant-design/icons";

import { adminApi, type Department, type SysPermission, type SysRole } from "@wlt/shared";

/** 权限点按 code 前缀分组（后端未下发 module_code，前端按约定前缀归类，插件权限点天然带前缀）。 */
const GROUP_META: Record<string, { title: string; color: string; bg: string }> = {
  base: { title: "基础资料", color: "#3B5BDB", bg: "#EAEFFF" },
  stk: { title: "库存", color: "#3B5BDB", bg: "#EAEFFF" },
  pch: { title: "采购入库", color: "#3B5BDB", bg: "#EAEFFF" },
  req: { title: "领用", color: "#0E7490", bg: "#E0F2FE" },
  ocr: { title: "拍照识别", color: "#0E7490", bg: "#E0F2FE" },
  ai: { title: "报表与 AI", color: "#7C3AED", bg: "#F3E8FF" },
  report: { title: "报表与 AI", color: "#7C3AED", bg: "#F3E8FF" },
  sys: { title: "系统管理", color: "#B45309", bg: "#FEF4E2" },
  cable: { title: "线缆与地图", color: "#0891B2", bg: "#E0F2FE" },
  fault: { title: "线缆与地图", color: "#0891B2", bg: "#E0F2FE" },
  map: { title: "线缆与地图", color: "#0891B2", bg: "#E0F2FE" },
  task: { title: "维修任务", color: "#DB2777", bg: "#FCE7F3" },
  knowledge: { title: "知识库", color: "#7C3AED", bg: "#F3E8FF" },
  device: { title: "设备", color: "#16A34A", bg: "#E8F9EF" },
};

const GROUP_ORDER = ["base", "stk", "pch", "req", "ocr", "ai", "report", "sys", "cable", "fault", "map", "task", "knowledge", "device"];

function groupKeyOf(p: SysPermission): string {
  const pre = p.code.split(":")[0];
  return GROUP_META[pre] ? pre : "other";
}

/** 用户权限设置（电脑端，超管 sys:role）：左侧角色列表 + 右侧按模块分组的权限矩阵（《UI设计方案.md》v2）。 */
export function RolesPage() {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const [list, setList] = useState<SysRole[]>([]);
  const [userTotal, setUserTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [perms, setPerms] = useState<SysPermission[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [editingPerms, setEditingPerms] = useState<SysRole | null>(null);
  const [checked, setChecked] = useState<number[]>([]);
  const [kw, setKw] = useState("");
  const [roleKw, setRoleKw] = useState("");
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [roles, permissions, users] = await Promise.all([
        adminApi.roles(),
        adminApi.permissions(),
        adminApi.users({ page: 1, page_size: 1 }).catch(() => null),
      ]);
      setList(roles);
      setPerms(permissions);
      setUserTotal(users?.total ?? 0);
      adminApi.departments().then(setDepartments).catch(() => undefined);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load().catch((e) => message.error(e instanceof Error ? e.message : "加载失败"));
  }, [load, message]);

  async function createRole() {
    const v = await form.validateFields();
    try {
      await adminApi.createRole({ code: "role" + Date.now(), name: v.name, description: v.description ?? "", department_id: v.department_id ?? 0 });
      message.success("角色已创建");
      setCreating(false);
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "创建失败");
    }
  }

  async function savePerms() {
    if (!editingPerms) return;
    try {
      await adminApi.updateRolePermissions(editingPerms.id, checked);
      message.success("权限已更新，实时生效");
      setEditingPerms(null);
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    }
  }

  const isSuperAdmin = editingPerms?.code === "super_admin";

  /** 权限分组（按 GROUP_ORDER 排序；分组内去掉与搜索无关的项）。 */
  const groups = useMemo(() => {
    const kwl = kw.trim().toLowerCase();
    const map = new Map<string, SysPermission[]>();
    for (const p of perms) {
      if (kwl && !p.name.toLowerCase().includes(kwl) && !p.code.toLowerCase().includes(kwl)) continue;
      const gk = groupKeyOf(p);
      if (!map.has(gk)) map.set(gk, []);
      map.get(gk)!.push(p);
    }
    const out: { key: string; title: string; meta: { color: string; bg: string }; items: SysPermission[] }[] = [];
    for (const k of [...GROUP_ORDER, ...map.keys()]) {
      if (k === "other") continue;
      const items = map.get(k);
      if (items?.length) out.push({ key: k, title: GROUP_META[k]?.title ?? "其他", meta: GROUP_META[k] ?? { color: "#5B6478", bg: "#F6F8FE" }, items });
    }
    const other = map.get("other");
    if (other?.length) out.push({ key: "other", title: "其他", meta: { color: "#5B6478", bg: "#F6F8FE" }, items: other });
    return out;
  }, [perms, kw]);

  const checkedSet = useMemo(() => new Set(checked), [checked]);

  const filteredRoles = useMemo(() => {
    const kwl = roleKw.trim().toLowerCase();
    return kwl ? list.filter((r) => r.name.toLowerCase().includes(kwl) || r.description.toLowerCase().includes(kwl)) : list;
  }, [list, roleKw]);

  return (
    <div style={{ padding: 24, maxWidth: 1480, margin: "0 auto" }}>
      {/* 页头 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0 }}>用户权限设置</h2>
          <p style={{ margin: "6px 0 0", fontSize: 12.5, color: token.colorTextSecondary }}>
            角色 · 权限点 · 数据范围一站式管理；权限保存后实时生效，无需重启
          </p>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>新建角色</Button>
        </Space>
      </div>

      {/* 统计卡 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginBottom: 18 }}>
        {[
          { label: "系统角色", value: list.length, unit: "个", icon: <SafetyCertificateOutlined />, hint: `内置 ${list.filter((r) => r.is_builtin === 1).length} 个` },
          { label: "系统用户", value: userTotal, unit: "人", icon: <UserOutlined />, hint: "含待审核注册" },
          { label: "权限点", value: perms.length, unit: "个", icon: <KeyOutlined />, hint: "核心 + 插件模块" },
        ].map((s) => (
          <div key={s.label} className="wlt-glass" style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12.5, color: token.colorTextSecondary, fontWeight: 500 }}>{s.label}</span>
              <span style={{ width: 30, height: 30, borderRadius: 10, background: "#EAEFFF", color: "#3B5BDB", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{s.icon}</span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span style={{ fontSize: 26, fontWeight: 700, color: token.colorText, fontVariantNumeric: "tabular-nums" }}>{s.value}</span>
              <span style={{ fontSize: 12.5, color: token.colorTextTertiary }}>{s.unit}</span>
            </div>
            <span style={{ fontSize: 11, color: token.colorTextTertiary }}>{s.hint}</span>
          </div>
        ))}
      </div>

      {/* 双区：左角色 / 右权限矩阵 */}
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* 角色列表 */}
        <div className="wlt-glass" style={{ width: 300, padding: 14, display: "flex", flexDirection: "column", gap: 10, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>角色列表</span>
            <Tag style={{ marginInlineEnd: 0, borderRadius: 999 }} color="blue">{list.length}</Tag>
          </div>
          <Input
            prefix={<SearchOutlined style={{ color: token.colorTextTertiary }} />}
            placeholder="搜索角色…"
            allowClear
            value={roleKw}
            onChange={(e) => setRoleKw(e.target.value)}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 560, overflowY: "auto" }}>
            {filteredRoles.map((r) => {
              const active = editingPerms?.id === r.id;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => {
                    if (r.code === "super_admin") {
                      message.info("超级管理员拥有全部权限，无需分配");
                      return;
                    }
                    setEditingPerms(r);
                    setChecked(r.permission_ids);
                  }}
                  style={{
                    textAlign: "left",
                    cursor: "pointer",
                    border: `1.5px solid ${active ? "#5B7FFF" : token.colorBorder}`,
                    background: active ? "#EAEFFF" : "#fff",
                    borderRadius: 12,
                    padding: "10px 12px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    transition: "border-color .2s ease, background .2s ease",
                    fontFamily: "inherit",
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
                    <span style={{ fontWeight: 700, fontSize: 13.5, color: active ? "#3B5BDB" : token.colorText, flex: 1 }}>{r.name}</span>
                    {r.is_builtin === 1 && <Tag style={{ marginInlineEnd: 0 }}>内置</Tag>}
                    {active && <CheckOutlined style={{ color: "#5B7FFF" }} />}
                    {r.is_builtin !== 1 && (
                      <Popconfirm
                        title={`删除角色「${r.name}」？`}
                        okText="删除"
                        okButtonProps={{ danger: true }}
                        cancelText="取消"
                        onConfirm={async () => {
                          try {
                            await adminApi.deleteRole(r.id);
                            message.success("已删除");
                            if (editingPerms?.id === r.id) setEditingPerms(null);
                            void load();
                          } catch (e) {
                            message.error(e instanceof Error ? e.message : "删除失败");
                          }
                        }}
                      >
                        <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={(e) => e.stopPropagation()} />
                      </Popconfirm>
                    )}
                  </span>
                  <span style={{ fontSize: 11.5, color: token.colorTextSecondary, lineHeight: 1.5 }}>{r.description || "—"}</span>
                  <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <Tag style={{ marginInlineEnd: 0, borderRadius: 999, background: "#EAEFFF", color: "#3B5BDB", borderColor: "transparent" }}>{r.code === "super_admin" ? "全部权限" : `${r.permission_ids.length} 项权限`}</Tag>
                    {r.department_name && <Tag style={{ marginInlineEnd: 0, borderRadius: 999 }}>{r.department_name}</Tag>}
                  </span>
                </button>
              );
            })}
            {!filteredRoles.length && !loading && <div style={{ textAlign: "center", color: token.colorTextTertiary, padding: 24 }}>暂无角色</div>}
          </div>
          <span style={{ fontSize: 10.5, color: token.colorTextTertiary, lineHeight: 1.5 }}>数据范围说明：单位/部门过滤在角色「所属单位」设置</span>
        </div>

        {/* 权限矩阵 */}
        <div className="wlt-glass" style={{ flex: 1, minWidth: 320, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>分配权限</div>
              <div style={{ fontSize: 11.5, color: token.colorTextSecondary, marginTop: 2 }}>
                {editingPerms ? `角色：${editingPerms.name}` : "点击左侧角色开始分配"} · 勾选后即时生效（模块停用时对应权限自动置灰）
              </div>
            </div>
            <Input
              prefix={<SearchOutlined style={{ color: token.colorTextTertiary }} />}
              placeholder="搜索权限点"
              allowClear
              style={{ width: 220 }}
              value={kw}
              onChange={(e) => setKw(e.target.value)}
            />
          </div>

          {isSuperAdmin ? (
            <div style={{ textAlign: "center", padding: "60px 0", color: token.colorTextTertiary }}>
              <SafetyCertificateOutlined style={{ fontSize: 40, color: token.colorPrimary }} />
              <div style={{ marginTop: 12, fontWeight: 600 }}>超级管理员拥有全部权限</div>
              <div style={{ fontSize: 12 }}>该角色为内置角色，权限不可修改</div>
            </div>
          ) : editingPerms ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 10, maxHeight: 520, overflowY: "auto", paddingRight: 2 }}>
                {groups.map((g) => {
                  const allOn = g.items.length > 0 && g.items.every((p) => checkedSet.has(p.id));
                  return (
                    <div key={g.key} style={{ background: "#F6F8FE", border: `1px solid ${token.colorBorder}`, borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 4, background: g.meta.color }} />
                        <span style={{ fontSize: 12.5, fontWeight: 700, flex: 1 }}>{g.title}</span>
                        <Tooltip title={allOn ? "取消全选" : "全选本组"}>
                          <Button type="link" size="small" style={{ padding: 0, fontSize: 12 }} onClick={() => {
                            setChecked((prev) => {
                              const s = new Set(prev);
                              if (allOn) g.items.forEach((p) => s.delete(p.id));
                              else g.items.forEach((p) => s.add(p.id));
                              return [...s];
                            });
                          }}>
                            {allOn ? "取消全选" : "全选"}
                          </Button>
                        </Tooltip>
                      </div>
                      {g.items.map((p) => (
                        <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 2px", cursor: "pointer", borderRadius: 6 }}>
                          <Checkbox checked={checkedSet.has(p.id)} onChange={(e) => {
                            setChecked((prev) => (e.target.checked ? [...prev, p.id] : prev.filter((x) => x !== p.id)));
                          }} />
                          <span style={{ fontSize: 13, flex: 1 }}>{p.name}</span>
                          <code style={{ fontSize: 10.5, color: token.colorTextTertiary, background: "#EFF3FC", padding: "1px 6px", borderRadius: 6 }}>{p.code}</code>
                        </label>
                      ))}
                    </div>
                  );
                })}
                {!groups.length && <div style={{ gridColumn: "1 / -1", textAlign: "center", color: token.colorTextTertiary, padding: 32 }}>无匹配权限点</div>}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, borderTop: `1px solid ${token.colorBorder}`, paddingTop: 12, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: token.colorTextTertiary, flex: 1 }}>
                  已勾选 <b style={{ color: token.colorPrimary }}>{checked.length}</b> / {perms.length} 项
                </span>
                <Button icon={<CloseOutlined />} onClick={() => setEditingPerms(null)}>取消</Button>
                <Button type="primary" icon={<CheckOutlined />} onClick={() => void savePerms()}>保存权限</Button>
              </div>
            </>
          ) : (
            <div style={{ textAlign: "center", padding: "60px 0", color: token.colorTextTertiary }}>
              <KeyOutlined style={{ fontSize: 40, color: token.colorTextTertiary }} />
              <div style={{ marginTop: 12, fontWeight: 600 }}>选择左侧角色开始分配权限</div>
              <div style={{ fontSize: 12 }}>权限按模块分组展示，支持搜索与一键全选</div>
            </div>
          )}
        </div>
      </div>

      {/* 新建角色 */}
      <Modal
        title="新建角色"
        open={creating}
        onOk={() => void createRole()}
        onCancel={() => setCreating(false)}
        destroyOnHidden
        afterOpenChange={(o) => { if (o) form.resetFields(); }}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: "请输入名称" }]}>
            <Input placeholder="如：审计员" />
          </Form.Item>
          <Form.Item name="description" label="说明"><Input /></Form.Item>
          <Form.Item name="department_id" label="所属单位（该单位下的用户仅显示本单位货架）">
            <Select
              placeholder="不选则不限货架"
              allowClear
              options={departments.map((d) => ({ label: d.name, value: d.id }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
