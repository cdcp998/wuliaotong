import { useCallback, useEffect, useState } from "react";
import { App, Button, Descriptions, Drawer, Select, Space, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { EyeOutlined, ReloadOutlined } from "@ant-design/icons";

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

/** 详情抽屉：完整展示输入/输出/错误（不受列表截断影响）。 */
function LogDetailDrawer({ record, onClose }: { record: LlmLogRow | null; onClose: () => void }) {
  return (
    <Drawer
      title={`日志详情 #${record?.id ?? ""}`}
      size={760}
      open={!!record}
      onClose={onClose}
      destroyOnHidden
    >
      {record && (
        <>
          <Descriptions size="small" column={2} bordered style={{ marginBottom: 16 }}>
            <Descriptions.Item label="时间">{record.created_at}</Descriptions.Item>
            <Descriptions.Item label="场景">{record.scene || "-"}</Descriptions.Item>
            <Descriptions.Item label="模型">{record.model || "-"}</Descriptions.Item>
            <Descriptions.Item label="状态">
              <Tag style={{ borderRadius: 999, background: record.status === "ok" ? "#E8F9EF" : "#FDEBEC", color: record.status === "ok" ? "#15803D" : "#DC2626", borderColor: "transparent", marginInlineEnd: 0 }}>{record.status === "ok" ? "成功" : "失败"}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="耗时">{record.duration_ms} ms</Descriptions.Item>
          </Descriptions>
          <Typography.Title level={5} style={{ marginTop: 0 }}>输入</Typography.Title>
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", fontSize: 12, lineHeight: 1.6, maxHeight: 320, overflow: "auto", padding: 12, background: "#f7f8fa", borderRadius: 6, marginTop: 0 }}>
            {record.prompt || "（无）"}
          </pre>
          <Typography.Title level={5}>输出</Typography.Title>
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", fontSize: 12, lineHeight: 1.6, maxHeight: 320, overflow: "auto", padding: 12, background: "#f7f8fa", borderRadius: 6 }}>
            {record.output || "（无）"}
          </pre>
          {record.error && (
            <>
              <Typography.Title level={5} type="danger">错误信息</Typography.Title>
              <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", fontSize: 12, lineHeight: 1.6, maxHeight: 200, overflow: "auto", padding: 12, background: "#fff2f0", borderRadius: 6, color: "#cf1322" }}>
                {record.error}
              </pre>
            </>
          )}
        </>
      )}
    </Drawer>
  );
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
  const [detail, setDetail] = useState<LlmLogRow | null>(null);
  const [replaying, setReplaying] = useState<number | undefined>(undefined);

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

  /** 重放失败的大模型调用（设计页 31 失败可重放）。 */
  async function doReplay(r: LlmLogRow) {
    setReplaying(r.id);
    try {
      await systemApi.replayLlmLog(r.id);
      message.success("重放成功，已生成新的调用日志");
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "重放失败");
    } finally {
      setReplaying(undefined);
    }
  }

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
      render: (v: string) => (v
        ? <Tag style={{ borderRadius: 999, background: "#EAEFFF", color: "#3B5BDB", borderColor: "transparent", marginInlineEnd: 0 }}>{v}</Tag>
        : "-"),
    },
    { title: "模型", dataIndex: "model", width: 100 },
    {
      title: "状态", dataIndex: "status", width: 80,
      render: (v: string) => <Tag style={{ borderRadius: 999, background: v === "ok" ? "#E8F9EF" : "#FDEBEC", color: v === "ok" ? "#15803D" : "#DC2626", borderColor: "transparent", marginInlineEnd: 0 }}>{v === "ok" ? "成功" : "失败"}</Tag>,
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
    {
      title: "操作",
      width: 110,
      render: (_, r) => (
        <Space>
          <Button size="small" icon={<EyeOutlined />} onClick={() => setDetail(r)}>详情</Button>
          {r.status === "error" && (
            <Button size="small" icon={<ReloadOutlined />} loading={replaying === r.id} onClick={() => void doReplay(r)}>重放</Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#1E2433", letterSpacing: "-0.01em" }}>AI 调用日志</h2>
          <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "#5B6478" }}>
            大模型调用输入 / 输出 / 耗时 / 成败全部记录，供后期调整提示词与学习；点击行「详情」可查看完整输入 / 输出内容
          </p>
        </div>
      </div>
      <div className="wlt-glass" style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
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
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#8A93A8" }}>共 {total} 条</span>
      </div>
      <div className="wlt-glass" style={{ padding: 12 }}>
        <DataTable
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={list}
          scroll={{ x: 1400 }}
          rowSelection
          batchDeleteConfirm="确定删除选中的日志吗？删除后不可恢复。"
          onBatchDelete={async (keys) => {
            await systemApi.deleteLlmLogs(keys.map(Number));
            message.success(`已删除 ${keys.length} 条日志`);
            void load();
          }}
          actions={(r) => (
            <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => setDetail(r)}>
              详情
            </Button>
          )}
          actionsWidth={80}
          pagination={{ current: page, pageSize, total, onChange: (p: number, ps: number) => { if (ps !== pageSize) { setPage(1); setPageSize(ps); } else { setPage(p); } } }}
        />
      </div>
      <LogDetailDrawer record={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
