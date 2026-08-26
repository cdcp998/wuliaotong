/** cable 模块：线路故障管理（/cable/faults，fault:manage / fault:report）。
 *  v6 任务池驱动流程：故障上报即发布故障任务入池 → 维修人员寻找/处理
 *  （后台可标记故障点）→ 领料可选 → 处理完毕(图片可选) → 后台审核通过归档/驳回退回重做；
 *  故障状态完全由关联任务自动同步，不再手动流转；支持 ?focus={fault_id} 跨页定位。 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { App, Button, Drawer, Image, Input, Modal, Popconfirm, Select, Space, Table, Tag, Tooltip, theme, Upload } from "antd";
import { AimOutlined, CameraOutlined, DeleteOutlined, EnvironmentOutlined, PlusOutlined, ReloadOutlined, UploadOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";

import { baseApi, fileApi, useAuthStore } from "@wlt/shared";

import { cableApi, type CableItem, FAULT_STATUS, type FaultItem } from "./api";
import { CableFaultForm } from "./CableFaultForm";
import { taskApi } from "../task/api";
import { mapApi, type MapSourceInfo } from "../map/api";
import { MapView } from "../map/MapView";

const SEVERITY: Record<number, { label: string; fg: string; bg: string }> = {
  1: { label: "低", fg: "#7C3AED", bg: "#F3E8FF" },
  2: { label: "中", fg: "#B45309", bg: "#FEF4E2" },
  3: { label: "高", fg: "#B91C1C", bg: "#FDEBEC" },
};

interface PhotoItem { id: number; file_id: number; category: string; remark: string; url: string }

export function CableFaultsPage() {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const me = useAuthStore((s) => s.user);
  const moduleEnabled = useAuthStore((s) => s.moduleEnabled);
  const taskEnabled = moduleEnabled("task");
  // 标记故障点为后台人员能力（调度员/管理者）
  const isManager = ["super_admin", "manager", "dispatcher"].includes(me?.role?.code ?? "");
  const [rows, setRows] = useState<FaultItem[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [filterStatus, setFilterStatus] = useState("");
  const [filterSeverity, setFilterSeverity] = useState("");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState<Record<string, MapSourceInfo>>({});
  const [cables, setCables] = useState<CableItem[]>([]); // 地图叠层：线缆上下文
  const [detail, setDetail] = useState<FaultItem | null>(null);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [creatingTask, setCreatingTask] = useState(false);
  const [locFault, setLocFault] = useState<FaultItem | null>(null);
  /** 后台标记故障点：{fault, lat, lng} 选点态（未标记故障 lat/lng 为 null，选点后写入） */
  const [markTarget, setMarkTarget] = useState<{ fault: FaultItem; lat: number | null; lng: number | null } | null>(null);
  const [delFault, setDelFault] = useState<FaultItem | null>(null);
  const [delReason, setDelReason] = useState("");
  const [delSubmitting, setDelSubmitting] = useState(false);
  const focusedId = searchParams.get("focus");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await cableApi.listFaults({ status: filterStatus, severity: filterSeverity, page, page_size: pageSize });
      setRows(r.items);
      setTotal(r.total);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载故障列表失败");
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterSeverity, page, pageSize, message]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    mapApi.mapSources().then((s) => setSources(s.map_sources)).catch(() => undefined);
    // 地图叠层上下文：线缆（上限 100 条，与上报表单同源）
    cableApi.listCables({ page_size: 100 }).then((r) => setCables(r.items)).catch(() => undefined);
    // 状态计数（含全部）；逐态拉取 total（page_size=1 仅取计数）
    Promise.all([["", "全部"], ...Object.entries(FAULT_STATUS).map(([k, v]) => [k, v.label])].map(async ([st]) => {
      try {
        const r = await cableApi.listFaults({ status: st, page: 1, page_size: 1 });
        return [st, r.total] as const;
      } catch { return [st, 0] as const; }
    })).then((cs) => setCounts(Object.fromEntries(cs)));
  }, []);

  /** 跨页定位：?focus={fault_id} → 自动打开详情抽屉（看板/列表跳转入口）。 */
  useEffect(() => {
    if (!focusedId || loading || rows.length === 0) return;
    const f = rows.find((x) => String(x.id) === focusedId);
    if (f) void openDetail(f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, loading]);

  const openCreate = () => {
    setOpen(true);
  };

  /** 发布故障任务（反向关联）：创建关联本故障的任务并立即进入任务池。 */
  const createLinkedTask = async (f: FaultItem) => {
    setCreatingTask(true);
    try {
      await taskApi.create({
        fault_id: f.id,
        title: `${f.fault_type || "线路故障"}维修 #${f.id}`.slice(0, 100),
        description: f.description || "",
        priority: f.severity >= 3 ? 2 : 1,
      });
      message.success("故障任务已发布到任务池，维修人员可在看板领取处理");
      setDetail(null);
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "发布失败");
    } finally {
      setCreatingTask(false);
    }
  };

  /** 故障上报成功 → 自动发布关联任务入任务池（v2 流程第一步）；失败仅提示不阻断上报。 */
  const onReportSubmitted = async (
    faultId: number,
    info?: { fault_type: string; severity: number; description: string },
  ) => {
    setOpen(false);
    if (!taskEnabled) { void load(); return; }
    try {
      await taskApi.create({
        fault_id: faultId,
        title: `${info?.fault_type || "线路故障"}维修 #${faultId}`.slice(0, 100),
        description: info?.description || "",
        priority: (info?.severity ?? 1) >= 3 ? 2 : 1,
      });
      message.success(`故障 #${faultId} 已上报，任务已发布到任务池`);
    } catch (e) {
      message.warning(`故障 #${faultId} 已上报；自动发布任务失败（${e instanceof Error ? e.message : "无权限"}），可在列表「发布故障任务」手动补发`);
    }
    void load();
  };

  /** 后台标记故障点：保存新坐标（后端按关联线缆重算累计距离）。 */
  const saveMarkedPoint = async () => {
    if (!markTarget || markTarget.lat == null || markTarget.lng == null) {
      message.warning("请先在地图上点击选择故障点位置");
      return;
    }
    try {
      await cableApi.updateFault(markTarget.fault.id, { lat: markTarget.lat, lng: markTarget.lng });
      message.success(`故障 #${markTarget.fault.id} 故障点已标记`);
      setMarkTarget(null);
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    }
  };

  const removeFault = async (f: FaultItem) => {
    try {
      await cableApi.deleteFault(f.id);
      message.success("故障已删除（软删除，列表与地图均不再显示）");
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "删除失败");
    }
  };

  const submitDelReview = async () => {
    if (!delFault) return;
    if (!delReason.trim()) {
      message.warning("请填写删除原因");
      return;
    }
    setDelSubmitting(true);
    try {
      await baseApi.submitDeleteReview({ biz_type: "fault", target_id: delFault.id, reason: delReason.trim() });
      message.success("已提交删除申请，待管理员审核（可在「系统管理 → 删除审核」查看进度）");
      setDelFault(null);
      setDelReason("");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "提交失败");
    } finally {
      setDelSubmitting(false);
    }
  };

  const openDetail = async (f: FaultItem) => {
    setDetail(f);
    setPhotos([]);
    try {
      setPhotos(await cableApi.listFaultPhotos(f.id));
    } catch {
      setPhotos([]);
    }
  };

  const uploadPhoto = async (file: File) => {
    if (!detail) return false;
    try {
      const up = await fileApi.upload(file, "fault");
      await cableApi.addFaultPhoto(detail.id, up.file_id, "维修后");
      setPhotos(await cableApi.listFaultPhotos(detail.id));
      message.success("照片已上传");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "上传失败");
    }
    return false;
  };

  const columns = useMemo<ColumnsType<FaultItem>>(
    () => [
      { title: "故障 / 类型", width: 280, render: (_, f) => (
        <div>
          <div style={{ fontWeight: 700, fontSize: 13.5 }}>{f.description || "未填写描述"}</div>
          <div style={{ fontSize: 11, color: token.colorTextTertiary, marginTop: 2 }}>{f.fault_type || "未分类"} · #{f.id} {f.cumulative_distance > 0 ? `· 距起点 ${f.cumulative_distance.toFixed(0)} m` : ""}</div>
        </div>
      ) },
      { title: "严重度", width: 90, render: (_, f) => { const s = SEVERITY[f.severity]; return <Tag style={{ borderRadius: 999, background: s?.bg, color: s?.fg, borderColor: "transparent", marginInlineEnd: 0 }}>{s?.label ?? f.severity}</Tag>; } },
      { title: "位置", width: 180, render: (_, f) => f.lat != null && f.lng != null
        ? <span style={{ fontSize: 12, color: token.colorTextSecondary, fontVariantNumeric: "tabular-nums" }}>{f.lat.toFixed(6)}, {f.lng.toFixed(6)}</span>
        : <Tag style={{ borderRadius: 999, background: "#FEF4E2", color: "#B45309", borderColor: "transparent", marginInlineEnd: 0 }}>待标记</Tag> },
      { title: "状态", width: 110, render: (_, f) => { const s = FAULT_STATUS[f.status]; return <Tag style={{ borderRadius: 999, background: s?.bg, color: s?.fg, borderColor: "transparent", marginInlineEnd: 0 }}>{s?.label ?? f.status}</Tag>; } },
      {
        title: "关联维修任务", key: "linked", width: 190,
        render: (_, f) => {
          const linked = f.linked_tasks ?? [];
          if (linked.length === 0) {
            return taskEnabled ? (
              <Button type="link" size="small" icon={<PlusOutlined />} style={{ padding: 0, fontSize: 12 }} onClick={() => createLinkedTask(f)}>发布故障任务</Button>
            ) : <span style={{ color: token.colorTextTertiary, fontSize: 12 }}>—</span>;
          }
          return (
            <Space size={4} wrap>
              {linked.slice(0, 2).map((t) => (
                <Tooltip key={t.id} title={`${t.task_no} · ${t.title}（点击查看任务）`}>
                  <Tag style={{ borderRadius: 999, cursor: "pointer", background: "#EAEFFF", color: "#3B5BDB", borderColor: "transparent", marginInlineEnd: 0 }}
                    onClick={() => navigate(`/task/list?focus_task=c${t.id}`)}>
                    {t.task_no}
                  </Tag>
                </Tooltip>
              ))}
              {linked.length > 2 && <span style={{ fontSize: 11, color: token.colorTextTertiary }}>+{linked.length - 2}</span>}
            </Space>
          );
        },
      },
      { title: "上报时间", dataIndex: "reported_at", width: 140, render: (v: string) => (v ? <span style={{ fontSize: 12 }}>{new Date(v).toLocaleString()}</span> : <span style={{ color: token.colorTextTertiary }}>—</span>) },
      {
        title: "操作", width: 170,
        render: (_, f) => (
          <Space size={2}>
            {isManager && (
              <Tooltip title="标记故障点（后台标注/修正位置）">
                <Button size="small" icon={<EnvironmentOutlined />} onClick={() => setMarkTarget({ fault: f, lat: f.lat, lng: f.lng })} />
              </Tooltip>
            )}
            {f.lat != null && f.lng != null && (
              <Tooltip title="定位到故障点"><Button size="small" icon={<AimOutlined />} onClick={() => setLocFault(f)} /></Tooltip>
            )}
            <Tooltip title="照片/详情"><Button size="small" icon={<CameraOutlined />} onClick={() => openDetail(f)} /></Tooltip>
            {f.status === 5 ? (
              <Tooltip title="删除（已关闭故障，需管理员审核）">
                <Button size="small" danger icon={<DeleteOutlined />} onClick={() => { setDelFault(f); setDelReason(""); }} />
              </Tooltip>
            ) : (
              <Popconfirm title={`确认删除故障 #${f.id}？删除后列表与地图均不再显示。`} onConfirm={() => removeFault(f)}>
                <Tooltip title="删除"><Button size="small" danger icon={<DeleteOutlined />} /></Tooltip>
              </Popconfirm>
            )}
          </Space>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token, taskEnabled, isManager],
  );

  return (
    <div style={{ padding: 24 }}>
      {/* 页头 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>线路故障管理</h2>
          <p style={{ margin: "6px 0 0", fontSize: 12.5, color: token.colorTextSecondary }}>
            故障上报即发布任务入池 → 维修人员寻找故障点处理 → 后台审核通过归档 / 驳回退回重做；状态由关联任务自动同步
          </p>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>故障上报</Button>
        </Space>
      </div>

      {/* 状态 Tabs + 严重度 */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
        {[["", "全部"], ...Object.entries(FAULT_STATUS).map(([k, v]) => [k, v.label] as [string, string])].map(([st, label]) => {
          const active = filterStatus === st;
          return (
            <button key={st} type="button" onClick={() => { setFilterStatus(st); setPage(1); }}
              style={{ cursor: "pointer", border: `1px solid ${active ? "#5B7FFF" : token.colorBorder}`, background: active ? "#5B7FFF" : "#fff", color: active ? "#fff" : token.colorTextSecondary, borderRadius: 999, padding: "6px 14px", fontSize: 12.5, fontWeight: active ? 600 : 500, display: "inline-flex", gap: 6, alignItems: "center", fontFamily: "inherit", transition: "all .2s ease" }}>
              {label} <span style={{ opacity: 0.75, fontWeight: 600 }}>{counts[st] ?? "…"}</span>
            </button>
          );
        })}
        <Select placeholder="全部严重度" allowClear style={{ width: 140, marginLeft: "auto" }} value={filterSeverity || undefined}
          onChange={(v) => { setFilterSeverity(v ?? ""); setPage(1); }}
          options={Object.entries(SEVERITY).map(([k, v]) => ({ value: Number(k), label: v.label }))} />
      </div>

      {/* 表格 */}
      <div className="wlt-glass" style={{ padding: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 4px 10px" }}>
            <span style={{ fontSize: 12, color: token.colorTextTertiary }}>共 {total} 条故障记录</span>
            <span style={{ flex: 1 }} />
            <Button size="small" icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
          </div>
          <Table<FaultItem>
            rowKey="id"
            loading={loading}
            dataSource={rows}
            locale={{ emptyText: "暂无故障" }}
            pagination={{ current: page, pageSize, total, showSizeChanger: true, showTotal: (t) => `共 ${t} 条`, onChange: (p, ps) => { if (ps !== pageSize) { setPage(1); setPageSize(ps); } else setPage(p); } }}
            columns={columns}
            rowClassName={(r) => (String(r.id) === focusedId ? "wlt-row-focus" : "")}
          />
        </div>

      {/* 故障上报弹窗（复用 CableFaultForm；上报成功即自动发布关联任务入任务池） */}
      <Modal
        open={open}
        onCancel={() => setOpen(false)}
        title="故障上报（自动发布故障任务）"
        width={640}
        destroyOnHidden
        footer={null}
      >
        <CableFaultForm
          onCancel={() => setOpen(false)}
          onSubmitted={(faultId) => void onReportSubmitted(faultId)}
        />
      </Modal>

      {/* 定位到故障点（内嵌地图；未标记位置不可进入） */}
      <Modal open={!!locFault} onCancel={() => setLocFault(null)} footer={null} title={locFault ? `故障 #${locFault.id} 位置` : ""} width={720} destroyOnHidden>
        {locFault && locFault.lat != null && locFault.lng != null && (
          <>
            <p style={{ marginBottom: 8, color: token.colorTextSecondary, fontSize: 12.5 }}>
              {locFault.fault_type || "未分类"} · 状态：{FAULT_STATUS[locFault.status]?.label} · {locFault.lat.toFixed(6)}, {locFault.lng.toFixed(6)}
            </p>
            <div style={{ height: 420, border: `1px solid ${token.colorBorder}`, borderRadius: 12, overflow: "hidden" }}>
              <MapView sources={sources} center={[locFault.lat, locFault.lng]} zoom={16}
                overlays={{ cables, faults: [locFault], markersByCable: {} }}
                clusterFaults={false} autoFit={false} height="420px" />
            </div>
          </>
        )}
      </Modal>

      {/* 后台标记故障点：地图选点 → 保存新坐标 */}
      <Modal
        open={!!markTarget}
        onCancel={() => setMarkTarget(null)}
        onOk={() => void saveMarkedPoint()}
        okText="保存故障点"
        title={markTarget ? `标记故障点 · 故障 #${markTarget.fault.id}` : ""}
        width={720}
        destroyOnHidden
      >
        {markTarget && (
          <>
            <p style={{ marginBottom: 8, color: token.colorTextSecondary, fontSize: 12.5 }}>
              在地图上点击选择故障点位置（红色高亮为当前选定，蓝色圆点为原位置）；
              {markTarget.fault.lat != null && markTarget.fault.lng != null
                ? <>当前 {markTarget.fault.lat.toFixed(6)}, {markTarget.fault.lng.toFixed(6)}</>
                : "该故障尚未标记位置"}
              {markTarget.lat != null && markTarget.lng != null && <> → 新位置 <b>{markTarget.lat.toFixed(6)}, {markTarget.lng.toFixed(6)}</b></>}
            </p>
            <div style={{ height: 400, border: `1px solid ${token.colorBorder}`, borderRadius: 12, overflow: "hidden" }}>
              <MapView
                sources={sources}
                center={markTarget.lat != null && markTarget.lng != null ? [markTarget.lat, markTarget.lng] : undefined}
                zoom={16}
                overlays={{ cables, faults: [markTarget.fault], markersByCable: {} }}
                highlight={markTarget.lat != null && markTarget.lng != null ? [markTarget.lat, markTarget.lng] : null}
                clusterFaults={false} autoFit={false}
                picking="在地图上单击选择新的故障点位置"
                height="400px"
                onPick={(lat, lng) => setMarkTarget((m) => (m ? { ...m, lat, lng } : m))}
              />
            </div>
          </>
        )}
      </Modal>

      {/* 已关闭故障删除 → 提交管理员审核 */}
      <Modal
        open={!!delFault}
        onCancel={() => setDelFault(null)}
        onOk={submitDelReview}
        confirmLoading={delSubmitting}
        title={delFault ? `删除故障 #${delFault.id}（需管理员审核）` : ""}
        width={520}
        destroyOnHidden
      >
        <p style={{ color: token.colorTextSecondary, fontSize: 12.5 }}>
          已关闭的故障删除需管理员审核：提交申请并通知管理者，审核通过后才会从列表与地图移除（数据保留可追溯，申请进度可在「系统管理 → 删除审核」查看）。
        </p>
        <Input.TextArea rows={3} maxLength={500} placeholder="请填写删除原因（必填）" value={delReason} onChange={(e) => setDelReason(e.target.value)} />
      </Modal>

      {/* 详情抽屉（含反向关联维修任务） */}
      <Drawer open={!!detail} onClose={() => setDetail(null)} size={520} title={detail ? `故障 #${detail.id}` : ""}>
        {detail && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              类型：{detail.fault_type || "—"}　严重度：
              <Tag style={{ borderRadius: 999, background: SEVERITY[detail.severity]?.bg, color: SEVERITY[detail.severity]?.fg, borderColor: "transparent" }}>{SEVERITY[detail.severity]?.label}</Tag>
              　状态：
              <Tag style={{ borderRadius: 999, background: FAULT_STATUS[detail.status]?.bg, color: FAULT_STATUS[detail.status]?.fg, borderColor: "transparent" }}>{FAULT_STATUS[detail.status]?.label}</Tag>
            </div>
            <div style={{ color: token.colorTextSecondary, fontSize: 12.5 }}>
              位置：{detail.lat != null && detail.lng != null ? `${detail.lat.toFixed(6)}, ${detail.lng.toFixed(6)}（累计 ${detail.cumulative_distance.toFixed(1)} m）` : "尚未标记（可由后台「标记故障点」标注）"}
            </div>
            <div style={{ fontSize: 13 }}>描述：{detail.description || "—"}</div>
            {/* 反向关联维修任务：跳转任务列表定位；无关联时可一键转维修任务 */}
            <div style={{ border: `1px solid ${token.colorBorder}`, borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: token.colorTextSecondary }}>关联维修任务</div>
              {(detail.linked_tasks ?? []).length === 0 ? (
                <Space>
                  <span style={{ fontSize: 12, color: token.colorTextTertiary }}>暂无关联任务</span>
                  {taskEnabled && (
                    <Button size="small" type="primary" ghost loading={creatingTask} onClick={() => createLinkedTask(detail)}>发布故障任务</Button>
                  )}
                  {!taskEnabled && <span style={{ fontSize: 11, color: token.colorTextTertiary }}>(安装启用「任务管理」后可将故障发布为任务)</span>}
                </Space>
              ) : (
                <Space size={6} wrap>
                  {(detail.linked_tasks ?? []).map((t) => (
                    <Tag key={t.id} style={{ borderRadius: 999, cursor: "pointer", background: "#EAEFFF", color: "#3B5BDB", borderColor: "transparent" }}
                      onClick={() => navigate(`/task/list?focus_task=c${t.id}`)}>
                      {t.task_no} · {t.title}
                    </Tag>
                  ))}
                  <Button size="small" type="link" style={{ padding: 0 }} onClick={() => navigate(`/task/board?focus_task=${detail.linked_tasks?.[0] ? `c${detail.linked_tasks[0].id}` : ""}`)}>在看板中查看 ›</Button>
                </Space>
              )}
            </div>
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>照片（{photos.length}）</div>
            <Space wrap>
              {photos.map((p) => (
                <Image key={p.id} src={p.url} width={120} height={90} style={{ objectFit: "cover", borderRadius: 10 }} alt={p.category} />
              ))}
            </Space>
            <Upload showUploadList={false} beforeUpload={uploadPhoto} accept="image/*">
              <Button icon={<UploadOutlined />}>补充照片（维修后）</Button>
            </Upload>
          </div>
        )}
      </Drawer>
    </div>
  );
}
