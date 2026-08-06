import { useCallback, useEffect, useState } from "react";
import { Button, Form, Input, message, Modal, Popconfirm, Select, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";

import { adminApi, type SysRole, type SysUser } from "@wlt/shared";

/** 用户管理（电脑端，超管 sys:user）。 */
export function UsersPage() {
  const [list, setList] = useState<SysUser[]>([]);
  const [roles, setRoles] = useState<SysRole[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [editing, setEditing] = useState<SysUser | null>(null);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    const data = await adminApi.users({ keyword: keyword || undefined, page });
    setList(data.list);
    setTotal(data.total);
  }, [keyword, page]);

  useEffect(() => {
    void load().catch((e) => message.error(e instanceof Error ? e.message : "加载失败"));
  }, [load]);

  useEffect(() => {
    adminApi.roles().then(setRoles).catch(() => undefined);
  }, []);

  async function submit() {
    const v = await form.validateFields();
    try {
      if (creating) {
        await adminApi.createUser({ username: v.username, password: v.password, real_name: v.real_name ?? "", phone: v.phone ?? "", email: v.email ?? "", role_id: v.role_id });
        message.success("用户已创建");
      } else if (editing) {
        await adminApi.updateUser(editing.id, {
          real_name: v.real_name,
          phone: v.phone,
          email: v.email,
          role_id: v.role_id,
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
    { title: "姓名", dataIndex: "real_name", width: 120 },
    { title: "手机", dataIndex: "phone", width: 130 },
    { title: "邮箱", dataIndex: "email", width: 170, render: (v: string) => v || "-" },
    { title: "角色", dataIndex: "role_name", width: 110 },
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
              form.setFieldsValue({ username: r.username, real_name: r.real_name, phone: r.phone, email: r.email, role_id: r.role_id, password: "" });
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
        <h2 style={{ margin: 0 }}>用户管理</h2>
        <Space>
          <Input.Search
            placeholder="登录名/姓名/手机"
            allowClear
            style={{ width: 220 }}
            onSearch={(v) => { setKeyword(v); setPage(1); }}
          />
          <Button type="primary" onClick={() => { setCreating(true); setEditing(null); form.resetFields(); }}>
            新建用户
          </Button>
        </Space>
      </div>
      <Table rowKey="id" size="small" columns={columns} dataSource={list} pagination={{ current: page, pageSize: 20, total, onChange: setPage }} />

      <Modal
        title={creating ? "新建用户" : `编辑用户：${editing?.username ?? ""}`}
        open={creating || Boolean(editing)}
        onOk={() => void submit()}
        onCancel={() => { setCreating(false); setEditing(null); }}
        destroyOnClose
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
            <Select options={roles.map((r) => ({ label: `${r.name}（${r.code}）`, value: r.id }))} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
