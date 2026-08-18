import { useEffect, useMemo, useState } from "react";
import { App, Button, InputNumber, Select, Space, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useNavigate, useParams } from "react-router";

import { baseApi, checkApi, FileImage, type CheckItem } from "@wlt/shared";

import { DataTable } from "../components/DataTable";

/** 盘点执行（电脑端）：录入实盘 → 提交 → 审核。 */
export function CheckDetailPage() {
  const { message } = App.useApp();
  const { id } = useParams();
  const navigate = useNavigate();
  const [items, setItems] = useState<CheckItem[]>([]);
  const [billNo, setBillNo] = useState("");
  const [warehouseName, setWarehouseName] = useState("");
  const [status, setStatus] = useState(0);
  const [drafts, setDrafts] = useState<Record<number, number>>({});
  const [saving, setSaving] = useState(false);
  const [auditing, setAuditing] = useState(false);
  // 当场新增账外物料（账面 0，审核时按盘盈入账）
  const [extraRows, setExtraRows] = useState<{ key: number; product_id?: number; product_name?: string; real?: number }[]>([]);
  const [products, setProducts] = useState<{ id: number; name: string; spec?: string }[]>([]);
  const [newProductId, setNewProductId] = useState<number | undefined>();
  const [newReal, setNewReal] = useState<number | undefined>();

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

  useEffect(() => {
    baseApi.products("", 1).then((p) => setProducts(p.list)).catch(() => undefined);
  }, []);

  function addExtra() {
    if (!newProductId) return message.warning("请选择物料");
    if (!newReal || newReal <= 0) return message.warning("请填写实盘数量");
    if (items.some((it) => it.product_id === newProductId) || extraRows.some((r) => r.product_id === newProductId)) {
      return message.warning("该物料已在盘点单中");
    }
    const p = products.find((x) => x.id === newProductId);
    setExtraRows((rs) => [...rs, { key: Date.now() + rs.length, product_id: newProductId, product_name: p?.name, real: newReal }]);
    setNewProductId(undefined);
    setNewReal(undefined);
  }

  async function save() {
    setSaving(true);
    try {
      await checkApi.saveItems(
        Number(id),
        [
          ...items.map((it) => ({ check_item_id: it.id, real_qty: String(drafts[it.id] ?? 0) })),
          ...extraRows.map((r) => ({ check_item_id: 0, product_id: r.product_id!, real_qty: String(r.real ?? 0) })),
        ]
      );
      message.success("盘点结果已保存（含当场新增物料）");
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
    { title: "材料", dataIndex: "product_name" },
    { title: "物料编码", dataIndex: "code", render: (_, r) => r.material_code || "-" },
    { title: "规格", dataIndex: "spec" },
    { title: "单位", dataIndex: "unit_name" },
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
    { title: "差异", render: (_, r) => <span style={{ color: Number(diffText[r.id]) > 0 ? "#f5222d" : Number(diffText[r.id]) < 0 ? "#52c41a" : "#646a73" }}>{diffText[r.id]}</span> },
    { title: "照片", render: (_, r) => (r.photo_file_id ? <FileImage fileId={r.photo_file_id} size={48} /> : "-") },
  ];

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>
          {billNo} · {warehouseName}
          <span style={{ fontSize: 13, color: "#646a73", marginLeft: 12 }}>
            {["待盘点", "盘点中", "已审核"][status]}（{items.length} 项）
          </span>
        </h2>
        <Space2 status={status} saving={saving} auditing={auditing} onExport={() => window.open(checkApi.exportUrl(Number(id)), "_self")} onSave={() => void save()} onAudit={() => void audit()} onBack={() => navigate("/checks")} />
      </div>
      <DataTable rowKey="id" locale={{ emptyText: "暂无数据" }} columns={columns} dataSource={items} pagination={false}  rowSelection onBatchDelete={async () => { message.info("该列表为只读数据，不支持删除"); }} />

      {!readonly && (
        <div style={{ background: "#fafbfc", border: "1px dashed #d9dde3", borderRadius: 8, padding: 12, marginTop: 12 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>当场新增账外物料（盘点发现但账面没有的实物，实盘数量即盘盈入账）</div>
          <Space wrap>
            <Select
              style={{ width: 260 }}
              showSearch
              placeholder="搜索物料"
              options={products.map((p) => ({ label: `${p.name}${p.spec ? `（${p.spec}）` : ""}`, value: p.id, name: p.name }))}
              filterOption={(input, o) => String((o as { name?: string; label?: string }).name ?? "").includes(input) || String((o as { label?: string }).label ?? "").includes(input)}
              value={newProductId}
              onChange={setNewProductId}
            />
            <InputNumber min={0.001} placeholder="实盘数量" value={newReal} onChange={(v) => setNewReal(v ?? undefined)} style={{ width: 140 }} />
            <Button onClick={addExtra}>添加</Button>
          </Space>
          {extraRows.map((r) => (
            <Tag key={r.key} color="red" closable onClose={() => setExtraRows((rs) => rs.filter((x) => x.key !== r.key))} style={{ marginTop: 8 }}>
              {r.product_name}（账面 0，实盘 {r.real}）
            </Tag>
          ))}
        </div>
      )}
    </div>
  );
}

function Space2({ status, saving, auditing, onExport, onSave, onAudit, onBack }: { status: number; saving: boolean; auditing: boolean; onExport: () => void; onSave: () => void; onAudit: () => void; onBack: () => void }) {
  return (
    <Space>
      <Button onClick={onBack}>返回</Button>
      <Button onClick={onExport}>导出 Excel</Button>
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
