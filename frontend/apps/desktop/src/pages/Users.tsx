import { useCallback, useEffect, useState } from "react";
import { App, Button, Form, Input, Modal, Popconfirm, Select, Space, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";

import { adminApi, type Department, type SysRole, type SysUser } from "@wlt/shared";

import { DataTable } from "../components/DataTable";

/** 用户管理（电脑端，超管 sys:user）：账号/角色/所属单位维护（单位控制可货架架与组织归属）。 */
export function UsersPage() {
  const { message } = App.useApp();
  const [list, setList] = useState<SysUser[]>([]);
  const [roles, setRoles] = useState<SysRole[]>([]);
  const [depts, setDepts] = useState<Department[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [editing, setEditing] = useState<SysUser | null>(null);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    setList([]); // 清空旧数据，避免切换每页条数时 dataSource 与分页配置不匹配
    try {
    const data = await adminApi.users({ keyword: keyword || undefined, page, page_size: pageSize });
    setList(data.list);
    setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }, [keyword, page, pageSize]);

  useEffect(() => {
    void load().catch((e) => message.error(e instanceof Error ? e.message : "加载失败"));
  }, [load]);

  useEffect(() => {
    adminApi.roles().then(setRoles).catch(() => undefined);
    adminApi.departments().then(setDepts).catch(() => undefined);
  }, []);

  async function submit() {
    const v = await form.validateFields();
    try {
      if (creating) {
        await adminApi.createUser({ username: v.username, password: v.password, real_name: v.real_name ?? "", phone: v.phone ?? "", email: v.email ?? "", role_id: v.role_id, department_id: v.department_id ?? 0 });
        message.success("用户已创建");
      } else if (editing) {
        await adminApi.updateUser(editing.id, {
          real_name: v.real_name,
          phone: v.phone,
          email: v.email,
          role_id: v.role_id,
          department_id: v.department_id ?? 0,
          password: v.password || undefined,
        });
        message.success("已保存");
      }
      setCreating(false);
      setEditing(null);
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    }
  }

  const columns: ColumnsType<SysUser> = [
    { title: "登录名", dataIndex: "username", width: 120 },
    {
      title: "姓名",
      dataIndex: "real_name",
      width: 160,
      render: (v: string, r) => (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
              background: "linear-gradient(135deg,#5B7FFF,#7C93FF)", color: "#fff",
              display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600,
            }}
          >
            {(v || r.username || "?")[0]}
          </span>
          <span>{v}</span>
        </span>
      ),
    },
    { title: "手机", dataIndex: "phone", width: 130 },
    { title: "邮箱", dataIndex: "email", width: 170, render: (v: string) => v || "-" },
    { title: "角色", dataIndex: "role_name", width: 110, render: (v: string) => (v ? <span className="wlt-pill" style={{ background: "#EAEFFF", color: "#3B5BDB" }}>{v}</span> : "-") },
    { title: "所属单位", dataIndex: "department_name", width: 130, render: (v: string, r) => {
      const id = r.department_id ?? 0;
      if (!v || !id) return <span style={{ color: "#8A93A8", fontSize: 12 }}>未分配</span>;
      return <span className="wlt-pill" style={{ background: "#E0F2FE", color: "#0E7490" }}>{v}</span>;
    } },
    { title: "状态", width: 90, render: (_, r) => (r.status === 1 ? <Tag color="green">启用</Tag> : <Tag color="default">停用</Tag>) },
    { title: "最近登录", dataIndex: "last_login_at", width: 160, render: (v: string | null) => v ?? "-" },
    {
      title: "操作",
      width: 200,
      render: (_, r) => (
        <Space>
          <Button
            size="small"
            onClick={() => {
              setEditing(r);
              setCreating(false);
            }}
          >
            编辑
          </Button>
          {r.status === 1 ? (
            <Popconfirm
              title={`停用账号 ${r.username}？`}
              onConfirm={async () => {
                try {
                  await adminApi.deleteUser(r.id);
                  message.success("已停用");
                  void load();
                } catch (e) {
                  message.error(e instanceof Error ? e.message : "停用失败");
                }
              }}
            >
              <Button size="small" danger>停用</Button>
            </Popconfirm>
          ) : (
            <Button
              size="small"
              onClick={async () => {
                try {
                  await adminApi.updateUser(r.id, { status: 1 });
                  message.success("已启用");
                  void load();
                } catch (e) {
                  message.error(e instanceof Error ? e.message : "启用失败");
                }
              }}
            >
              启用
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>用户管理</h2>
          <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "#5B6478" }}>登录名 / 姓名 / 手机 / 角色；停用即登出，启用即时生效</p>
        </div>
        <Space>
          <Input.Search
            placeholder="登录名/姓名/手机"
            allowClear
            style={{ width: 240 }}
            onSearch={(v) => { setKeyword(v); setPage(1); }}
          />
          <Button type="primary" onClick={() => { setCreating(true); setEditing(null); }}>
            新建用户
          </Button>
        </Space>
      </div>
      <div className="wlt-glass" style={{ padding: 12 }}>
        <DataTable rowKey="id" loading={loading} locale={{ emptyText: "暂无数据" }} size="middle" columns={columns} dataSource={list} pagination={{ current: page, pageSize, total, showSizeChanger: true, showTotal: (t) => `共 ${t} 个用户`, onChange: (p: number, ps: number) => { if (ps !== pageSize) { setPage(1); setPageSize(ps); } else { setPage(p); } } }} rowSelection onBatchDelete={async (keys) => { for (const k of keys) await adminApi.deleteUser(Number(k)); message.success(`已停用 ${keys.length} 个账号`); void load(); }} />
      </div>

      <Modal
        title={creating ? "新建用户" : `编辑用户：${editing?.username ?? ""}`}
        open={creating || Boolean(editing)}
        onOk={() => void submit()}
        onCancel={() => { setCreating(false); setEditing(null); }}
        destroyOnHidden
        afterOpenChange={(o) => {
          if (!o) return;
          if (editing) {
            form.setFieldsValue({ username: editing.username, real_name: editing.real_name, phone: editing.phone, email: editing.email, role_id: editing.role_id, department_id: editing.department_id || undefined, password: "" });
          } else {
            form.resetFields();
          }
        }}
      >
        <Form form={form} layout="vertical" initialValues={{ role_id: roles[0]?.id }}>
          {creating && (
            <>
              <Form.Item name="username" label="登录名" rules={[{ required: true, min: 2, message: "至少 2 个字符" }]}>
                <Input placeholder="员工工号/登录名" />
              </Form.Item>
              <Form.Item name="password" label="初始密码" rules={[{ required: true, min: 6, message: "至少 6 位" }]}>
                <Input.Password placeholder="至少 6 位" />
              </Form.Item>
            </>
          )}
          {!creating && (
            <Form.Item name="password" label="重置密码（留空则不修改）" rules={[{ min: 6, message: "至少 6 位" }]}>
              <Input.Password placeholder="留空不修改" />
            </Form.Item>
          )}
          <Form.Item name="real_name" label="姓名"><Input /></Form.Item>
          <Form.Item name="phone" label="手机"><Input maxLength={20} /></Form.Item>
          <Form.Item name="email" label="邮箱（找回密码用）"><Input maxLength={100} /></Form.Item>
          <Form.Item name="role_id" label="角色" rules={[{ required: true, message: "请选择角色" }]}>
            <Select options={roles.map((r) => ({ label: r.name, value: r.id }))} />
          </Form.Item>
          <Form.Item name="department_id" label="所属单位（可选）" extra="关联组织单位：非超管/管理者账号按单位限定可见货架">
            <Select
              placeholder="未分配"
              allowClear
              showSearch
              optionFilterProp="label"
              options={depts.map((d) => ({ label: d.name, value: d.id }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
