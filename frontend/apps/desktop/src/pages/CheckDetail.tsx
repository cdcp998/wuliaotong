import { useEffect, useMemo, useState } from "react";
import { Button, InputNumber, message, Space, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useNavigate, useParams } from "react-router-dom";

import { checkApi, type CheckItem } from "@wlt/shared";

/** 盘点执行（电脑端）：录入实盘 → 提交 → 审核。 */
export function CheckDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [items, setItems] = useState<CheckItem[]>([]);
  const [billNo, setBillNo] = useState("");
  const [warehouseName, setWarehouseName] = useState("");
  const [status, setStatus] = useState(0);
  const [drafts, setDrafts] = useState<Record<number, number>>({});
  const [saving, setSaving] = useState(false);
  const [auditing, setAuditing] = useState(false);

  useEffect(() => {
    if (!id) return;
    checkApi
      .detail(Number(id))
      .then((b) => {
        setItems(b.items);
        setBillNo(b.bill_no);
        setWarehouseName(b.warehouse_name);
        setStatus(b.status);
        const init: Record<number, number> = {};
        for (const it of b.items) init[it.id] = Number(it.real_qty ?? it.book_qty);
        setDrafts(init);
      })
      .catch((e) => message.error(e instanceof Error ? e.message : "加载失败"));
  }, [id]);

  const readonly = status === 2;
  const diffText = useMemo(() => {
    const m: Record<number, string> = {};
    for (const it of items) {
      const real = drafts[it.id];
      const diff = real === undefined ? 0 : real - Number(it.book_qty);
      m[it.id] = diff === 0 ? "0" : (diff > 0 ? "+" : "") + diff;
    }
    return m;
  }, [items, drafts]);

  async function save() {
    setSaving(true);
    try {
      await checkApi.saveItems(
        Number(id),
        items.map((it) => ({ check_item_id: it.id, real_qty: String(drafts[it.id] ?? 0) }))
      );
      message.success("盘点结果已保存");
      window.location.reload();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function audit() {
    setAuditing(true);
    try {
      await checkApi.audit(Number(id));
      message.success("已审核，盘盈/盘亏已入账");
      window.location.reload();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "审核失败");
    } finally {
      setAuditing(false);
    }
  }

  const columns: ColumnsType<CheckItem> = [
    { title: "商品", dataIndex: "product_name" },
    { title: "编码", dataIndex: "code" },
    { title: "库位", dataIndex: "location_code" },
    { title: "账面", dataIndex: "book_qty" },
    {
      title: "实盘",
      render: (_, r) => (
        <InputNumber
          disabled={readonly}
          value={drafts[r.id]}
          onChange={(v) => setDrafts((d) => ({ ...d, [r.id]: v ?? 0 }))}
          min={0}
          style={{ width: 120 }}
        />
      ),
    },
    { title: "差异", render: (_, r) => <span style={{ color: Number(diffText[r.id]) > 0 ? "#f5222d" : Number(diffText[r.id]) < 0 ? "#52c41a" : "#999" }}>{diffText[r.id]}</span> },
    { title: "照片", render: (_, r) => (r.photo_file_id ? <a href={`/api/v1/files/${r.photo_file_id}`} target="_blank" rel="noreferrer">查看</a> : "-") },
  ];

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>
          {billNo} · {warehouseName}
          <span style={{ fontSize: 13, color: "#999", marginLeft: 12 }}>
            {["待盘点", "盘点中", "已审核"][status]}（{items.length} 项）
          </span>
        </h2>
        <Space2 status={status} saving={saving} auditing={auditing} onSave={() => void save()} onAudit={() => void audit()} onBack={() => navigate("/checks")} />
      </div>
      <Table rowKey="id" columns={columns} dataSource={items} pagination={false} />
    </div>
  );
}

function Space2({ status, saving, auditing, onSave, onAudit, onBack }: { status: number; saving: boolean; auditing: boolean; onSave: () => void; onAudit: () => void; onBack: () => void }) {
  return (
    <Space>
      <Button onClick={onBack}>返回</Button>
      {status !== 2 && (
        <Button type="primary" loading={saving} onClick={onSave}>
          保存盘点结果
        </Button>
      )}
      {status === 1 && (
        <Button type="primary" danger loading={auditing} onClick={onAudit}>
          审核入账
        </Button>
      )}
    </Space>
  );
}
