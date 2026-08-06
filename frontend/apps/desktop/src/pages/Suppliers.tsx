import { useCallback, useEffect, useState } from "react";
import { App, Button, Drawer, Form, Input, Modal, Popconfirm, Space, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";

import { baseApi, type Product, type Supplier, type SupplierInput } from "@wlt/shared";

import { DataTable } from "../components/DataTable";

/** 供应商管理（电脑端，base:supplier）：新建/编辑/删除（软删）/查看关联材料。 */
export function SuppliersPage() {
  const { message } = App.useApp();
  const [list, setList] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form] = Form.useForm();
  // 查看详情：供应商信息 + 关联材料
  const [detail, setDetail] = useState<Supplier | null>(null);
  const [detailProducts, setDetailProducts] = useState<Product[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // 服务端搜索 + 分页（全库匹配），避免此前只加载前 100 条再本地过滤导致搜不到较旧供应商
      const data = await baseApi.suppliers(undefined, keyword.trim(), page, 20);
      setList(data.list);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }, [keyword, page]);

  useEffect(() => {
    void load().catch((e) => message.error(e instanceof Error ? e.message : "加载失败"));
  }, [load]);

  function openCreate() {
    setEditing(null);
    setOpen(true);
  }

  function openEdit(s: Supplier) {
    setEditing(s);
    setOpen(true);
  }

  async function save() {
    const v = await form.validateFields();
    const body: SupplierInput = {
      code: editing ? editing.code : "SUP" + Date.now(),
      name: v.name.trim(),
      contact: v.contact ?? "",
      phone: v.phone ?? "",
      address: v.address ?? "",
      remark: v.remark ?? "",
    };
    try {
      if (editing) {
        await baseApi.updateSupplier(editing.id, body);
        message.success("供应商已更新");
      } else {
        await baseApi.createSupplier(body);
        message.success("供应商已创建");
      }
      setOpen(false);
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    }
  }

  async function toggleStatus(s: Supplier) {
    try {
      await baseApi.updateSupplier(s.id, { code: s.code, name: s.name, status: s.status === 1 ? 0 : 1 });
      message.success(s.status === 1 ? "已停用" : "已启用");
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "操作失败");
    }
  }

  async function remove(s: Supplier) {
    try {
      await baseApi.deleteSupplier(s.id);
      message.success("已停用该供应商");
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "停用失败");
    }
  }

  async function openDetail(s: Supplier) {
    setDetail(s);
    setDetailProducts([]);
    setDetailLoading(true);
    try {
      const data = await baseApi.supplierProducts(s.id);
      setDetailProducts(data.list);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载关联材料失败");
    } finally {
      setDetailLoading(false);
    }
  }

  const columns: ColumnsType<Supplier> = [
    { title: "名称", dataIndex: "name", width: 180 },
    { title: "联系人", dataIndex: "contact", width: 100, render: (v: string) => v || "-" },
    { title: "电话", dataIndex: "phone", width: 130, render: (v: string) => v || "-" },
    { title: "地址", dataIndex: "address", render: (v: string) => v || "-" },
    {
      title: "状态",
      dataIndex: "status",
      width: 80,
      render: (v: number) => (v === 1 ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Space style={{ marginBottom: 16 }} wrap>
        <h2 style={{ margin: 0 }}>供应商管理</h2>
        <Input.Search
          placeholder="名称 / 联系人 / 电话"
          allowClear
          style={{ width: 260 }}
          onSearch={(v) => { setKeyword(v.trim()); setPage(1); }}
        />
        <Button type="primary" onClick={openCreate}>新建供应商</Button>
      </Space>
      <DataTable
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={list}
        locale={{ emptyText: "暂无供应商" }}
        pagination={{ current: page, pageSize: 20, total, showSizeChanger: false, onChange: (p) => setPage(p) }}
        rowSelection
        onBatchDelete={async (keys) => {
          for (const k of keys) await baseApi.deleteSupplier(Number(k));
          message.success(`已停用 ${keys.length} 个供应商`);
          void load();
        }}
        actionsWidth={200}
        actions={(r) => (
          <Space>
            <Button size="small" onClick={() => void openDetail(r)}>查看材料</Button>
            <Button size="small" onClick={() => openEdit(r)}>编辑</Button>
            {r.status === 1 ? (
              <Popconfirm title="确认停用该供应商？停用前需先解除其关联的启用材料。" onConfirm={() => void remove(r)}>
                <Button size="small" danger>停用</Button>
              </Popconfirm>
            ) : (
              <Button size="small" onClick={() => void toggleStatus(r)}>启用</Button>
            )}
          </Space>
        )}
      />

      <Modal
        title={editing ? `编辑供应商：${editing.name}` : "新建供应商"}
        open={open}
        onOk={() => void save()}
        onCancel={() => setOpen(false)}
        width={520}
        destroyOnHidden
        afterOpenChange={(o) => {
          if (!o) return;
          if (editing) form.setFieldsValue({ code: editing.code, name: editing.name, contact: editing.contact, phone: editing.phone, address: editing.address, remark: editing.remark });
          else form.resetFields();
        }}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: "请输入名称" }]}>
            <Input placeholder="如：XX五金有限公司" maxLength={100} />
          </Form.Item>
          <Form.Item name="contact" label="联系人">
            <Input maxLength={50} />
          </Form.Item>
          <Form.Item name="phone" label="电话">
            <Input maxLength={20} />
          </Form.Item>
          <Form.Item name="address" label="地址">
            <Input maxLength={200} />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input maxLength={255} />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={detail ? `供应商：${detail.name}` : "供应商详情"}
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        size={640}
      >
        {detail && (
          <>
            <Space orientation="vertical" style={{ marginBottom: 16 }} size={4}>
              <div>联系人：{detail.contact || "-"}　电话：{detail.phone || "-"}</div>
              <div>地址：{detail.address || "-"}</div>
              <div>备注：{detail.remark || "-"}</div>
              <Tag color={detail.status === 1 ? "green" : "default"}>{detail.status === 1 ? "启用" : "停用"}</Tag>
            </Space>
            <h4 style={{ margin: "0 0 8px" }}>关联材料（{detailProducts.length}）</h4>
            <DataTable
              rowKey="id"
              size="small"
              loading={detailLoading}
              locale={{ emptyText: "暂无关联材料，可在「材料管理」编辑材料时关联" }}
              pagination={false}
              columns={[
                { title: "物料编码", dataIndex: "material_code", render: (v: string) => v || "-" },
                { title: "条码", dataIndex: "barcode", render: (v: string) => v || "-" },
                { title: "材料名称", dataIndex: "name" },
                { title: "型号规格", dataIndex: "spec", render: (v: string) => v || "-" },
                { title: "单位", dataIndex: "unit_name", width: 70 },
                {
                  title: "状态",
                  dataIndex: "status",
                  width: 70,
                  render: (v: number) => (v === 1 ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>),
                },
              ]}
              dataSource={detailProducts}
            />
          </>
        )}
      </Drawer>
    </div>
  );
}
