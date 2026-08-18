import { useCallback, useEffect, useState } from "react";
import { App, Button, Input, Select, Space, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";

import { adminApi, type OperationLog } from "@wlt/shared";

import { DataTable } from "../components/DataTable";

const MODULES = ["auth", "base", "stock", "advanced", "requisition", "ocr", "report", "files", "storage", "system", "admin", "-"];

/** 操作日志（电脑端，超管 sys:log）：写操作审计查询。 */
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

  const load = useCallback(async () => {
    setLoading(true);
    setList([]); // 清空旧数据，避免切换每页条数时 dataSource 与分页配置不匹配
    try {
    const data = await adminApi.logs({ username: username || undefined, module: module || undefined, method: method || undefined, page, page_size: pageSize });
    setList(data.list);
    setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }, [username, module, method, page, pageSize]);

  useEffect(() => {
    void load().catch((e) => messageError(e));
  }, [load]);

  const columns: ColumnsType<OperationLog> = [
    { title: "时间", dataIndex: "created_at", width: 160 },
    { title: "用户", dataIndex: "username", width: 100 },
    { title: "模块", dataIndex: "module", width: 100, render: (v: string) => <Tag>{v}</Tag> },
    { title: "方法", dataIndex: "method", width: 80, render: (v: string) => <Tag color={v === "POST" ? "green" : v === "DELETE" ? "red" : "blue"}>{v}</Tag> },
    { title: "URL", dataIndex: "url", width: 260 },
    { title: "参数", dataIndex: "params", ellipsis: { showTitle: false }, render: (v: string) => v || "-" },
    { title: "IP", dataIndex: "ip", width: 120 },
    { title: "耗时", dataIndex: "duration_ms", width: 80, render: (v: number) => `${v}ms` },
  ];

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ margin: "0 0 16px" }}>操作日志</h2>
      <Space style={{ marginBottom: 16 }} wrap>
        <Input.Search placeholder="用户名" allowClear style={{ width: 160 }} onSearch={(v) => { setUsername(v); setPage(1); }} />
        <Select
          style={{ width: 140 }}
          placeholder="模块"
          allowClear
          options={MODULES.map((m) => ({ label: m, value: m }))}
          onChange={(v) => { setModule(v ?? ""); setPage(1); }}
        />
        <Select
          style={{ width: 110 }}
          placeholder="方法"
          allowClear
          options={["POST", "PUT", "DELETE"].map((m) => ({ label: m, value: m }))}
          onChange={(v) => { setMethod(v ?? ""); setPage(1); }}
        />
        <Button onClick={() => void load()}>查询</Button>
      </Space>
      <DataTable rowKey="id" loading={loading} size="small" columns={columns} dataSource={list} pagination={{ current: page, pageSize, total, onChange: (p: number, ps: number) => { if (ps !== pageSize) { setPage(1); setPageSize(ps); } else { setPage(p); } } }}  rowSelection onBatchDelete={async () => { message.info("该列表为只读数据，不支持删除"); }} />
    </div>
  );
}

function messageError(e: unknown) {
  // 局部提示，避免引入全局 message 依赖
  console.error(e);
}
