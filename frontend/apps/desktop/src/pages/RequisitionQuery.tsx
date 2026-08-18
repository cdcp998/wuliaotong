import { useCallback, useEffect, useState } from "react";
import { App, Button, Drawer, Input, Modal, Select, Space, Tag } from "antd";
import { ExclamationCircleFilled } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";

import { FileImage, requisitionApi, type RequisitionBill, type RequisitionDetail } from "@wlt/shared";

import { DataTable } from "../components/DataTable";

import { GeoAddressPanel } from "../components/GeoAddressPanel";

const STATUS: Record<number, { text: string; color: string }> = {
  1: { text: "待完成工作", color: "gold" },
  2: { text: "待审计", color: "blue" },
  3: { text: "已完成", color: "green" },
  4: { text: "已驳回", color: "red" },
  5: { text: "已取消", color: "default" },
};

/** 领用申请单查询（电脑端）：全部领用单多状态查询 + 详情（含完成工作照片/水印下载/私用标注）。 */
export function RequisitionQueryPage() {
  const { message } = App.useApp();
  const [status, setStatus] = useState<number | undefined>(undefined);
  const [keyword, setKeyword] = useState("");
  const [list, setList] = useState<RequisitionBill[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<RequisitionDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [locOpen, setLocOpen] = useState(false); // 编辑 GPS/地点弹窗

  const load = useCallback(async (st: number | undefined, kw: string, pg: number) => {
    setLoading(true);
    setList([]); // 清空旧数据，避免切换每页条数瞬间 dataSource 与分页配置不匹配
    try {
      const d = await requisitionApi.list(st, pg, kw, pageSize);
      setList(d.list);
      setTotal(d.total);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [message, pageSize]);

  useEffect(() => {
    void load(status, keyword, page);
  }, [status, keyword, page, pageSize, load]);

  async function openDetail(r: RequisitionBill) {
    try {
      setDetail(await requisitionApi.detail(r.id));
      setDetailOpen(true);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
    }
  }

  const columns: ColumnsType<RequisitionBill> = [
    { title: "单号", dataIndex: "bill_no", width: 150, render: (v: string, r) => <a onClick={() => void openDetail(r)}><b>{v}</b></a> },
    { title: "申请人", dataIndex: "applicant_name", width: 100 },
    { title: "仓库", dataIndex: "warehouse_name", width: 120 },
    { title: "使用地点", dataIndex: "use_location", width: 150, render: (v?: string) => v || "-" },
    {
      title: "因何使用",
      dataIndex: "use_reason",
      ellipsis: true,
      render: (v: string, r) =>
        r.is_private === 1 ? (
          <Space size={4}>
            <Tag color="red" style={{ marginRight: 0 }}>私用</Tag>
            <span title={v}>{v}</span>
          </Space>
        ) : (
          <span title={v}>{v}</span>
        ),
    },
    { title: "总数量", dataIndex: "total_qty", width: 90, align: "right" as const },
    {
      title: "完成拍照",
      width: 90,
      render: (_, r) => (r.work_photo_file_id > 0 ? <Tag color="green">已留痕</Tag> : <span style={{ color: "#c9cdd4" }}>未拍</span>),
    },
    { title: "状态", width: 100, render: (_, r) => <Tag color={STATUS[r.status]?.color}>{STATUS[r.status]?.text ?? r.status}</Tag> },
    { title: "申请时间", dataIndex: "created_at", width: 150, render: (v?: string) => (v ? v.slice(0, 16) : "-") },
    {
      title: "操作",
      width: 90,
      render: (_, r) => (
        <Button type="link" size="small" onClick={() => void openDetail(r)}>查看详情</Button>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ margin: "0 0 16px" }}>领用申请单查询</h2>
      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          style={{ width: 140 }}
          options={[
            { value: undefined, label: "全部状态" },
            { value: 1, label: "待完成工作" },
            { value: 2, label: "待审计" },
            { value: 3, label: "已完成" },
            { value: 4, label: "已驳回" },
            { value: 5, label: "已取消" },
          ]}
        />
        <Input.Search
          placeholder="单号 / 使用地点 / 因何使用"
          allowClear
          onSearch={(v) => {
            setKeyword(v);
            setPage(1);
          }}
          style={{ width: 260 }}
        />
        <span style={{ color: "#646a73", fontSize: 12 }}>流程：领用申请 → 完成工作拍照（含定位水印）→ 审计 → 完成</span>
      </Space>
      <DataTable
        rowKey="id"
        columns={columns}
        dataSource={list}
        loading={loading}
        size="middle"
        locale={{ emptyText: "暂无领用单" }}
        pagination={{ current: page, pageSize, total, onChange: (p: number, ps: number) => { if (ps !== pageSize) { setPage(1); setPageSize(ps); } else { setPage(p); } }, showTotal: (t) => `共 ${t} 条` }}
       rowSelection onBatchDelete={async (keys) => { for (const k of keys) await requisitionApi.cancel(Number(k)); message.success(`已取消 ${keys.length} 张申请`); void load(status, keyword, page); }} />

      <Drawer title="领用申请单详情" size={600} open={detailOpen} onClose={() => setDetailOpen(false)} destroyOnHidden>
        {detail && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 18px", background: "#fafbfc", border: "1px solid #f0f1f3", borderRadius: 8, padding: "12px 14px" }}>
              <div><div style={{ fontSize: 12, color: "#646a73" }}>单号</div><div style={{ fontWeight: 600 }}>{detail.bill_no}</div></div>
              <div><div style={{ fontSize: 12, color: "#646a73" }}>申请人</div><div>{detail.applicant_name}</div></div>
              <div><div style={{ fontSize: 12, color: "#646a73" }}>出库仓库</div><div>{detail.warehouse_name}</div></div>
              <div><div style={{ fontSize: 12, color: "#646a73" }}>状态</div><div><Tag color={STATUS[detail.status]?.color}>{STATUS[detail.status]?.text ?? detail.status}</Tag></div></div>
              <div><div style={{ fontSize: 12, color: "#646a73" }}>申请时间</div><div>{detail.created_at?.slice(0, 16) ?? "-"}</div></div>
              <div><div style={{ fontSize: 12, color: "#646a73" }}>总数量</div><div>{detail.total_qty}</div></div>
              <div style={{ gridColumn: "1/-1" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontSize: 12, color: "#646a73" }}>使用地点（水印/记录用）</div>
                  <Button size="small" type="link" onClick={() => setLocOpen(true)}>编辑 GPS 与地点</Button>
                </div>
                <div style={{ fontWeight: 500 }}>{detail.use_location || "-"}</div>
                <div style={{ fontSize: 11.5, color: "#646a73", marginTop: 2 }}>
                  GPS：{detail.work_lat && detail.work_lng ? `${detail.work_lat}, ${detail.work_lng}` : "未记录"}
                  {detail.work_lat && detail.work_lng && (
                    <span style={{ marginLeft: 8 }}>（可通过 GPS 反查地址补全）</span>
                  )}
                </div>
              </div>
              <div style={{ gridColumn: "1/-1" }}>
                <div style={{ fontSize: 12, color: "#646a73" }}>因何使用</div>
                <div style={{ fontWeight: 500 }}>
                  {detail.use_reason}
                  {detail.is_private === 1 && <Tag color="red" style={{ marginLeft: 8 }}>私用</Tag>}
                </div>
              </div>
            </div>

            {detail.is_private === 1 && (
              <div style={{ background: "#fff1f0", border: "1px solid #ffccc7", borderRadius: 8, padding: "10px 12px", marginTop: 10, fontSize: 13 }}>
                <b style={{ color: "#cf1322", display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <ExclamationCircleFilled /> 私用申请
                </b>
                <div style={{ color: "#873800", marginTop: 4, lineHeight: 1.7 }}>
                  因何使用已锁定为「私用」；非管理员（含申请人）看到的「使用地点 / 因何使用」为固定话术：{detail.display_location} / {detail.display_reason}
                </div>
              </div>
            )}

            {detail.work_photo_file_id > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, color: "#646a73", marginBottom: 6 }}>完成工作照片（工作地点留痕，下载时自动添加地点/时间/定位水印）</div>
                <Space>
                  <FileImage fileId={detail.work_photo_file_id} size={96} alt="完成工作照片" />
                  <div style={{ fontSize: 12, color: "#646a73" }}>
                    <div>{detail.work_done_at ? `完成时间：${detail.work_done_at.slice(0, 16)}` : ""}</div>
                    <div>{detail.work_lat ? `定位：${detail.work_lat}, ${detail.work_lng}` : "未获取定位"}</div>
                    <Button size="small" style={{ marginTop: 6 }} onClick={() => { window.open(requisitionApi.workPhotoUrl(detail.id), "_self"); }}>
                      下载水印照片
                    </Button>
                  </div>
                </Space>
              </div>
            )}

            <div style={{ fontWeight: 600, fontSize: 13, margin: "16px 0 8px" }}>领用明细（{detail.items.length} 项）</div>
            <DataTable
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={detail.items}
              columns={[
                { title: "材料", dataIndex: "product_name", render: (v, r) => <div><b>{v}</b><div style={{ fontSize: 11, color: "#646a73" }}>{r.code}{r.spec ? ` / ${r.spec}` : ""}</div></div> },
                { title: "库位", dataIndex: "location_code", width: 120 },
                { title: "数量", dataIndex: "qty", width: 90, align: "right" as const },
              ]}
            />

            {detail.status === 3 && detail.audit_name && (
              <div style={{ background: "#f6ffed", border: "1px solid #b7eb8f", color: "#389e0d", borderRadius: 6, padding: "8px 12px", fontSize: 13, marginTop: 12 }}>
                已由 {detail.audit_name} 于 {detail.audit_time?.slice(0, 16)} 审计通过，流程完成。
              </div>
            )}
            {detail.status === 4 && detail.audit_remark && (
              <div style={{ background: "#fff1f0", border: "1px solid #ffccc7", color: "#cf1322", borderRadius: 6, padding: "8px 12px", fontSize: 13, marginTop: 12 }}>
                驳回原因：{detail.audit_remark}
              </div>
            )}
          </div>
        )}
      </Drawer>

      <Modal
        title="编辑 GPS 坐标与地点"
        open={locOpen}
        footer={null}
        onCancel={() => setLocOpen(false)}
        width={600}
        destroyOnHidden
      >
        {detail && (
          <div>
            <div style={{ fontSize: 12, color: "#646a73", marginBottom: 10, lineHeight: 1.7 }}>
              适用场景：完成工作照片没有原始地点记录时，输入 GPS 坐标反查地址补全；保存后水印照片将按新地点/坐标生成。
            </div>
            <GeoAddressPanel
              lat={detail.work_lat}
              lng={detail.work_lng}
              location={detail.use_location}
              onCancel={() => setLocOpen(false)}
              onSaved={async (lat, lng, location) => {
                try {
                  await requisitionApi.updateWorkLocation(detail.id, location, lat, lng);
                  message.success("GPS 与地点已更新（水印将按新值生成）");
                  setLocOpen(false);
                  setDetail(await requisitionApi.detail(detail.id));
                } catch (e) {
                  message.error(e instanceof Error ? e.message : "保存失败");
                }
              }}
            />
          </div>
        )}
      </Modal>
    </div>
  );
}
