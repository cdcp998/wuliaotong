import { useCallback, useEffect, useState } from "react";
import { App, Button, Input, InputNumber, Modal, Popconfirm, Select, Space } from "antd";
import type { ColumnsType } from "antd/es/table";

import { aiApi, baseApi, type AiSuggestion, type CategoryNode } from "@wlt/shared";

import { DataTable } from "../components/DataTable";

/** AI 建议处理（电脑端）：未匹配商品 → 豆包识别建议 → 人工确认新增/忽略。 */
export function AiSuggestionsPage() {
  const { message } = App.useApp();
  const [list, setList] = useState<AiSuggestion[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [accepting, setAccepting] = useState<AiSuggestion | null>(null);
  const [units, setUnits] = useState<{ id: number; name: string }[]>([]);
  const [categories, setCategories] = useState<{ id: number; name: string }[]>([]);
  const [form, setForm] = useState({ code: "", name: "", category_id: 0, unit_id: 0, purchase_price: "0" });

  const load = useCallback(async () => {
    setList([]); // 清空旧数据，避免切换每页条数时 dataSource 与分页配置不匹配
    try {
      const data = await aiApi.list(1, page, pageSize);
      setList(data.list);
      setTotal(data.total);
    } catch {
      // 加载失败保持空列表（错误已由 request 层转为可读 BizError），避免 unhandled rejection
      setList([]);
    }
  }, [page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    baseApi.units().then((u) => setUnits(u)).catch(() => undefined);
    baseApi.categories().then((cats) => {
      const flat: { id: number; name: string }[] = [];
      const walk = (nodes: CategoryNode[]) => {
        for (const n of nodes) {
          flat.push({ id: n.id, name: n.name });
          if (n.children?.length) walk(n.children);
        }
      };
      walk(cats);
      setCategories(flat);
    }).catch(() => undefined);
  }, []);

  function openAccept(sug: AiSuggestion) {
    setAccepting(sug);
    setForm({ code: "", name: sug.product_name, category_id: 0, unit_id: units[0]?.id ?? 0, purchase_price: "0" });
  }

  async function doAccept() {
    if (!accepting) return;
    try {
      await aiApi.accept(accepting.id, {
        code: form.code,
        name: form.name,
        category_id: form.category_id || undefined,
        unit_id: form.unit_id || undefined,
        purchase_price: form.purchase_price,
      });
      message.success("已新增材料");
      setAccepting(null);
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "新增失败");
    }
  }

  const columns: ColumnsType<AiSuggestion> = [
    { title: "AI 建议材料名", dataIndex: "product_name" },
    { title: "规格", render: (_, r) => r.suggestion?.spec ?? "-" },
    { title: "类别", render: (_, r) => r.suggestion?.category ?? "-" },
    { title: "备注", render: (_, r) => r.suggestion?.note ?? "-" },
    { title: "模型", dataIndex: "model" },
    { title: "时间", dataIndex: "created_at" },
    {
      title: "操作",
      render: (_, r) => (
        <Space>
          <Button size="small" type="primary" onClick={() => openAccept(r)}>
            确认新增
          </Button>
          <Popconfirm title="确认忽略该建议？" onConfirm={async () => { try { await aiApi.ignore(r.id); message.success("已忽略"); void load(); } catch (e) { message.error(e instanceof Error ? e.message : "失败"); } }}>
            <Button size="small" danger>忽略</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ margin: 0, marginBottom: 16 }}>AI 建议处理（待确认 {total} 条）</h2>
      <p style={{ color: "#999", fontSize: 12, marginBottom: 16 }}>
        拍照识别中未匹配到系统资料的材料，由豆包视觉识别后生成建议；**人工确认后才新增材料**（可在系统设置配置豆包 API Key）。
      </p>
      <DataTable rowKey="id" columns={columns} dataSource={list} pagination={{ current: page, pageSize, total, onChange: (p: number, ps: number) => { if (ps !== pageSize) { setPage(1); setPageSize(ps); } else { setPage(p); } } }}  rowSelection onBatchDelete={async (keys) => { for (const k of keys) await aiApi.ignore(Number(k)); message.success(`已忽略 ${keys.length} 条建议`); void load(); }} />

      <Modal title="确认新增材料" open={Boolean(accepting)} onOk={() => void doAccept()} onCancel={() => setAccepting(null)}>
        <Space orientation="vertical" style={{ width: "100%" }}>
          <Input placeholder="材料名称（缺省用 AI 建议名）" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          <Space>
            <Select style={{ width: 180 }} placeholder="分类" options={categories} fieldNames={{ label: "name", value: "id" }} value={form.category_id || undefined} onChange={(v) => setForm((f) => ({ ...f, category_id: v }))} allowClear />
            <Select style={{ width: 140 }} placeholder="单位" options={units} fieldNames={{ label: "name", value: "id" }} value={form.unit_id || undefined} onChange={(v) => setForm((f) => ({ ...f, unit_id: v }))} />
            <InputNumber style={{ width: 120 }} placeholder="进价" min={0} value={Number(form.purchase_price)} onChange={(v) => setForm((f) => ({ ...f, purchase_price: String(v ?? 0) }))} />
          </Space>
        </Space>
      </Modal>
    </div>
  );
}
