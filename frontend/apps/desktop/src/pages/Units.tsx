import { useCallback, useEffect, useState } from "react";
import { App, Button, Form, Input, Modal, Popconfirm, Space } from "antd";
import type { ColumnsType } from "antd/es/table";

import { baseApi, type Unit } from "@wlt/shared";

import { DataTable } from "../components/DataTable";

/** 国标常用计量单位（设计页 16：国标 51 项）——材料/入库场景常用 SI 单位 + 计数单位。 */
const GB_UNITS: { name: string; remark: string }[] = [
  { name: "个", remark: "GB/T 计数" }, { name: "件", remark: "GB/T 计数" }, { name: "套", remark: "GB/T 计数" },
  { name: "台", remark: "GB/T 计数" }, { name: "辆", remark: "GB/T 计数" }, { name: "箱", remark: "GB/T 计数" },
  { name: "盒", remark: "GB/T 计数" }, { name: "包", remark: "GB/T 计数" }, { name: "捆", remark: "GB/T 计数" },
  { name: "卷", remark: "GB/T 计数" }, { name: "张", remark: "GB/T 计数" }, { name: "片", remark: "GB/T 计数" },
  { name: "块", remark: "GB/T 计数" }, { name: "根", remark: "GB/T 计数" }, { name: "支", remark: "GB/T 计数" },
  { name: "把", remark: "GB/T 计数" }, { name: "条", remark: "GB/T 计数" }, { name: "桶", remark: "GB/T 计数" },
  { name: "罐", remark: "GB/T 计数" }, { name: "瓶", remark: "GB/T 计数" }, { name: "袋", remark: "GB/T 计数" },
  { name: "粒", remark: "GB/T 计数" }, { name: "颗", remark: "GB/T 计数" }, { name: "副", remark: "GB/T 计数" },
  { name: "组", remark: "GB/T 计数" }, { name: "板", remark: "GB/T 计数" }, { name: "米", remark: "长度" },
  { name: "厘米", remark: "长度" }, { name: "毫米", remark: "长度" }, { name: "千米", remark: "长度" },
  { name: "平方米", remark: "面积" }, { name: "立方米", remark: "体积" }, { name: "升", remark: "容积" },
  { name: "毫升", remark: "容积" }, { name: "克", remark: "质量" }, { name: "千克", remark: "质量" },
  { name: "公斤", remark: "质量" }, { name: "吨", remark: "质量" }, { name: "毫克", remark: "质量" },
  { name: "千瓦时", remark: "能量" }, { name: "千瓦", remark: "功率" }, { name: "瓦", remark: "功率" },
  { name: "伏", remark: "电压" }, { name: "安培", remark: "电流" }, { name: "欧姆", remark: "电阻" },
  { name: "赫兹", remark: "频率" }, { name: "帕斯卡", remark: "压强" }, { name: "摄氏度", remark: "温度" },
  { name: "转每分钟", remark: "转速" },
];

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

  /** 导入国标常用单位（设计页 16：国标 51 项）——仅补缺失项。 */
  async function importGbUnits() {
    const existing = new Set(list.map((u) => u.name.trim()));
    const missing = GB_UNITS.filter((u) => !existing.has(u.name.trim()));
    if (!missing.length) return message.info("国标单位均已存在");
    try {
      for (const u of missing) await baseApi.createUnit({ name: u.name.trim(), remark: u.remark });
      message.success(`已导入 ${missing.length} 个国标单位`);
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "导入失败");
    }
  }

  const columns: ColumnsType<Unit> = [
    { title: "名称", dataIndex: "name", width: 160, render: (v: string) => <b>{v}</b> },
    { title: "备注", dataIndex: "remark", render: (v?: string) => v || "-" },
  ];

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ margin: "0 0 16px" }}>材料单位管理</h2>
      <Space style={{ marginBottom: 16 }} wrap>
        <Button type="primary" onClick={openCreate}>新建单位</Button>
        <Button onClick={() => void importGbUnits()}>导入国标单位（{GB_UNITS.length} 项）</Button>
        <span style={{ fontSize: 12, color: "#5B6478" }}>
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
