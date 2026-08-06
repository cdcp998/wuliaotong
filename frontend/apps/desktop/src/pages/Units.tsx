import { useCallback, useEffect, useState } from "react";
import { App, Button, Form, Input, Modal, Popconfirm, Space } from "antd";
import type { ColumnsType } from "antd/es/table";

import { baseApi, type Unit } from "@wlt/shared";

import { DataTable } from "../components/DataTable";

/** 材料单位管理（电脑端，base:product）：计量单位维护。材料/入库/送货单识别等场景的单位下拉均来自本表。 */
export function UnitsPage() {
  const { message } = App.useApp();
  const [list, setList] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Unit | null>(null);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setList(await baseApi.units());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load().catch((e) => message.error(e instanceof Error ? e.message : "加载失败"));
  }, [load, message]);

  function openCreate() {
    setEditing(null);
    setOpen(true);
  }

  function openEdit(u: Unit) {
    setEditing(u);
    setOpen(true);
  }

  async function save() {
    const v = await form.validateFields();
    const body = { name: v.name.trim(), remark: (v.remark ?? "").trim() };
    try {
      if (editing) {
        await baseApi.updateUnit(editing.id, body);
        message.success("单位已更新");
      } else {
        await baseApi.createUnit(body);
        message.success("单位已创建");
      }
      setOpen(false);
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    }
  }

  async function remove(u: Unit) {
    try {
      await baseApi.deleteUnit(u.id);
      message.success("单位已删除");
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "删除失败");
    }
  }

  const columns: ColumnsType<Unit> = [
    { title: "名称", dataIndex: "name", width: 160, render: (v: string) => <b>{v}</b> },
    { title: "备注", dataIndex: "remark", render: (v?: string) => v || "-" },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Space style={{ marginBottom: 16 }} wrap>
        <h2 style={{ margin: 0 }}>材料单位管理</h2>
        <Button type="primary" onClick={openCreate}>新建单位</Button>
        <span style={{ fontSize: 12, color: "#86909c" }}>
          材料 / 新建入库 / 送货单识别等场景的单位选项均来自本表，请使用规范单位名（个 / 件 / 套 / 箱 / 盒 / 包 / 台 / 米 / kg 等）
        </span>
      </Space>
      <DataTable
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={list}
        pagination={false}
        locale={{ emptyText: "暂无单位" }}
        rowSelection
        onBatchDelete={async (keys) => {
          for (const k of keys) await baseApi.deleteUnit(Number(k));
          message.success(`已删除 ${keys.length} 个单位`);
          void load();
        }}
        actionsWidth={160}
        actions={(r) => (
          <Space>
            <Button size="small" onClick={() => openEdit(r)}>编辑</Button>
            <Popconfirm title={`确认删除单位「${r.name}」？已被材料引用的单位不可删除。`} onConfirm={() => void remove(r)}>
              <Button size="small" danger>删除</Button>
            </Popconfirm>
          </Space>
        )}
      />

      <Modal
        title={editing ? `编辑单位：${editing.name}` : "新建单位"}
        open={open}
        onOk={() => void save()}
        onCancel={() => setOpen(false)}
        width={420}
        destroyOnHidden
        afterOpenChange={(o) => {
          if (!o) return;
          if (editing) form.setFieldsValue({ name: editing.name, remark: editing.remark ?? "" });
          else form.resetFields();
        }}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="单位名称" rules={[{ required: true, message: "请输入单位名称" }, { max: 20, message: "不超过 20 字" }]}>
            <Input placeholder="如：件 / 箱 / kg" maxLength={20} />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input maxLength={100} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
