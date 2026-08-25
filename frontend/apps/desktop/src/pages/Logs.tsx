import { useCallback, useEffect, useState, type ReactNode } from "react";
import { App, Button, DatePicker, Drawer, Input, Select, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { Dayjs } from "dayjs";
import { DownloadOutlined, SearchOutlined } from "@ant-design/icons";
import dayjs from "dayjs";

import { adminApi, type OperationLog } from "@wlt/shared";

const MODULES = ["认证", "系统", "系统设置", "用户", "角色", "注册审核", "材料", "分类", "供应商", "仓库", "货架", "库位", "组织单位", "删除审核", "导航管理", "采购入库", "采购计划", "期初", "库存调拨", "盘点", "其他出入库", "领用申请", "通知", "OCR/大模型", "AI建议", "文件", "存储", "AI调用日志", "备份", "其他"];

/** HTTP 方法中文化（设计页 37：动作已中文，方法同步中文；筛选仍传英文原值）。 */
const METHOD_LABELS: Record<string, { label: string; bg: string; fg: string }> = {
  POST: { label: "新增", bg: "#E8F9EF", fg: "#15803D" },
  PUT: { label: "修改", bg: "#EAEFFF", fg: "#3B5BDB" },
  PATCH: { label: "更新", bg: "#F3E8FF", fg: "#7C3AED" },
  DELETE: { label: "删除", bg: "#FDEBEC", fg: "#DC2626" },
  GET: { label: "查询", bg: "#EFF3FC", fg: "#5B6478" },
};
const METHOD_CN = (m: string) => METHOD_LABELS[m]?.label ?? m;

/** 时间 → MM-DD HH:mm:ss（设计页 37 时间列）。 */
function fmtTime(v: string): string {
  const d = dayjs(v);
  return d.isValid() ? d.format("MM-DD HH:mm:ss") : "—";
}

/** 详情抽屉字段行。 */
function LogField({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
      <span style={{ width: 56, flexShrink: 0, fontSize: 12, color: "#8A93A8" }}>{label}</span>
      <span style={{ fontSize: 13, color: "#1E2433", fontFamily: mono ? "ui-monospace, SFMono-Regular, Consolas, monospace" : undefined, wordBreak: "break-all" }}>{children}</span>
    </div>
  );
}

/** 操作日志（电脑端，超管 sys:log）：写操作审计查询（模块/动作已中文化、具体化）。 */
export function LogsPage() {
  const { message } = App.useApp();
  const [list, setList] = useState<OperationLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [username, setUsername] = useState("");
  const [module, setModule] = useState("");
  const [method, setMethod] = useState("");
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [detail, setDetail] = useState<OperationLog | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setList([]); // 清空旧数据，避免切换每页条数时 dataSource 与分页配置不匹配
    try {
      const data = await adminApi.logs({
        username: username || undefined,
        module: module || undefined,
        method: method || undefined,
        start: range?.[0]?.format("YYYY-MM-DD"),
        end: range?.[1]?.format("YYYY-MM-DD"),
        page,
        page_size: pageSize,
      });
      setList(data.list);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }, [username, module, method, range, page, pageSize]);

  useEffect(() => {
    void load().catch((e) => message.error(e instanceof Error ? e.message : "加载失败"));
  }, [load]);

  /** 导出当前页为 CSV（设计页 37：可导出）。长数字用 ="…" 包裹，避免 Excel 打开变科学计数法。 */
  function exportCsv() {
    const header = ["时间", "用户", "操作", "模块", "方法", "URL", "参数", "提交内容", "IP", "耗时(ms)", "状态码"];
    const esc = (s: unknown) => {
      let str = String(s ?? "");
      if (/^\d{12,}$/.test(str)) str = `="${str}"`; // 纯数字 ≥12 位：强制文本
      return `"${str.replace(/"/g, '""').replace(/\n/g, " ")}"`;
    };
    const rowsCsv = list.map((r) => [r.created_at, r.username, r.action, r.module, METHOD_CN(r.method), r.url, r.params, r.body, r.ip, r.duration_ms, r.status_code]);
    const csv = [header, ...rowsCsv].map((row) => row.map(esc).join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `操作日志_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /** 详情列摘要：接口路径尾段 + 改动字段名（PUT/POST 取 body 顶层键）+ query 摘录。 */
  function detailSummary(r: OperationLog): string {
    const seg = (r.url || "").split("/").filter(Boolean).pop() ?? "";
    const parts: string[] = [];
    if ((r.method === "PUT" || r.method === "POST" || r.method === "PATCH") && r.body) {
      try {
        const obj = JSON.parse(r.body) as Record<string, unknown>;
        const keys = Object.keys(obj).filter((k) => obj[k] !== "" && obj[k] !== null && obj[k] !== undefined);
        if (keys.length) parts.push(`${keys.slice(0, 3).join("、")}${keys.length > 3 ? ` 等${keys.length}项` : ""}`);
      } catch { /* 非JSON忽略 */ }
    }
    if (r.params && r.params !== "{}") {
      try {
        const q = JSON.parse(r.params) as Record<string, unknown>;
        const kv = Object.entries(q).slice(0, 2).map(([k, v]) => `${k}=${String(v)}`).join(" ");
        if (kv) parts.push(kv);
      } catch { /* 忽略 */ }
    }
    if (!parts.length && seg) parts.push(seg);
    return parts.join(" · ") || "—";
  }

  /** 解析 body/params 为美化 JSON 文本（失败原样返回）。 */
  function prettyJson(v: string | undefined): string {
    if (!v) return "";
    try {
      return JSON.stringify(JSON.parse(v), null, 2);
    } catch {
      return v;
    }
  }

  const columns: ColumnsType<OperationLog> = [
    { title: "时间", dataIndex: "created_at", width: 150, render: (v: string) => <span style={{ fontSize: 12, color: "#8A93A8", fontVariantNumeric: "tabular-nums" }}>{fmtTime(v)}</span> },
    { title: "操作人", dataIndex: "username", width: 100, render: (v: string) => <span style={{ fontSize: 12.5, fontWeight: 500, color: "#1E2433" }}>{v}</span> },
    { title: "模块", dataIndex: "module", width: 120, render: (v: string) => <Tag style={{ borderRadius: 999, background: "#EAEFFF", color: "#3B5BDB", borderColor: "transparent", marginInlineEnd: 0 }}>{v}</Tag> },
    { title: "动作", dataIndex: "action", width: 150, render: (v: string) => <span style={{ fontSize: 12.5, fontWeight: 500, color: "#1E2433" }}>{v}</span> },
    { title: "方法", dataIndex: "method", width: 90, render: (v: string) => {
      const m = METHOD_LABELS[v] ?? { label: v || "—", bg: "#EFF3FC", fg: "#5B6478" };
      return <Tag style={{ borderRadius: 999, background: m.bg, color: m.fg, borderColor: "transparent", marginInlineEnd: 0 }}>{m.label}</Tag>;
    } },
    { title: "详情", key: "detail", ellipsis: true, render: (_, r) => (
      <span style={{ fontSize: 12, color: "#5B6478" }}>
        <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace" }}>{detailSummary(r)}</span>
      </span>
    ) },
    { title: "IP", dataIndex: "ip", width: 120, render: (v: string) => <span style={{ fontSize: 12, color: "#8A93A8", fontVariantNumeric: "tabular-nums" }}>{v || "—"}</span> },
  ];

  return (
    <div style={{ padding: 24 }}>
      {/* 页头（设计页 37）：标题 + 副题 + 右侧 导出 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>操作日志</h2>
          <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "#5B6478" }}>
            全量审计：谁/何时/做了什么（中文动作），支持按用户/模块/时间筛选与导出
          </p>
        </div>
        <Space>
          <Button type="primary" icon={<DownloadOutlined />} onClick={exportCsv}>导出</Button>
        </Space>
      </div>

      {/* 筛选条（设计页 37：搜索 + 模块 + 方法 + 日期 + 统计） */}
      <div className="wlt-glass" style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <Input
          prefix={<SearchOutlined style={{ color: "#8A93A8" }} />}
          placeholder="操作人 / 内容关键词"
          allowClear
          style={{ width: 300, background: "#F6F8FE" }}
          onChange={(e) => { if (!e.target.value) { setUsername(""); setPage(1); } }}
          onPressEnter={(e) => { setUsername((e.target as HTMLInputElement).value.trim()); setPage(1); }}
        />
        <Select
          placeholder="全部模块"
          allowClear
          style={{ width: 160 }}
          value={module || undefined}
          onChange={(v) => { setModule(v ?? ""); setPage(1); }}
          options={MODULES.map((m) => ({ label: m, value: m }))}
        />
        <Select
          placeholder="全部方法"
          allowClear
          style={{ width: 120 }}
          value={method || undefined}
          onChange={(v) => { setMethod(v ?? ""); setPage(1); }}
          options={Object.entries(METHOD_LABELS).filter(([k]) => k !== "GET").map(([value, m]) => ({ label: m.label, value }))}
        />
        <DatePicker.RangePicker
          style={{ width: 210 }}
          value={range}
          onChange={(v) => { setRange(v as [Dayjs | null, Dayjs | null] | null); setPage(1); }}
        />
        <Button style={{ borderColor: "#CBD6EC", color: "#1E2433", background: "#FFFFFF" }} onClick={() => void load()}>查询</Button>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#8A93A8" }}>共 {total} 条</span>
      </div>

      {/* 表格（设计列：时间/操作人/模块/动作/详情/IP；点击行查看完整参数） */}
      <div className="wlt-glass" style={{ padding: 12 }}>
        <Table<OperationLog>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={list}
          locale={{ emptyText: "暂无操作日志" }}
          onRow={(r) => ({ onClick: () => setDetail(r), style: { cursor: "pointer" } })}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p, ps) => { if (ps !== pageSize) { setPage(1); setPageSize(ps); } else { setPage(p); } },
          }}
        />
        <p style={{ margin: "8px 0 0", fontSize: 11, color: "#8A93A8" }}>
          提示：关键操作（模块启停/地图源/删除审核/短信）单独高亮；日志只增不改不删（保留追溯），点击行查看完整参数。
        </p>
      </div>

      <Drawer title="日志详情" open={Boolean(detail)} onClose={() => setDetail(null)} width={480}>
        {detail && (
          <Space direction="vertical" size={10} style={{ width: "100%" }}>
            <LogField label="时间">{detail.created_at}</LogField>
            <LogField label="操作人">{detail.username}</LogField>
            <LogField label="模块">{detail.module}</LogField>
            <LogField label="动作">{detail.action}</LogField>
            <LogField label="方法">
              <Tag style={{ borderRadius: 999, background: METHOD_LABELS[detail.method]?.bg ?? "#EFF3FC", color: METHOD_LABELS[detail.method]?.fg ?? "#5B6478", borderColor: "transparent", marginInlineEnd: 6 }}>{METHOD_CN(detail.method)}</Tag>
              <span style={{ fontSize: 12, color: "#8A93A8" }}>{detail.method}</span>
            </LogField>
            <LogField label="状态码" mono>{detail.status_code ? String(detail.status_code) : "—"}</LogField>
            <LogField label="IP">{detail.ip}</LogField>
            <LogField label="耗时">{detail.duration_ms} ms</LogField>
            <LogField label="URL" mono>{detail.url || "—"}</LogField>
            {detail.body && detail.body !== "{}" ? (
              <div>
                <div style={{ fontSize: 12, color: "#8A93A8", marginBottom: 6 }}>
                  提交内容（具体改动）
                  {detail.method === "PUT" && <span style={{ marginLeft: 6, color: "#B45309" }}>· 修改后各字段值</span>}
                </div>
                <pre style={{ margin: 0, padding: 10, background: "#F0F5FF", border: "1px solid #D9E3FF", borderRadius: 8, fontSize: 12, color: "#1E2433", whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 320, overflowY: "auto" }}>{prettyJson(detail.body)}</pre>
              </div>
            ) : null}
            <div>
              <div style={{ fontSize: 12, color: "#8A93A8", marginBottom: 6 }}>查询参数</div>
              <pre style={{ margin: 0, padding: 10, background: "#F6F8FE", borderRadius: 8, fontSize: 12, color: "#1E2433", whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 200, overflowY: "auto" }}>{prettyJson(detail.params) || "—"}</pre>
            </div>
          </Space>
        )}
      </Drawer>
    </div>
  );
}
