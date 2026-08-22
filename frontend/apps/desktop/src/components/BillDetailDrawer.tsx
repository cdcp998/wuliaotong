import type { ReactNode } from "react";
import { Drawer, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";

import { DataTable } from "./DataTable";

export interface DetailField {
  label: string;
  value: ReactNode;
  span?: number; // 占列数（grid 2 列）
}

export interface DetailRow {
  key: string | number;
  [k: string]: any; // 明细行字段宽松类型（渲染列值用）
}

/** 通用单据详情抽屉：头部字段网格 + 明细表格 + 底部备注/状态信息（所有单据单号点击进入）。 */
export function BillDetailDrawer({
  open,
  onClose,
  title,
  statusTag,
  fields,
  columns,
  rows,
  footer,
  width = 620,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  statusTag?: ReactNode;
  fields: DetailField[];
  columns: ColumnsType<DetailRow>;
  rows: DetailRow[];
  footer?: ReactNode;
  width?: number;
}) {
  return (
    <Drawer
      title={
        <span>
          {title} {statusTag}
        </span>
      }
      size={width}
      open={open}
      onClose={onClose}
      destroyOnHidden
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "10px 18px", background: "#F8FAFF", border: "1px solid #E4EAF6", borderRadius: 12, padding: "12px 14px" }}>
        {fields.map((f) => (
          <div key={f.label} style={f.span === 2 ? { gridColumn: "1/-1" } : undefined}>
            <div style={{ fontSize: 12, color: "#5B6478" }}>{f.label}</div>
            <div style={{ fontWeight: 500 }}>{f.value || "-"}</div>
          </div>
        ))}
      </div>

      <div style={{ fontWeight: 600, fontSize: 13, margin: "16px 0 8px" }}>明细（{rows.length} 项）</div>
      <DataTable rowKey={(r) => String(r.key ?? JSON.stringify(r))} size="small" pagination={false} dataSource={rows} columns={columns} />

      {footer && <div style={{ marginTop: 14 }}>{footer}</div>}
    </Drawer>
  );
}

/** 状态 Tag 快捷生成。 */
export function statusTag(text: string, color: string) {
  return <Tag color={color}>{text}</Tag>;
}
