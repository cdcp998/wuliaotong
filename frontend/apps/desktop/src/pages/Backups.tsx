import { useCallback, useEffect, useState } from "react";
import { App, Button, Popconfirm, Space, Tag, theme } from "antd";
import type { ColumnsType } from "antd/es/table";

import { adminApi, type BackupRecord } from "@wlt/shared";

import { DataTable } from "../components/DataTable";

function fmtSize(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

/** 备份管理（电脑端，超管 sys:backup；设计页 38 风格）：手动备份 / 下载 / 删除；每日 02:00 自动备份。
 *  支持嵌入系统设置（embedded：去外层标题与内边距）。 */
export function BackupsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const [list, setList] = useState<BackupRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<{ count: number; size: number; auto: number; latest: string }>({ count: 0, size: 0, auto: 0, latest: "" });

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

  // 统计卡（设计页 38：份数/大小/自动任务/最近）
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const all: BackupRecord[] = [];
        for (let p = 1; p <= 5; p++) {
          const d = await adminApi.backups(p, 100);
          all.push(...d.list);
          if (all.length >= d.total || d.list.length === 0) break;
        }
        if (!alive) return;
        let size = 0;
        let auto = 0;
        let latest = "";
        for (const b of all) {
          size += Number(b.file_size) || 0;
          if (b.backup_type === "auto") auto += 1;
          if (!latest || b.created_at > latest) latest = b.created_at;
        }
        setStats({ count: all.length, size, auto, latest });
      } catch {
        /* 统计失败不影响主列表 */
      }
    })();
    return () => {
      alive = false;
    };
  }, [total]);

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
    {
      title: "类型",
      dataIndex: "backup_type",
      width: 90,
      render: (v: string) => (
        <Tag style={{ borderRadius: 999, background: "#EAEFFF", color: "#3B5BDB", borderColor: "transparent", marginInlineEnd: 0 }}>{v === "auto" ? "自动" : "手动"}</Tag>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 90,
      render: (v: number) =>
        v === 1 ? (
          <Tag style={{ borderRadius: 999, background: "#E8F9EF", color: "#15803D", borderColor: "transparent", marginInlineEnd: 0 }}>成功</Tag>
        ) : (
          <Tag style={{ borderRadius: 999, background: "#FDEBEC", color: "#B91C1C", borderColor: "transparent", marginInlineEnd: 0 }}>失败</Tag>
        ),
    },
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
    <div style={{ padding: embedded ? 0 : 24 }}>
      {/* 页头（设计页 38）：标题+副题+右侧主按钮；嵌入设置页时隐藏标题区 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        {!embedded && (
          <div>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>备份管理</h2>
            <p style={{ margin: "6px 0 0", fontSize: 12.5, color: token.colorTextSecondary }}>
              数据库备份：手动 + 每日 02:00 自动，保留最近 14 份滚动清理；gzip 压缩的 mysqldump 导出，支持下载
            </p>
          </div>
        )}
        <Button type="primary" loading={busy} onClick={() => void doBackup()}>立即备份</Button>
      </div>
      {/* 统计卡（设计页 38：彩色大数字在上、灰标签在下） */}
      <div className="wlt-grid" style={{ marginBottom: 16 }}>
        {[
          { label: "备份份数", value: `${stats.count}`, color: "#5B7FFF" },
          { label: "总大小", value: fmtSize(stats.size), color: "#1E2433" },
          { label: "自动任务", value: stats.auto ? `每日 02:00` : "未启用", color: "#15803D" },
          { label: "最近备份", value: stats.latest ? stats.latest.slice(5, 16) : "—", color: "#15803D" },
        ].map((c) => (
          <div key={c.label} className="wlt-glass-sm" style={{ padding: "14px 18px" }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: c.color, fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>{c.value}</div>
            <div style={{ fontSize: 12.5, color: token.colorTextSecondary, marginTop: 4 }}>{c.label}</div>
          </div>
        ))}
      </div>
      {/* 表格卡 */}
      <div className="wlt-glass" style={{ padding: 12 }}>
        <DataTable rowKey="id" loading={loading} size="small" columns={columns} dataSource={list} pagination={{ current: page, pageSize, total, onChange: (p: number, ps: number) => { if (ps !== pageSize) { setPage(1); setPageSize(ps); } else { setPage(p); } } }} rowSelection onBatchDelete={async (keys) => { for (const k of keys) await adminApi.deleteBackup(Number(k)); message.success(`已删除 ${keys.length} 个备份`); void load(); }} />
      </div>
    </div>
  );
}
