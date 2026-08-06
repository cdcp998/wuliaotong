import { useCallback, useEffect, useState } from "react";
import { Button, Checkbox, Form, Input, message, Modal, Popconfirm, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";

import { adminApi, type SysPermission, type SysRole } from "@wlt/shared";

/** 角色与权限管理（电脑端，超管 sys:role）。 */
export function RolesPage() {
  const [list, setList] = useState<SysRole[]>([]);
  const [perms, setPerms] = useState<SysPermission[]>([]);
  const [editingPerms, setEditingPerms] = useState<SysRole | null>(null);
  const [checked, setChecked] = useState<number[]>([]);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setList(await adminApi.roles());
    setPerms(await adminApi.permissions());
  }, []);

  useEffect(() => {
    void load().catch((e) => message.error(e instanceof Error ? e.message : "加载失败"));
  }, [load]);

  async function createRole() {
    const v = await form.validateFields();
    try {
      await adminApi.createRole({ code: v.code, name: v.name, description: v.description ?? "" });
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
      message.success("权限已更新");
      setEditingPerms(null);
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    }
  }

  const columns: ColumnsType<SysRole> = [
    { title: "编码", dataIndex: "code", width: 140 },
    { title: "名称", dataIndex: "name", width: 120 },
    { title: "说明", dataIndex: "description" },
    {
      title: "权限数",
      width: 90,
      render: (_, r) => (r.code === "super_admin" ? <Tag color="blue">全部</Tag> : <Tag>{r.permission_ids.length}</Tag>),
    },
    {
      title: "操作",
      width: 180,
      render: (_, r) => (
        <Space>
          <Button
            size="small"
            type="primary"
            ghost
            disabled={r.code === "super_admin"}
            onClick={() => {
              setEditingPerms(r);
              setChecked(r.permission_ids);
            }}
          >
            分配权限
          </Button>
          {!r.is_builtin && (
            <Popconfirm
              title="删除该角色？"
              onConfirm={async () => {
                try {
                  await adminApi.deleteRole(r.id);
                  message.success("已删除");
                  void load();
                } catch (e) {
                  message.error(e instanceof Error ? e.message : "删除失败");
                }
              }}
            >
              <Button size="small" danger>删除</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>角色与权限</h2>
        <Button type="primary" onClick={() => { setCreating(true); form.resetFields(); }}>新建角色</Button>
      </div>
      <Table rowKey="id" size="small" columns={columns} dataSource={list} pagination={false} />

      <Modal
        title="新建角色"
        open={creating}
        onOk={() => void createRole()}
        onCancel={() => setCreating(false)}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="code" label="编码" rules={[{ required: true, pattern: /^[a-z][a-z0-9:_-]*$/, message: "小写字母开头，可含数字/:_-" }]}>
            <Input placeholder="如：auditor" />
          </Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: "请输入名称" }]}>
            <Input placeholder="如：审计员" />
          </Form.Item>
          <Form.Item name="description" label="说明"><Input /></Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`分配权限：${editingPerms?.name ?? ""}`}
        open={Boolean(editingPerms)}
        onOk={() => void savePerms()}
        onCancel={() => setEditingPerms(null)}
        width={520}
      >
        <Checkbox.Group
          value={checked}
          onChange={(v) => setChecked(v as number[])}
          style={{ display: "flex", flexDirection: "column", gap: 8 }}
        >
          {perms.map((p) => (
            <Checkbox key={p.id} value={p.id}>
              {p.name} <span style={{ color: "#999", fontSize: 12 }}>{p.code}</span>
            </Checkbox>
          ))}
        </Checkbox.Group>
      </Modal>
    </div>
  );
}
