import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Alert, Button, Drawer, Input, InputNumber, Modal, Space, Spin, Tag, Upload } from "antd";
import { CameraOutlined, CheckCircleFilled, SearchOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { useNavigate } from "react-router";

import { baseApi, fileApi, fileUrl, ocrApi, purchaseApi, type CategoryNode, type HistoryPriceRow, type OcrTask, type OcrTaskListItem } from "@wlt/shared";

import { DataTable } from "../components/DataTable";

import { CategorySelect } from "../components/CategorySelect";

interface Row {
  key: number;
  product_name: string;
  material_code: string;
  spec: string;
  unit: string;
  category_id: number | undefined;
  category_name: string;
  qty: string;
  price: string;
  amount: string;
}

/** 送货单 OCR 录入：上传 → 模板/大模型结构化 → 人工确认（可手动补录漏识条目）→ 供应商落库 + 物料自动新增 → 带入入库。 */
export function DeliveryOcrPage() {
  const { message, modal } = App.useApp();
  const navigate = useNavigate();
  const [task, setTask] = useState<OcrTask | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [nextKey, setNextKey] = useState(0);
  const [uploadUrl, setUploadUrl] = useState(""); // 送货单图片（原始单据参考）
  // 识别方式：SiliconFlow 视觉识别（视觉大模型，等待 20-60 秒）
  const [preview, setPreview] = useState(""); // 点击图片放大查看（Modal）
  const [supplierName, setSupplierName] = useState("");
  const [billNo, setBillNo] = useState("");
  const [polling, setPolling] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  // 历史价格查询
  const [histOpen, setHistOpen] = useState(false);
  const [histTitle, setHistTitle] = useState("");
  const [histRows, setHistRows] = useState<HistoryPriceRow[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  // 查询任务单：页面刷新后从后端任务表找回识别任务继续处理（结果保留 1 小时）
  const [taskListOpen, setTaskListOpen] = useState(false);
  const [taskList, setTaskList] = useState<OcrTaskListItem[]>([]);
  const [taskListLoading, setTaskListLoading] = useState(false);
  const [resumingId, setResumingId] = useState<string | undefined>(undefined);
  // 系统分类树（供明细「分类」列选择/新增/编辑；识别出的分类名命中后自动回填）
  const [catTree, setCatTree] = useState<CategoryNode[]>([]);

  /** 分类树刷新（新增/编辑分类后由 CategorySelect 通知调用）。 */
  const reloadCats = useCallback(() => {
    baseApi.categories().then(setCatTree).catch(() => undefined);
  }, []);

  useEffect(() => {
    reloadCats();
  }, [reloadCats]);

  // 分类树拍平（名称 → id，用于识别结果回填）
  const catFlat = useMemo(() => {
    const out: { id: number; name: string }[] = [];
    const walk = (nodes: CategoryNode[]) => {
      for (const n of nodes) {
        out.push({ id: n.id, name: n.name });
        if (n.children?.length) walk(n.children);
      }
    };
    walk(catTree);
    return out;
  }, [catTree]);

  // 识别出的分类名命中系统分类 → 自动回填选中；「未分类」/系统不存在 → 清空待人工选择或新增
  useEffect(() => {
    if (!catFlat.length) return;
    setRows((rs) =>
      rs.map((r) => {
        if (r.category_id !== undefined || !r.category_name.trim()) return r;
        const name = r.category_name.trim();
        if (name === "未分类") return { ...r, category_name: "" };
        const hit = catFlat.find((c) => c.name === name);
        return hit ? { ...r, category_id: hit.id } : { ...r, category_name: "" };
      })
    );
  }, [catFlat]);

  async function handleUpload(file: File): Promise<boolean> {
    try {
      const up = await fileApi.upload(file, "purchase_bill");
      setUploadUrl(up.url);
      const t = await ocrApi.recognize(up.file_id, 1, "auto");
      setTask(null);
      setRows([]);
      setLines([]);
      setSupplierName("");
      setBillNo("");
      setPolling(true);
      poll(t.task_id);
      return false;
    } catch (e) {
      message.error(e instanceof Error ? e.message : "上传失败");
      return false;
    }
  }

  function poll(id: string) {
    if (timerRef.current) clearInterval(timerRef.current);
    const intervalMs = 5000; // 视觉识别等待 20-60 秒
    const maxTicks = 24;
    let ticks = 0;
    timerRef.current = setInterval(async () => {
      try {
        const t = await ocrApi.taskStatus(id);
        if (t.status === "done") {
          clearInterval(timerRef.current);
          setPolling(false);
          applyTaskResult(t);
        } else if (t.status === "failed") {
          clearInterval(timerRef.current);
          setPolling(false);
          message.error(t.error ? "识别失败，请重试（详情见系统日志）" : "识别失败");
        }
      } catch (e) {
        clearInterval(timerRef.current);
        setPolling(false);
        message.error(e instanceof Error ? e.message : "查询失败");
      } finally {
        ticks += 1;
        if (ticks >= maxTicks) {
          clearInterval(timerRef.current);
          setPolling(false);
          message.warning("视觉识别超时（>2 分钟），请重试");
        }
      }
    }, intervalMs);
  }

  function setRow(key: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  }

  /** 应用任务结果到页面（轮询完成与「查询任务单」恢复共用）。 */
  function applyTaskResult(t: OcrTask) {
    setTask(t);
    const s = t.structured;
    setSupplierName(s?.supplier_name ?? "");
    setBillNo(s?.bill_no ?? "");
    // OCR 原文（整理：过滤空白行）——无论是否结构化成功都展示
    setLines((s?.lines ?? []).filter((l) => l.trim()));
    if (s?.items?.length) {
      setRows(
        s.items.map((it, i) => ({
          key: i,
          product_name: it.product_name ?? "",
          material_code: it.material_code ?? "",
          spec: it.spec ?? "",
          unit: it.unit ?? "",
          category_id: undefined,
          category_name: it.category_name ?? "",
          qty: it.qty ?? "1",
          price: it.price ?? "0",
          amount: it.amount ?? "",
        }))
      );
    } else {
      // 无结构化条目：明细留空，由下方"添加明细"手动录入
      setRows([]);
    }
  }

  /** 打开「查询任务单」：列出当前用户的识别任务（识别中/已完成/失败）。 */
  async function openTaskList() {
    setTaskListOpen(true);
    setTaskListLoading(true);
    try {
      const r = await ocrApi.tasks();
      setTaskList(r.tasks);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "查询失败");
    } finally {
      setTaskListLoading(false);
    }
  }

  /** 从任务单恢复：识别中继续轮询，已完成直接展示结果；同时恢复原图参考。 */
  async function resumeTask(t: OcrTaskListItem) {
    setTaskListOpen(false);
    setResumingId(t.task_id);
    // 清空当前页面状态，避免旧结果残留
    setTask(null);
    setRows([]);
    setLines([]);
    setSupplierName("");
    setBillNo("");
    if (t.file_id) setUploadUrl(fileUrl(t.file_id));
    try {
      const st = await ocrApi.taskStatus(t.task_id);
      if (st.status === "running") {
        setPolling(true);
        poll(t.task_id);
      } else {
        applyTaskResult(st);
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : "恢复任务失败");
    } finally {
      setResumingId(undefined);
    }
  }

  /** 材料名称历史价格查询：按名称匹配系统材料 → 查历史价格（可按供应商过滤）。 */
  async function openHistory(r: Row) {
    try {
      const found = await baseApi.products(r.product_name.trim());
      const p = found.list.find((x) => x.name === r.product_name.trim()) ?? found.list[0];
      if (!p) return message.warning("系统未找到该材料，可先入库后再查历史价");
      setHistTitle(`${p.name} 历史采购价`);
      setHistOpen(true);
      setHistLoading(true);
      setHistRows([]);
      try {
        const data = await purchaseApi.historyPrice({ productId: p.id });
        setHistRows(data.list);
      } finally {
        setHistLoading(false);
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : "查询失败");
    }
  }

  async function confirmAndGo() {
    if (!rows.length) return message.warning("识别结果为空，请确认图片清晰度或手动添加明细");
    const valid = rows.filter((r) => r.product_name.trim());
    if (!valid.length) return message.warning("请至少填写一行材料名称");
    // 供应商为空：明确提示（继续后入库单不关联供应商；也可返回填写）
    if (!supplierName.trim()) {
      const go = await new Promise<boolean>((resolve) => {
        modal.confirm({
          title: "未识别到供应商",
          content: "送货单未识别到供应商名称。继续后入库单将不关联供应商；可取消并返回上方填写供应商名称。",
          okText: "继续（不关联供应商）",
          cancelText: "返回填写",
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (!go) return;
    }
    setConfirming(true);
    try {
      // 供应商落库 + 物料自动匹配/新增 + 记录回写；返回 items（含 product_id）带入入库单
      const validRows = rows.filter((r) => r.product_name.trim()); // 跳过手动添加但未填名称的空行
      const data = await ocrApi.deliveryConfirm({
        record_id: task?.record_id ?? 0,
        supplier_name: supplierName.trim(),
        bill_no: billNo.trim(),
        items: validRows.map((r) => ({
          product_name: r.product_name.trim(),
          material_code: r.material_code.trim(),
          spec: r.spec.trim(),
          unit: r.unit.trim(),
          category_name: r.category_name.trim(),
          qty: r.qty,
          price: r.price,
          amount: r.amount,
        })),
      });
      // 预填数据带分类（行内所选 category_id/category_name），保证「新建入库」明细直接回显
      const items = data.items.map((it, i) => ({
        product_id: it.product_id,
        product_name: it.product_name,
        material_code: it.material_code ?? "",
        spec: it.spec ?? "",
        unit: it.unit ?? "",
        category_id: validRows[i]?.category_id,
        category_name: validRows[i]?.category_name ?? "",
        qty: it.qty ?? "1",
        price: it.price ?? "0",
      }));
      // 用 sessionStorage 传递预填数据（避免 URL 过长/刷新重复导入）；入库页消费后即删，保证只导入一次
      sessionStorage.setItem(
        "purchaseInPrefill",
        JSON.stringify({
          items,
          supplierId: data.supplier_id,
          supplierName: data.supplier_name,
          ocrRecordId: data.record_id,
          billNo: data.bill_no,
        })
      );
      const created = data.created_products?.length ?? 0;
      navigate("/purchase-in");
      message.success(
        `已确认供应商并带入入库${data.supplier_created ? `（已自动创建新供应商：${data.supplier_name}）` : ""}${data.supplier_matched_name ? `（已关联已有供应商：${data.supplier_matched_name}）` : ""}${created ? `（自动新增 ${created} 个系统中不存在的物料）` : ""}`
      );
    } catch (e) {
      message.error(e instanceof Error ? e.message : "确认失败");
    } finally {
      setConfirming(false);
    }
  }

  /** 手动补录 OCR 未捕获的条目（漏识行）。 */
  function addRow() {
    setRows((rs) => [...rs, { key: nextKey, product_name: "", material_code: "", spec: "", unit: "", category_id: undefined, category_name: "", qty: "1", price: "0", amount: "" }]);
    setNextKey((k) => k + 1);
  }

  const columns: ColumnsType<Row> = [
    { title: "#", width: 36, align: "center" as const, render: (_, __, i) => i + 1 },
    { title: "物料编码", dataIndex: "material_code", width: 140, render: (v: string, r) => <Input value={v} onChange={(e) => setRow(r.key, { material_code: e.target.value })} /> },
    { title: "材料名称", dataIndex: "product_name", render: (v: string, r) => <Input value={v} onChange={(e) => setRow(r.key, { product_name: e.target.value })} /> },
    { title: "规格型号", dataIndex: "spec", width: 140, render: (v: string, r) => <Input value={v} onChange={(e) => setRow(r.key, { spec: e.target.value })} /> },
    { title: "单位", dataIndex: "unit", width: 70, render: (v: string, r) => <Input value={v} onChange={(e) => setRow(r.key, { unit: e.target.value })} /> },
    {
      title: "分类",
      dataIndex: "category_name",
      width: 170,
      render: (_, r) => (
        <CategorySelect
          style={{ width: "100%" }}
          value={r.category_id}
          tree={catTree}
          onReload={reloadCats}
          placeholder="选择分类 / 新增"
          onChange={(id, name) => setRow(r.key, { category_id: id, category_name: name })}
        />
      ),
    },
    {
      title: "数量",
      dataIndex: "qty",
      width: 100,
      render: (v: string, r) => (
        <InputNumber min={0} style={{ width: "100%" }} value={Number(v) || 0} onChange={(x) => setRow(r.key, { qty: String(x ?? 0) })} />
      ),
    },
    {
      title: "单价",
      dataIndex: "price",
      width: 110,
      render: (v: string, r) => (
        <InputNumber min={0} precision={2} style={{ width: "100%" }} value={Number(v) || 0} onChange={(x) => setRow(r.key, { price: String(x ?? 0) })} />
      ),
    },
    {
      title: "金额",
      width: 100,
      align: "right" as const,
      render: (_, r) => {
        const amount = (Number(r.price) || 0) * (Number(r.qty) || 0);
        return <span style={{ fontWeight: 600 }}>{amount.toFixed(2)}</span>;
      },
    },
    {
      title: "历史价",
      width: 70,
      render: (_, r) => <Button size="small" type="link" style={{ padding: 0 }} onClick={() => void openHistory(r)}>查询</Button>,
    },
    {
      title: "操作",
      width: 50,
      render: (_, r) => <Button size="small" danger type="text" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>删</Button>,
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ margin: "0 0 16px" }}>送货单识别入库</h2>

      <Space style={{ marginBottom: 8 }} align="center" wrap>
        <Upload beforeUpload={handleUpload} showUploadList={false} accept="image/*">
          <Button type="primary" loading={polling} icon={<CameraOutlined />}>上传送货单照片</Button>
        </Upload>
        <Button icon={<SearchOutlined />} onClick={() => void openTaskList()}>查询任务单</Button>
        <Tag color="blue">识别方式：SiliconFlow 视觉识别（视觉大模型）</Tag>
      </Space>
      <Alert
        type="info"
        showIcon
        style={{ maxWidth: 760, marginBottom: 8 }}
        title={
          "视觉识别（SiliconFlow）：调用视觉大模型分析送货单，通常需等待 20-60 秒，请耐心等待；识别后逐项确认再带入入库。"
        }
      />

      {polling && (
        <div style={{ marginTop: 24, textAlign: "center" }}>
          <Spin
            description={
              "正在识别送货单（视觉大模型分析，约需等待 20-60 秒，请耐心等待）…"
            }
          />
        </div>
      )}

      {task?.status === "failed" && (
        <Alert
          style={{ marginTop: 16, maxWidth: 640 }}
          type="error"
          showIcon
          title="识别失败"
          description={task.error ?? "未知错误，请检查图片清晰度后重新上传"}
        />
      )}

      {/* 原始单据参考：图片（带可用标记，点击放大）+ OCR 原文（整理） */}
      {(uploadUrl || lines.length > 0) && (
        <div style={{ margin: "16px 0 12px", maxWidth: 780, border: "1px solid #e5e6eb", borderRadius: 8, padding: 12, background: "#fff" }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>原始单据参考</div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <div>
              {uploadUrl ? (
                <>
                  <Tag color="green" icon={<CheckCircleFilled />}>图片</Tag>
                  <img
                    src={uploadUrl}
                    alt="送货单"
                    onClick={() => setPreview(uploadUrl)}
                    style={{ maxWidth: 320, maxHeight: 220, borderRadius: 8, border: "1px solid #e5e6eb", cursor: "zoom-in", display: "block", marginTop: 6 }}
                  />
                  <div style={{ fontSize: 11, color: "#646a73", marginTop: 4 }}>点击图片放大查看</div>
                </>
              ) : (
                <Tag>图片 —</Tag>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 260 }}>
              <div style={{ fontSize: 12, color: "#646a73", marginBottom: 6 }}>OCR 原文（{lines.length} 行）</div>
              {lines.length ? (
                <pre style={{ background: "#f6f8fa", padding: 12, borderRadius: 8, whiteSpace: "pre-wrap", fontSize: 12, lineHeight: 1.8, margin: 0 }}>
                  {lines.map((l, i) => `${String(i + 1).padStart(2, "0")}  ${l}`).join("\n")}
                </pre>
              ) : (
                <div style={{ color: "#c0c4cc", fontSize: 12, background: "#fafbfc", padding: "12px 16px", borderRadius: 8 }}>暂无 OCR 原文（0 行）</div>
              )}
            </div>
          </div>
        </div>
      )}

      {task?.status === "done" && (
        <div style={{ marginTop: 8 }}>
          {rows.length > 0 ? (
            <>
              <Space style={{ marginBottom: 8 }}>
                <Tag color="blue">视觉识别（SiliconFlow + DeepSeek 分类）</Tag>
                <Tag color="green">识别到 {rows.length} 项材料</Tag>
                <span style={{ fontSize: 12, color: "#646a73" }}>漏识条目可点击下方「+ 添加明细」手动补录；确认时系统不存在物料将自动新增</span>
              </Space>
              <Space style={{ marginBottom: 8 }} wrap>
                <span>供应商：</span>
                <Input style={{ width: 260 }} placeholder="从识别结果提取，可修改" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} />
                <span style={{ fontSize: 11, color: "#646a73" }}>输入系统中不存在的供应商名时，确认后将自动创建新供应商</span>
                <span>送货单号：</span>
                <Input style={{ width: 220 }} placeholder="可空" value={billNo} onChange={(e) => setBillNo(e.target.value)} />
              </Space>
              <DataTable
                rowKey="key"
                columns={columns}
                dataSource={rows}
                pagination={false}
                size="small"
                style={{ marginTop: 4 }}
                footer={() => (
                  <Space style={{ width: "100%", justifyContent: "space-between" }}>
                    <Button size="small" onClick={addRow}>+ 添加明细（手动补录漏识条目）</Button>
                    <span style={{ color: "#646a73", fontSize: 12 }}>
                      共 {rows.length} 项 ｜ 总金额：
                      <b style={{ color: "#1f2329" }}>
                        {rows.reduce((s, r) => s + (Number(r.price) || 0) * (Number(r.qty) || 0), 0).toFixed(2)}
                      </b>
                    </span>
                  </Space>
                )}
               rowSelection onBatchDelete={async (keys) => { setRows((rs) => rs.filter((r) => !keys.includes(r.key))); }} />
            </>
          ) : (
            <>
              <Tag color="orange">未识别出结构化材料（模板未命中且大模型不可用），可点击下方「添加明细」手动录入，或对照上方原始单据参考：</Tag>
              <div style={{ marginTop: 8 }}>
                <Button size="small" onClick={addRow}>+ 添加明细（手动录入）</Button>
              </div>
            </>
          )}
          <div style={{ marginTop: 16 }}>
            <Button type="primary" loading={confirming} onClick={() => void confirmAndGo()} disabled={!rows.length}>
              确认供应商并带入入库
            </Button>
            {!rows.length && (
              <Button style={{ marginLeft: 12 }} onClick={() => navigate("/purchase-in")}>手动录入</Button>
            )}
          </div>
        </div>
      )}

      <Drawer title={histTitle} open={histOpen} onClose={() => setHistOpen(false)} size={560}>
        <DataTable
          rowKey="bill_no"
          size="small"
          loading={histLoading}
          locale={{ emptyText: "暂无历史采购记录" }}
          pagination={false}
          columns={[
            { title: "入库单号", dataIndex: "bill_no" },
            { title: "日期", dataIndex: "bill_date", render: (v: string) => v?.slice(0, 10) },
            { title: "单价", dataIndex: "price" },
            { title: "数量", dataIndex: "qty" },
            { title: "金额", dataIndex: "amount" },
            { title: "供应商", dataIndex: "supplier_name" },
          ]}
          dataSource={histRows}
        />
      </Drawer>

      {/* 查询任务单：页面刷新后找回识别任务继续处理（结果保留 1 小时） */}
      <Modal title="查询任务单（识别结果保留 1 小时）" open={taskListOpen} onCancel={() => setTaskListOpen(false)} footer={null} width={620} destroyOnHidden>
        <DataTable
          rowKey="task_id"
          size="small"
          loading={taskListLoading}
          locale={{ emptyText: "暂无识别任务（识别结果保留 1 小时，超时或被后端重启清理后不可恢复）" }}
          pagination={false}
          columns={[
            {
              title: "状态",
              dataIndex: "status",
              width: 90,
              render: (s: string) =>
                s === "done" ? <Tag color="green">已完成</Tag> : s === "running" ? <Tag color="processing">识别中</Tag> : <Tag color="error">失败</Tag>,
            },
            { title: "创建时间", dataIndex: "created_ts", width: 170, render: (v: number) => (v ? new Date(v * 1000).toLocaleString() : "-") },
            {
              title: "原图",
              dataIndex: "file_id",
              width: 70,
              render: (v: number) => (v ? <img src={fileUrl(v)} alt="" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 4 }} /> : "-"),
            },
            {
              title: "操作",
              width: 120,
              render: (_, r) =>
                r.status === "failed" ? (
                  <span style={{ color: "#c9cdd4", fontSize: 12 }}>已失败</span>
                ) : (
                  <Button size="small" type="primary" ghost loading={resumingId === r.task_id} onClick={() => void resumeTask(r)}>
                    {r.status === "done" ? "查看结果" : "继续等待"}
                  </Button>
                ),
            },
          ]}
          dataSource={taskList}
        />
      </Modal>

      {/* 送货单图片放大查看 */}
      <Modal open={Boolean(preview)} footer={null} onCancel={() => setPreview("")} width={860} title="送货单原图">
        {preview && <img src={preview} alt="送货单" style={{ width: "100%" }} />}
      </Modal>
    </div>
  );
}
