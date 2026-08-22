/** 手机端：我的任务（方案 §7.3）——被指派任务处理（接单/完成+记录照片/知识推荐）。 */
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
      const r = await taskApi.list({ page_size: 100 });
      // 已关闭/已取消的任务不再显示（用户要求）
      setRows(r.items.filter((t) => t.status !== "closed" && t.status !== "cancelled"));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (t: TaskItem, action: string) => {
    try {
      await taskApi.status(t.id, { action });
      Toast.show("已更新");
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
      await taskApi.addRecord(current.id, { content, files: fileId ? [{ file_id: fileId }] : [] });
      await taskApi.status(current.id, { action: "complete" });
      Toast.show("任务完成");
      setCurrent(null);
      setContent("");
      setPhoto(null);
      void load();
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "完成失败（需填写记录并上传照片）");
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
              <Tag color={t.status === "completed" ? "success" : t.status === "cancelled" ? "danger" : "primary"}>{TASK_STATUS[t.status]}</Tag>
            </div>
            <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
              {t.status === "assigned" && <Button size="mini" color="primary" onClick={() => act(t, "accept")}>接单</Button>}
              {t.status === "in_progress" && <Button size="mini" color="primary" onClick={() => { setCurrent(t); setContent(""); setPhoto(null); setRecommend([]); }}>填写记录并完成</Button>}
              {t.status === "assigned" && <Button size="mini" fill="outline" onClick={() => setCurrent(t)}>补记录</Button>}
            </div>
          </List.Item>
        ))}
        {!loading && rows.length === 0 && <List.Item>暂未被指派任务</List.Item>}
      </List>

      {current && (
        <Card className="wlt-mobile-sheet" style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 1000, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "70dvh", overflow: "auto" }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>{current.title}</div>
          <TextArea placeholder="维修内容（完成必填）" value={content} onChange={setContent} rows={3} />
          <input type="file" accept="image/*" id="task-photo" style={{ display: "none" }} onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
          <label htmlFor="task-photo" style={{ display: "inline-block", margin: "8px 0", color: "#5B7FFF" }}>{photo ? "已选照片（点击更换）" : "+ 维修照片（完成必填）"}</label>
          <div style={{ display: "flex", gap: 8 }}>
            {current.status === "in_progress" && <Button block color="primary" loading={busy} onClick={complete}>完成任务</Button>}
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
