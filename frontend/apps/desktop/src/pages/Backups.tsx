import { useCallback, useEffect, useState } from "react";
import { App, Button, Popconfirm, Space, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";

import { adminApi, type BackupRecord } from "@wlt/shared";

import { DataTable } from "../components/DataTable";

function fmtSize(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

/** 备份管理（电脑端，超管 sys:backup）：手动备份 / 下载 / 删除；每日 02:00 自动备份。 */
export function BackupsPage() {
  const { message } = App.useApp();
  const [list, setList] = useState<BackupRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setList([]); // 清空旧数据，避免切换每页条数时 dataSource 与分页配置不匹配
    try {
    const data = await adminApi.backups(page, pageSize);
    setList(data.list);
    setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize]);

  useEffect(() => {
    void load().catch((e) => message.error(e instanceof Error ? e.message : "加载失败"));
  }, [load]);

  async function doBackup() {
    setBusy(true);
    try {
      const d = await adminApi.createBackup();
      message.success(`备份完成：${d.file_path}（${fmtSize(d.file_size)}）`);
      setPage(1);
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "备份失败");
    } finally {
      setBusy(false);
    }
  }

  const columns: ColumnsType<BackupRecord> = [
    { title: "时间", dataIndex: "created_at", width: 170 },
    { title: "文件名", dataIndex: "file_path" },
    { title: "大小", dataIndex: "file_size", width: 110, render: (v: number) => fmtSize(v) },
    { title: "类型", dataIndex: "backup_type", width: 90, render: (v: string) => (v === "auto" ? <Tag color="blue">自动</Tag> : <Tag color="green">手动</Tag>) },
    { title: "状态", dataIndex: "status", width: 80, render: (v: number) => (v === 1 ? <Tag color="green">成功</Tag> : <Tag color="red">失败</Tag>) },
    {
      title: "操作",
      width: 160,
      render: (_, r) => (
        <Space>
          <Button size="small" onClick={() => window.open(adminApi.backupDownloadUrl(r.id))}>下载</Button>
          <Popconfirm
            title="删除该备份（文件与记录）？"
            onConfirm={async () => {
              try {
                await adminApi.deleteBackup(r.id);
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
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>备份管理</h2>
        <Button type="primary" loading={busy} onClick={() => void doBackup()}>立即备份</Button>
      </div>
      <p style={{ color: "#5B6478", fontSize: 12, marginBottom: 16 }}>
        每日 02:00 自动备份（保留最近 14 份，更早自动清理）；备份文件为 gzip 压缩的 mysqldump 导出。
      </p>
      <DataTable rowKey="id" loading={loading} size="small" columns={columns} dataSource={list} pagination={{ current: page, pageSize, total, onChange: (p: number, ps: number) => { if (ps !== pageSize) { setPage(1); setPageSize(ps); } else { setPage(p); } } }} rowSelection onBatchDelete={async (keys) => { for (const k of keys) await adminApi.deleteBackup(Number(k)); message.success(`已删除 ${keys.length} 个备份`); void load(); }} />
    </div>
  );
}
