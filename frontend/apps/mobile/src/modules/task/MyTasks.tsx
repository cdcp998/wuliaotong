/** 手机端：我的任务（v2 无锁协作制）——维修人员在任务池领取/接力处理任务：
 *  待领取→「领取并处理」；进行中→填记录/传照片（可选）后「完成任务」；完成后进入后台审核。 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Button, Card, List, NavBar, Tag, TextArea, Toast } from "antd-mobile";

import { ModuleGate } from "../../components/ModuleGate";
import { TASK_STATUS, taskApi, type TaskItem } from "../api";

export function MyTasksPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [current, setCurrent] = useState<TaskItem | null>(null);
  const [content, setContent] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [recommend, setRecommend] = useState<{ id: number; title: string; snippet: string }[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // 后端按数据范围返回：未领取的池内任务 + 本人参与/主责的任务（已关闭自动归档不出现）
      const r = await taskApi.list({ page_size: 100 });
      setRows(r.items.filter((t) => t.status !== "closed" && t.status !== "cancelled"));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (t: TaskItem, action: string) => {
    try {
      await taskApi.status(t.id, { action });
      Toast.show(action === "claim" ? "已领取，请开始处理" : "已更新");
      setCurrent(null);
      void load();
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "操作失败");
    }
  };

  const complete = async () => {
    if (!current) return;
    setBusy(true);
    try {
      let fileId = 0;
      if (photo) {
        const { fileApi } = await import("@wlt/shared");
        const up = await fileApi.upload(photo, "task");
        fileId = up.file_id;
      }
      // 记录与照片均为可选：有内容才落记录
      if (content.trim() || fileId) {
        await taskApi.addRecord(current.id, { content, files: fileId ? [{ file_id: fileId }] : [] });
      }
      await taskApi.status(current.id, { action: "complete" });
      Toast.show("已完成，等待后台审核");
      setCurrent(null);
      setContent("");
      setPhoto(null);
      void load();
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "完成失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModuleGate code="task" title="我的任务">
    <div>
      <NavBar onBack={() => navigate(-1)}>我的任务</NavBar>
      <List style={{ minHeight: "60dvh" }}>
        {rows.map((t) => (
          <List.Item key={t.id} description={`${t.task_no}　${t.priority === 2 ? "紧急　" : ""}${t.description || ""}`}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>{t.title}</span>
              <Tag color={t.status === "done" ? "warning" : t.status === "cancelled" ? "danger" : "primary"}>{TASK_STATUS[t.status]}</Tag>
            </div>
            <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
              {t.status === "pending" && <Button size="mini" color="primary" onClick={() => act(t, "claim")}>领取并处理</Button>}
              {t.status === "in_progress" && <Button size="mini" color="primary" onClick={() => { setCurrent(t); setContent(""); setPhoto(null); setRecommend([]); }}>处理完毕</Button>}
            </div>
          </List.Item>
        ))}
        {!loading && rows.length === 0 && <List.Item>任务池暂无可处理的任务</List.Item>}
      </List>

      {current && (
        <Card className="wlt-mobile-sheet" style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 1000, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "70dvh", overflow: "auto" }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>{current.title}</div>
          <TextArea placeholder="维修内容（可选）" value={content} onChange={setContent} rows={3} />
          <input type="file" accept="image/*" id="task-photo" style={{ display: "none" }} onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
          <label htmlFor="task-photo" style={{ display: "inline-block", margin: "8px 0", color: "#475FE8" }}>{photo ? "已选照片（点击更换）" : "+ 上传图片（可选）"}</label>
          <div style={{ display: "flex", gap: 8 }}>
            <Button block color="primary" loading={busy} onClick={complete}>完成任务</Button>
            <Button block fill="outline" onClick={() => {
              taskApi.recommend(current.id).then((r) => setRecommend(r.items ?? [])).catch(() => undefined);
            }}>知识推荐</Button>
            <Button block fill="outline" onClick={() => setCurrent(null)}>关闭</Button>
          </div>
          {recommend.map((a) => (
            <div key={a.id} style={{ marginTop: 8, padding: 8, background: "#F2F5FB", borderRadius: 8 }}>
              <div style={{ fontWeight: 600 }}>{a.title}</div>
              <div style={{ fontSize: 12, color: "#666" }}>{a.snippet}</div>
            </div>
          ))}
        </Card>
      )}
    </div>
    </ModuleGate>
  );
}
