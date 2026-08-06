import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";

import { baseApi, type CategoryNode } from "@wlt/shared";

import { DataTable } from "../components/DataTable";

/** 分类树拍平（保留完整节点，parent_id 用于上级查询）。 */
function flattenCats(nodes: CategoryNode[]): CategoryNode[] {
  const out: CategoryNode[] = [];
  for (const n of nodes) {
    out.push(n);
    if (n.children?.length) out.push(...flattenCats(n.children));
  }
  return out;
}

/** 分类树转 Select options（顶级=0）。 */
function catOptions(nodes: CategoryNode[]): { value: number; label: string }[] {
  const out: { value: number; label: string }[] = [{ value: 0, label: "顶级分类" }];
  for (const n of nodes) {
    out.push({ value: n.id, label: n.name });
    n.children?.forEach((c) => out.push({ value: c.id, label: `${n.name}/${c.name}` }));
  }
  return out;
}

/** 分类管理（电脑端，base:category）：材料分类树维护，材料表单/报表按分类筛选。 */
export function CategoriesPage() {
  const { message } = App.useApp();
  const [list, setList] = useState<CategoryNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CategoryNode | null>(null);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setList(await baseApi.categories());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load().catch((e) => message.error(e instanceof Error ? e.message : "加载失败"));
  }, [load, message]);

  const flat = useMemo(() => flattenCats(list), [list]);
  const options = useMemo(() => catOptions(list), [list]);

  function openCreate() {
    setEditing(null);
    setOpen(true);
  }

  function openEdit(c: CategoryNode) {
    setEditing(c);
    setOpen(true);
  }

  async function save() {
    const v = await form.validateFields();
    const body = { parent_id: v.parent_id ?? 0, name: v.name.trim(), sort: v.sort ?? 0 };
    try {
      if (editing) {
        await baseApi.updateCategory(editing.id, body);
        message.success("分类已更新");
      } else {
        await baseApi.createCategory(body);
        message.success("分类已创建");
      }
      setOpen(false);
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    }
  }

  async function remove(c: CategoryNode) {
    try {
      await baseApi.deleteCategory(c.id);
      message.success("分类已删除");
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "删除失败");
    }
  }

  const columns: ColumnsType<CategoryNode> = [
    { title: "分类名称", dataIndex: "name", width: 220, render: (v: string, r) => (r.parent_id ? <span style={{ paddingLeft: 8 }}>└ {v}</span> : <b>{v}</b>) },
    {
      title: "上级分类",
      width: 200,
      render: (_, r) => (r.parent_id ? (flat.find((f) => f.id === r.parent_id)?.name ?? "-") : <Tag>顶级</Tag>),
    },
    { title: "排序", dataIndex: "sort", width: 80 },
    {
      title: "子分类",
      width: 120,
      render: (_, r) => (r.children?.length ? <Tag color="blue">{r.children.length} 个</Tag> : <Tag>无</Tag>),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Space style={{ marginBottom: 16 }} wrap>
        <h2 style={{ margin: 0 }}>分类管理</h2>
        <Button type="primary" onClick={openCreate}>新建分类</Button>
        <span style={{ fontSize: 12, color: "#86909c" }}>材料按分类管理（支持两级）；有子分类或已挂商品的分类不可删除</span>
      </Space>
      <DataTable
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={flat}
        pagination={false}
        locale={{ emptyText: "暂无分类" }}
        rowSelection
        onBatchDelete={async (keys) => {
          for (const k of keys) await baseApi.deleteCategory(Number(k));
          message.success(`已删除 ${keys.length} 个分类`);
          void load();
        }}
        actionsWidth={140}
        actions={(r) => (
          <Space>
            <Button size="small" onClick={() => openEdit(r)}>编辑</Button>
            <Popconfirm title={`确认删除分类「${r.name}」？`} onConfirm={() => void remove(r)}>
              <Button size="small" danger>删除</Button>
            </Popconfirm>
          </Space>
        )}
      />

      <Modal
        title={editing ? `编辑分类：${editing.name}` : "新建分类"}
        open={open}
        onOk={() => void save()}
        onCancel={() => setOpen(false)}
        width={420}
        destroyOnHidden
        afterOpenChange={(o) => {
          if (!o) return;
          if (editing) form.setFieldsValue({ parent_id: editing.parent_id, name: editing.name, sort: editing.sort ?? 0 });
          else { form.resetFields(); form.setFieldsValue({ parent_id: 0, sort: 0 }); }
        }}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="parent_id" label="父分类" rules={[{ required: true, message: "请选择父分类" }]}>
            <Select options={options} />
          </Form.Item>
          <Form.Item name="name" label="分类名称" rules={[{ required: true, message: "请输入分类名称" }, { max: 50, message: "不超过 50 字" }]}>
            <Input placeholder="如：轴承类 / 五金件" maxLength={50} />
          </Form.Item>
          <Form.Item name="sort" label="排序（小在前）">
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
