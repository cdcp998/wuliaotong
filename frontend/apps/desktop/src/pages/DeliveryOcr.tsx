import { useRef, useState } from "react";
import { Button, Input, message, Space, Spin, Table, Tag, Upload } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useNavigate } from "react-router-dom";

import { fileApi, ocrApi, type OcrTask } from "@wlt/shared";

interface Row {
  key: number;
  product_name: string;
  qty: string;
  price: string;
  amount: string;
}

/** 送货单 OCR 录入：上传图片 → 异步识别 → 人工确认 → 带入采购入库。 */
export function DeliveryOcrPage() {
  const navigate = useNavigate();
  const [taskId, setTaskId] = useState<string>();
  const [task, setTask] = useState<OcrTask | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [polling, setPolling] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  async function handleUpload(file: File): Promise<boolean> {
    try {
      const up = await fileApi.upload(file, "purchase_bill");
      const t = await ocrApi.recognize(up.file_id, 1);
      setTaskId(t.task_id);
      setTask(null);
      setRows([]);
      setLines([]);
      setPolling(true);
      poll(t.task_id);
      return false; // 阻止 Upload 默认上传
    } catch (e) {
      message.error(e instanceof Error ? e.message : "上传失败");
      return false;
    }
  }

  function poll(id: string) {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(async () => {
      try {
        const t = await ocrApi.taskStatus(id);
        if (t.status === "done") {
          clearInterval(timerRef.current);
          setTask(t);
          setPolling(false);
          const structured = t.structured;
          if (structured?.items?.length) {
            setRows(
              structured.items.map((it, i) => ({
                key: i,
                product_name: it.product_name ?? "",
                qty: it.qty ?? "1",
                price: it.price ?? "0",
                amount: it.amount ?? "",
              }))
            );
          } else {
            setLines(structured?.lines ?? []);
          }
        } else if (t.status === "failed") {
          clearInterval(timerRef.current);
          setPolling(false);
          message.error(t.error ?? "识别失败");
        }
      } catch (e) {
        clearInterval(timerRef.current);
        setPolling(false);
        message.error(e instanceof Error ? e.message : "查询失败");
      }
    }, 1500);
  }

  function confirmAndGo() {
    if (!rows.length) return message.warning("识别结果为空，请确认图片清晰度");
    for (const r of rows) {
      if (!r.product_name.trim()) return message.warning("存在空商品名，请修正");
    }
    const items = rows.map((r) => ({ product_name: r.product_name.trim(), qty: r.qty, price: r.price }));
    navigate(`/purchase-in?items=${encodeURIComponent(JSON.stringify(items))}`);
  }

  const columns: ColumnsType<Row> = [
    { title: "商品名称", dataIndex: "product_name", render: (v: string, r) => <Input value={v} onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, product_name: e.target.value } : x)))} /> },
    { title: "数量", dataIndex: "qty", width: 100, render: (v: string, r) => <Input value={v} onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, qty: e.target.value } : x)))} /> },
    { title: "单价", dataIndex: "price", width: 100, render: (v: string, r) => <Input value={v} onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, price: e.target.value } : x)))} /> },
    { title: "金额", dataIndex: "amount", width: 100 },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Space style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>送货单 OCR 录入</h2>
        <Button onClick={() => navigate("/purchase-in")}>返回入库</Button>
      </Space>

      <Upload beforeUpload={handleUpload} showUploadList={false} accept="image/*">
        <Button type="primary" loading={polling} icon={<span>📷</span>}>上传送货单照片</Button>
      </Upload>
      <span style={{ color: "#999", marginLeft: 12, fontSize: 12 }}>
        支持手机拍照/电脑上传；识别完成后逐项确认，再带入采购入库
      </span>

      {polling && (
        <div style={{ marginTop: 24 }}>
          <Spin tip="识别中（首次约 3-10 秒）…" />
          <p style={{ color: "#999", fontSize: 12 }}>任务：{taskId}</p>
        </div>
      )}

      {task?.status === "done" && (
        <div style={{ marginTop: 24 }}>
          {rows.length > 0 ? (
            <>
              <Tag color="green">识别到 {rows.length} 项商品（DeepSeek 结构化）</Tag>
              <Table rowKey="key" columns={columns} dataSource={rows} pagination={false} size="small" style={{ marginTop: 12, maxWidth: 720 }} />
            </>
          ) : (
            <>
              <Tag color="orange">未识别出结构化商品（大模型未配置或识别失败），原始文本行如下：</Tag>
              <pre style={{ background: "#f6f8fa", padding: 12, borderRadius: 8, marginTop: 12, whiteSpace: "pre-wrap", maxWidth: 720 }}>
                {lines.join("\n")}
              </pre>
              <p style={{ color: "#999", fontSize: 12 }}>提示：可在「系统设置」配置 DeepSeek API Key 后自动结构化；当前可手动添加明细。</p>
            </>
          )}
          <div style={{ marginTop: 16 }}>
            <Button type="primary" onClick={confirmAndGo} disabled={!rows.length}>
              确认并带入采购入库
            </Button>
            {!rows.length && (
              <Button style={{ marginLeft: 12 }} onClick={() => navigate("/purchase-in")}>
                手动录入
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
