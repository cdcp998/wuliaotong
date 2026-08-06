import { useCallback, useEffect, useState } from "react";
import { App, Select, Space, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";

import { systemApi } from "@wlt/shared";

import { DataTable } from "../components/DataTable";

interface LlmLogRow {
  id: number;
  scene: string;
  model: string;
  prompt: string;
  output: string;
  status: string;
  error: string;
  duration_ms: number;
  created_at: string;
}

/** AI 调用日志（P9）：大模型输入/输出/耗时/成败记录，供后期调整与学习。 */
export function AiLogsPage() {
  const { message } = App.useApp();
  const [list, setList] = useState<LlmLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [scene, setScene] = useState("");
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await systemApi.llmLogs(scene, status, page, pageSize);
      setList(d.list);
      setTotal(d.total);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [scene, status, page, pageSize, message]);

  useEffect(() => {
    void load();
  }, [load]);

  const SCENES = [
    "vision_delivery", "vision_product", "vision_text", "match_vision",
    "ocr_correct", "classify_items", "structured", "alert_text",
    "dedupe", "supplier_norm", "req_summary",
  ];

  const columns: ColumnsType<LlmLogRow> = [
    { title: "时间", dataIndex: "created_at", width: 150 },
    {
      title: "场景", dataIndex: "scene", width: 140,
      render: (v: string) => (v ? <Tag>{v}</Tag> : "-"),
    },
    { title: "模型", dataIndex: "model", width: 100 },
    {
      title: "状态", dataIndex: "status", width: 80,
      render: (v: string) => <Tag color={v === "ok" ? "green" : "red"}>{v === "ok" ? "成功" : "失败"}</Tag>,
    },
    { title: "耗时(ms)", dataIndex: "duration_ms", width: 90 },
    {
      title: "输入", dataIndex: "prompt", width: 280, ellipsis: true,
      render: (v: string) => <span style={{ fontSize: 12, whiteSpace: "pre-wrap" }}>{v?.slice(0, 200)}{(v?.length ?? 0) > 200 ? "…" : ""}</span>,
    },
    {
      title: "输出", dataIndex: "output", width: 300, ellipsis: true,
      render: (v: string) => <span style={{ fontSize: 12, whiteSpace: "pre-wrap" }}>{v?.slice(0, 300)}{(v?.length ?? 0) > 300 ? "…" : ""}</span>,
    },
    {
      title: "错误", dataIndex: "error", width: 200, ellipsis: true,
      render: (v: string) => (v ? <Typography.Text type="danger" style={{ fontSize: 12 }}>{v.slice(0, 120)}</Typography.Text> : ""),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Typography.Title level={4} style={{ marginTop: 0 }}>AI 调用日志</Typography.Title>
      <Typography.Text type="secondary">大模型调用输入/输出/耗时/成败全部记录（输入输出截断保存），供后期调整提示词与学习。</Typography.Text>
      <Space style={{ margin: "12px 0" }} wrap>
        <Select
          style={{ width: 200 }}
          placeholder="场景"
          allowClear
          options={SCENES.map((s) => ({ value: s, label: s }))}
          value={scene || undefined}
          onChange={(v) => { setScene(v ?? ""); setPage(1); }}
        />
        <Select
          style={{ width: 120 }}
          placeholder="状态"
          allowClear
          options={[{ value: "ok", label: "成功" }, { value: "error", label: "失败" }]}
          value={status || undefined}
          onChange={(v) => { setStatus(v ?? ""); setPage(1); }}
        />
      </Space>
      <DataTable
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={list}
        scroll={{ x: 1400 }}
        pagination={{ current: page, pageSize, total, onChange: (p: number, ps: number) => { if (ps !== pageSize) { setPage(1); setPageSize(ps); } else { setPage(p); } } }}
      />
    </div>
  );
}
