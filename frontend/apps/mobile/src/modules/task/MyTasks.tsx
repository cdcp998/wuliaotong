/** 手机端：我的任务（v2 无锁协作制）——OP 规格（设计页 M3）重构：
 * 任务卡 r16 白卡（标题 13/600 + 状态胶囊 + 单号行 10.5 弱色 + 描述行 11.5 次色 +
 * 操作钮：待领取=浅底深蓝字「领取并处理」，进行中=品牌实心「填写记录并完成」）；
 * 完成弹层 Sheet r20（记录输入块 #F6F8FE + 照片格 44×44（选图自动附 GPS 定位写入记录留痕）
 * + 知识推荐行 + 「完成任务」主钮）。 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Button, NavBar, TextArea, Toast } from "antd-mobile";

import { getCurrentPositionWithFallback } from "@wlt/shared";

import { ModuleGate } from "../../components/ModuleGate";
import { TASK_STATUS, taskApi, type TaskItem } from "../api";

/** 状态胶囊配色（OP：维修中=蓝 / 待验收=紫 / 已完成=绿；领取前琥珀、取消灰）。 */
function statusPill(status: string): { label: string; cls: string } {
  switch (status) {
    case "in_progress":
      return { label: "维修中", cls: "wlt-pill--blue" };
    case "done":
      return { label: "待验收", cls: "wlt-pill--purple" };
    case "verified":
      return { label: "已完成", cls: "wlt-pill--green" };
    case "pending":
      return { label: "待领取", cls: "wlt-pill--amber" };
    default:
      return { label: TASK_STATUS[status] ?? status, cls: "wlt-pill--gray" };
  }
}

export function MyTasksPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [current, setCurrent] = useState<TaskItem | null>(null);
  const [content, setContent] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [gpsPos, setGpsPos] = useState<{ lat: number; lng: number } | null>(null); // 选图时抓取的定位（留痕写入记录）
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

  /** 选图后尝试定位（降级链），成功则随记录写入 GPS 留痕（§5.10 拍照/GPS 带水印留痕）。 */
  const pickPhoto = async (f: File | null) => {
    setPhoto(f);
    setGpsPos(null);
    if (!f) return;
    try {
      const p = await getCurrentPositionWithFallback();
      setGpsPos({ lat: p.lat, lng: p.lng });
    } catch {
      /* 定位不可用不阻塞上传，仅无 GPS 行 */
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
      // 记录与照片均为可选：有内容才落记录（v2 无锁协作制约定）
      const fullContent = gpsPos ? `${content}\n[GPS] ${gpsPos.lat.toFixed(6)},${gpsPos.lng.toFixed(6)} · ${new Date().toLocaleString()}` : content;
      if (fullContent.trim() || fileId) {
        await taskApi.addRecord(current.id, { content: fullContent, files: fileId ? [{ file_id: fileId }] : [] });
      }
      await taskApi.status(current.id, { action: "complete" });
      Toast.show("已完成，等待后台审核");
      setCurrent(null);
      setContent("");
      setPhoto(null);
      setGpsPos(null);
      void load();
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "完成失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModuleGate code="task" title="我的任务">
    <div style={{ minHeight: "100dvh", background: "#F2F5FB", paddingBottom: 24 }}>
      <NavBar onBack={() => navigate(-1)}>我的任务</NavBar>

      {/* 任务卡流（OP Wrap p12 gap10） */}
      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map((t) => {
          const pill = statusPill(t.status);
          return (
            <div key={t.id} style={{ background: "#fff", border: "1px solid #E4EAF6", borderRadius: 16, padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: "#1E2433" }}>{t.title}</span>
                <span className={`wlt-pill ${pill.cls}`} style={{ fontSize: 12, lineHeight: "20px", padding: "2px 10px" }}>{pill.label}</span>
              </div>
              <div style={{ fontSize: 10.5, color: "#8A93A8" }}>
                {t.task_no} · {t.priority === 2 ? "紧急" : "普通"}
              </div>
              {t.description && <div style={{ fontSize: 11.5, color: "#5B6478", lineHeight: 1.55 }}>{t.description}</div>}
              {(t.status === "pending" || t.status === "in_progress") && (
                t.status === "in_progress" ? (
                  <button
                    onClick={() => { setCurrent(t); setContent(""); setPhoto(null); setGpsPos(null); setRecommend([]); }}
                    style={{
                      marginTop: 2, height: 34, borderRadius: 10, border: "none",
                      background: "#5B7FFF", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer",
                    }}
                  >
                    填写记录并完成
                  </button>
                ) : (
                  <button
                    onClick={() => void act(t, "claim")}
                    style={{
                      marginTop: 2, height: 34, borderRadius: 10, border: "none",
                      background: "#F6F8FE", color: "#3B5BDB", fontSize: 12, fontWeight: 600, cursor: "pointer",
                    }}
                  >
                    领取并处理
                  </button>
                )
              )}
            </div>
          );
        })}
        {!loading && rows.length === 0 && (
          <div style={{ textAlign: "center", color: "#8A93A8", fontSize: 13, padding: "48px 0" }}>任务池暂无可处理的任务</div>
        )}
      </div>

      {/* 完成记录弹层（OP Sheet r20 白卡 p16/12；宽屏 .wlt-mobile-sheet 限宽居中） */}
      {current && (
        <div
          className="wlt-mobile-sheet"
          style={{
            position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 1000,
            background: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20,
            boxShadow: "0 -4px 16px rgba(30,36,51,.08)",
            padding: "16px 12px calc(16px + env(safe-area-inset-bottom))",
            display: "flex", flexDirection: "column", gap: 8,
            maxHeight: "70dvh", overflowY: "auto",
          }}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: "#1E2433" }}>填写完成记录</span>
            <span onClick={() => setCurrent(null)} style={{ fontSize: 13, color: "#8A93A8", padding: "0 4px", cursor: "pointer" }}>×</span>
          </div>

          {/* 记录输入块（OP Txt r10 bg#F6F8FE） */}
          <TextArea placeholder={`维修内容（可选）：${current.title}`} value={content} onChange={setContent} rows={3}
            style={{ "--background-color": "#F6F8FE", "--border-radius": "10px", "--font-size": "12.5px", "--gap-x": "12px" } as React.CSSProperties} />

          {/* 照片行（OP Img：44×44 占位格 r10 + 说明文字；选图后显示缩略图，附 GPS 留痕） */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input type="file" accept="image/*" id="task-photo" style={{ display: "none" }} onChange={(e) => void pickPhoto(e.target.files?.[0] ?? null)} />
            <label htmlFor="task-photo" style={{ width: 44, height: 44, borderRadius: 10, background: "#F6F8FE", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, cursor: "pointer", overflow: "hidden" }}>
              {photo ? (
                <img src={URL.createObjectURL(photo)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="#8A93A8" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="6" width="18" height="14" rx="2" />
                  <circle cx="9" cy="11" r="1.6" />
                  <path d="M21 17l-5-5-6 6" />
                </svg>
              )}
            </label>
            <span style={{ fontSize: 11.5, color: "#5B6478", lineHeight: 1.5 }}>
              {photo ? "已选照片（点击更换）" : "+ 维修照片（建议附现场照，GPS 留痕）"}
              {gpsPos && (
                <span style={{ display: "block", fontSize: 10.5, color: "#15803D" }}>
                  ✓ 已附定位 {gpsPos.lat.toFixed(4)}, {gpsPos.lng.toFixed(4)}
                </span>
              )}
            </span>
          </div>

          {/* 操作区 */}
          <div style={{ display: "flex", gap: 8 }}>
            <Button block color="primary" loading={busy} onClick={complete} style={{ background: "#5B7FFF", borderColor: "#5B7FFF", borderRadius: 12, fontWeight: 600 }}>完成任务</Button>
            <Button block fill="outline" onClick={() => {
              taskApi.recommend(current.id).then((r) => setRecommend(r.items ?? [])).catch(() => undefined);
            }} style={{ borderRadius: 12, color: "#3B5BDB", borderColor: "#CBD6EC" }}>知识推荐</Button>
            <Button block fill="outline" onClick={() => setCurrent(null)} style={{ borderRadius: 12, color: "#5B6478", borderColor: "#CBD6EC" }}>关闭</Button>
          </div>

          {/* 知识推荐（OP ✦ 行 11px #3B5BDB） */}
          {recommend.map((a) => (
            <div key={a.id} style={{ padding: "6px 0" }}>
              <div style={{ fontSize: 11, color: "#3B5BDB" }}>✦ 知识推荐：{a.title}</div>
              {a.snippet && <div style={{ fontSize: 10.5, color: "#8A93A8", marginTop: 2 }}>{a.snippet}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
    </ModuleGate>
  );
}
