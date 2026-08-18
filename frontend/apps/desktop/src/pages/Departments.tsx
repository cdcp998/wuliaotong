import { useCallback, useEffect, useState } from "react";
import { App, Button, Form, Input, Modal, Popconfirm, Select, Space, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";

import { adminApi, baseApi, type Department, type Shelf } from "@wlt/shared";

import { DataTable } from "../components/DataTable";

/** 单位管理（电脑端，超管 dept:manage）：组织单位 + 可用货架关联；角色所属单位下的用户仅显示本单位货架。 */
export function DepartmentsPage() {
  const { message } = App.useApp();
  const [list, setList] = useState<Department[]>([]);
  const [loading, setLoading] = useState(false);
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [creating, setCreating] = useState(false);
  const [shelfTarget, setShelfTarget] = useState<Department | null>(null);
  const [shelfChecked, setShelfChecked] = useState<number[]>([]);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
    setList(await adminApi.departments());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load().catch((e) => message.error(e instanceof Error ? e.message : "加载失败"));
    // 一次拉取全部货架（wh_id=0），避免对每个仓库逐次请求导致并发爆炸（仓库多时浏览器 ERR_INSUFFICIENT_RESOURCES）
    baseApi.shelves(0).then(setShelves).catch(() => undefined);
  }, [load]);

  async function create() {
    const v = await form.validateFields();
    try {
      await adminApi.createDepartment({ name: v.name, remark: v.remark ?? "" });
      message.success("单位已创建");
      setCreating(false);
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "创建失败");
    }
  }

  async function saveShelves() {
    if (!shelfTarget) return;
    try {
      await adminApi.updateDepartmentShelves(shelfTarget.id, shelfChecked);
      message.success("货架关联已更新");
      setShelfTarget(null);
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    }
  }

  const columns: ColumnsType<Department> = [
    { title: "单位名称", dataIndex: "name" },
    { title: "备注", dataIndex: "remark" },
    { title: "状态", width: 90, render: (_, r) => (r.status === 1 ? <Tag color="green">启用</Tag> : <Tag color="default">停用</Tag>) },
    { title: "可用货架", width: 90, render: (_, r) => <Tag>{r.shelf_ids.length} 个</Tag> },
  ];

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>单位管理</h2>
        <Button type="primary" onClick={() => setCreating(true)}>新建单位</Button>
      </div>
      <p style={{ color: "#646a73", fontSize: 12, marginBottom: 16 }}>
        角色可归属单位；单位关联的仓库货架仅该单位角色（非超管/管理者）可见，用于 2D 货架图与库位选择。单位编码由系统自动生成（数字编码，对外隐藏）。
      </p>
      <DataTable
        rowKey="id"
        loading={loading}
        size="small"
        columns={columns}
        dataSource={list}
        pagination={false}
        rowSelection
        onBatchDelete={async (keys) => {
          for (const k of keys) await adminApi.deleteDepartment(Number(k));
          message.success(`已删除 ${keys.length} 个单位`);
          void load();
        }}
        actionsWidth={220}
        actions={(r) => (
          <Space>
            <Button size="small" type="primary" ghost onClick={() => { setShelfTarget(r); setShelfChecked(r.shelf_ids); }}>
              配置货架
            </Button>
            <Popconfirm
              title="删除该单位？"
              onConfirm={async () => {
                try {
                  await adminApi.deleteDepartment(r.id);
                  message.success("已删除");
                  void load();
                } catch (e) {
                  message.error(e instanceof Error ? e.message : "删除失败");
                }
              }}
            >
              <Button size="small" danger>删除</Button>
            </Popconfirm>
          </Space>
        )}
      />

      <Modal
        title="新建单位"
        open={creating}
        onOk={() => void create()}
        onCancel={() => setCreating(false)}
        destroyOnHidden
        afterOpenChange={(o) => { if (o) form.resetFields(); }}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="单位名称" rules={[{ required: true, message: "请输入名称" }]}>
            <Input placeholder="如：一车间" />
          </Form.Item>
          <Form.Item name="remark" label="备注"><Input /></Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`配置可用货架：${shelfTarget?.name ?? ""}`}
        open={Boolean(shelfTarget)}
        onOk={() => void saveShelves()}
        onCancel={() => setShelfTarget(null)}
        width={520}
      >
        <Select
          mode="multiple"
          style={{ width: "100%" }}
          placeholder="选择该单位可用的货架（超管/管理者不受限）"
          value={shelfChecked}
          onChange={(v) => setShelfChecked(v as number[])}
          options={shelves.map((s) => ({ label: `${s.code}${s.name ? ` ${s.name}` : ""}`, value: s.id }))}
          optionFilterProp="label"
        />
        <p style={{ color: "#646a73", fontSize: 12, marginTop: 8 }}>留空表示该单位无可见货架。</p>
      </Modal>
    </div>
  );
}
