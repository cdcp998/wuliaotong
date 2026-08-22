import { Fragment, useEffect, useState } from "react";
import { Button, Dialog, NavBar, Popup, Tag, Toast } from "antd-mobile";
import { useNavigate, useParams } from "react-router";

import { PhotoUpload, WarnIcon, fileApi, FileImage, requisitionApi, useAuthStore, type RequisitionDetail } from "@wlt/shared";

const STATUS: Record<number, { text: string; color: string }> = {
  1: { text: "待完成工作", color: "warning" },
  2: { text: "待审计", color: "primary" },
  3: { text: "已完成", color: "success" },
  4: { text: "已驳回", color: "danger" },
  5: { text: "已取消", color: "default" },
};

/** 申请详情（手机端）：流程「领用申请 → 完成工作（拍照留痕+定位水印）→ 仓管员审计 → 完成」。
 *  待完成工作（1）可提交完成拍照；管理员可见私用标注；已完成可下载带水印照片。 */
export function RequisitionDetailPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<RequisitionDetail | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ok" | "notfound">("loading"); // 加载中/成功/不存在（含无权限）
  const user = useAuthStore((s) => s.user);
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const isAdmin = user?.role?.code === "super_admin" || hasPerm("req:audit");
  const isOwner = detail?.applicant_id === user?.id;

  // 完成工作拍照留痕（待完成工作状态下）
  const [workFileId, setWorkFileId] = useState<number | undefined>();
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [locating, setLocating] = useState(false);
  const [locText, setLocText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewing, setPreviewing] = useState(false);

  async function load() {
    setLoadState("loading");
    try {
      const d = await requisitionApi.detail(Number(id));
      setDetail(d);
      setLoadState("ok");
    } catch {
      // 单不存在/无权限 → 展示「未找到」视图（带返回键，避免卡死在无返回的空页）
      setDetail(null);
      setLoadState("notfound");
    }
  }

  useEffect(() => {
    void load();
  }, [id]);

  // 待完成工作时自动尝试获取手机定位（水印坐标；失败可手动重试）
  useEffect(() => {
    if (detail?.status === 1 && isOwner && navigator.geolocation) {
      getLocation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.status, isOwner]);

  function getLocation() {
    if (!navigator.geolocation) {
      setLocText("当前浏览器不支持定位");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const la = pos.coords.latitude.toFixed(6);
        const lo = pos.coords.longitude.toFixed(6);
        setLat(la);
        setLng(lo);
        setLocText(`已获取定位：${la}, ${lo}`);
        setLocating(false);
      },
      () => {
        setLocText("定位失败（可手动重试或直接提交，水印将显示“未获取定位”）");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  async function previewWork() {
    if (!detail || !workFileId) return Toast.show("请先在工作地点拍照");
    setPreviewing(true);
    try {
      const now = new Date();
      const time = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      const url = await fileApi.watermarkPreview(workFileId, {
        location: detail.use_location,
        time,
        lat,
        lng,
      });
      setPreviewUrl(url);
      setPreviewOpen(true);
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "预览失败");
    } finally {
      setPreviewing(false);
    }
  }

  async function submitWork() {
    if (!detail) return;
    if (!workFileId) return Toast.show("请先在工作地点拍照");
    setSubmitting(true);
    try {
      await requisitionApi.workDone(detail.id, workFileId, lat, lng);
      Toast.show("完成拍照已提交，等待仓管员审计");
      await load();
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  }

  function cancelBill() {
    if (!detail) return;
    Dialog.confirm({
      title: "取消申请？",
      content: "取消后本次领用出库将回补库存。",
      confirmText: "确认取消",
      onConfirm: async () => {
        try {
          await requisitionApi.cancel(detail.id);
          Toast.show("已取消");
          await load();
        } catch (e) {
          Toast.show(e instanceof Error ? e.message : "取消失败");
        }
      },
    });
  }

  // 加载中 / 单不存在：统一带返回 NavBar，不存在态提供「返回」按钮（防死端）
  if (loadState !== "ok" || !detail) {
    return (
      <div style={{ minHeight: "100dvh", background: "#F2F5FB" }}>
        <NavBar onBack={() => navigate(-1)}>申请详情</NavBar>
        <div style={{ padding: "72px 40px", textAlign: "center" }}>
          {loadState === "loading" ? (
            <div style={{ color: "#5B6478", fontSize: 14 }}>加载中…</div>
          ) : (
            <>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#1E2433" }}>未找到该领用单</div>
              <div style={{ fontSize: 12.5, color: "#5B6478", margin: "8px 0 24px", lineHeight: 1.7 }}>
                单号可能已删除，或您没有查看该单的权限。
              </div>
              <Button block color="primary" style={{ height: 42, borderRadius: 9, maxWidth: 240, margin: "0 auto" }} onClick={() => navigate(-1)}>
                返回
              </Button>
            </>
          )}
        </div>
      </div>
    );
  }

  const st = STATUS[detail.status];

  return (
    <div className="wlt-page-enter" style={{ minHeight: "100dvh", background: "#F2F5FB" }}>
      <NavBar onBack={() => navigate(-1)}>申请详情</NavBar>
      <div style={{ padding: 12 }}>
        {/* 单头信息 */}
        <div style={{ background: "#fff", border: "1px solid #f0f1f3", borderRadius: 12, padding: 14, marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>{detail.bill_no}</span>
            <Tag color={st.color}>{st.text}</Tag>
          </div>
          {detail.is_private === 1 && isAdmin && (
            <div style={{ background: "#fff1f0", border: "1px solid #ffccc7", color: "#cf1322", borderRadius: 10, padding: "10px 12px", fontSize: 12.5, marginTop: 10, lineHeight: 1.6 }}>
              <b>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <WarnIcon size={14} /> 私用申请
                </span>
              </b>
              ：因何使用已锁定为「私用」；对外显示：{detail.display_reason} / {detail.display_location}（仅管理员可见真实状态）
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 12px", marginTop: 12, fontSize: 12.5 }}>
            <div><div style={{ color: "#5B6478" }}>申请人</div><div style={{ marginTop: 2 }}>{detail.applicant_name}</div></div>
            <div><div style={{ color: "#5B6478" }}>仓库</div><div style={{ marginTop: 2 }}>{detail.warehouse_name}</div></div>
            <div style={{ gridColumn: "1/-1" }}><div style={{ color: "#5B6478" }}>使用地点（必填）</div><div style={{ marginTop: 2, fontWeight: 500 }}>{detail.use_location}</div></div>
            <div style={{ gridColumn: "1/-1" }}><div style={{ color: "#5B6478" }}>因何使用（必填）</div><div style={{ marginTop: 2, fontWeight: 500 }}>{detail.use_reason}</div></div>
            <div><div style={{ color: "#5B6478" }}>申请时间</div><div style={{ marginTop: 2 }}>{detail.created_at.slice(0, 16)}</div></div>
            <div><div style={{ color: "#5B6478" }}>总数量</div><div style={{ marginTop: 2 }}>{detail.total_qty}</div></div>
          </div>

          {/* 进度时间线（设计页 M11：提交✓→拍照→审计→完成） */}
          {[1, 2, 3].includes(detail.status) && (
            <div style={{ display: "flex", marginTop: 14, paddingTop: 12, borderTop: "1px solid #f0f1f3" }}>
              {(() => {
                const cur = detail.status === 1 ? 1 : detail.status === 2 ? 2 : -1;
                const steps = [
                  { label: "提交", done: true },
                  { label: "拍照", done: detail.status >= 2 },
                  { label: "审计", done: detail.status >= 3 },
                  { label: "完成", done: detail.status === 3 },
                ];
                return steps.map((s, i) => (
                  <Fragment key={s.label}>
                    <span style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 48, flexShrink: 0 }}>
                      <span
                        style={{
                          width: 14, height: 14, borderRadius: "50%", flexShrink: 0,
                          background: s.done ? "#22C55E" : i === cur ? "#5B7FFF" : "#E4EAF6",
                          boxShadow: s.done ? "0 0 0 3px #E8F9EF" : i === cur ? "0 0 0 3px #EAEFFF" : "none",
                          display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 9, lineHeight: 1,
                        }}
                      >
                        {s.done ? "✓" : i === cur ? "•" : ""}
                      </span>
                      <span style={{ fontSize: 10.5, marginTop: 4, color: s.done ? "#15803D" : i === cur ? "#5B7FFF" : "#8A93A8", whiteSpace: "nowrap" }}>{s.label}</span>
                    </span>
                    {i < steps.length - 1 && <span style={{ flex: 1, height: 2, background: s.done ? "#22C55E" : "#E4EAF6", marginTop: 6 }} />}
                  </Fragment>
                ));
              })()}
            </div>
          )}
        </div>

        {/* 完成工作（拍照留痕 + 定位水印）—— 待完成工作状态、本人操作 */}
        {detail.status === 1 && isOwner && (
          <div style={{ background: "#fff", border: "1px solid #EAEFFF", borderRadius: 12, padding: 14, marginBottom: 10 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: "#5B7FFF", marginBottom: 6 }}>完成工作（拍照留痕）</div>
            <div style={{ fontSize: 12, color: "#5B6478", lineHeight: 1.7, marginBottom: 10 }}>
              材料已领用，请在工作完成后于工作地点拍照。系统读取手机定位，下载照片时自动添加地点/时间/坐标水印（原始照片不保存水印）。
            </div>
            <PhotoUpload bizType="requisition_work" fileId={workFileId} onChange={setWorkFileId} />
            <Button size="small" fill="outline" color="primary" loading={previewing} style={{ marginTop: 10 }} onClick={() => void previewWork()}>
              预览水印效果
            </Button>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
              <Button size="small" fill="outline" color="primary" loading={locating} onClick={getLocation}>
                获取定位
              </Button>
              <span style={{ fontSize: 11.5, color: lat ? "#389e0d" : "#5B6478", flex: 1 }}>
                {locText || (lat ? `已获取：${lat}, ${lng}` : "点击获取手机定位（水印坐标）")}
              </span>
            </div>
            <Button block color="primary" loading={submitting} style={{ marginTop: 10, height: 40, borderRadius: 9 }} onClick={() => void submitWork()}>
              提交完成拍照（进入待审计）
            </Button>
          </div>
        )}

        {/* 完成工作照片（已提交/审计后：预览原图 + 下载水印图） */}
        {detail.status >= 2 && detail.status !== 5 && detail.work_photo_file_id > 0 && (
          <div style={{ background: "#fff", border: "1px solid #f0f1f3", borderRadius: 12, padding: 14, marginBottom: 10 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 8 }}>完成工作照片（工作地点留痕）</div>
            <FileImage fileId={detail.work_photo_file_id} size={140} alt="完成工作照片" />
            <div style={{ fontSize: 11.5, color: "#5B6478", marginTop: 6 }}>
              {detail.work_done_at ? `完成时间：${detail.work_done_at.slice(0, 16)}` : ""}
              {detail.work_lat ? `　定位：${detail.work_lat}, ${detail.work_lng}` : "　未获取定位"}
            </div>
            <Button block fill="outline" color="primary" style={{ marginTop: 10, height: 38, borderRadius: 9 }} onClick={() => { window.open(requisitionApi.workPhotoUrl(detail.id), "_self"); }}>
              下载水印照片（自动添加地点/时间/坐标水印）
            </Button>
          </div>
        )}

        {/* 明细 */}
        <div style={{ background: "#fff", border: "1px solid #f0f1f3", borderRadius: 12, overflow: "hidden", marginBottom: 10 }}>
          <div style={{ padding: "11px 14px", borderBottom: "1px solid #F2F5FB", fontSize: 13.5, fontWeight: 600 }}>
            领用明细（{detail.items.length} 项）
          </div>
          {detail.items.map((it) => (
            <div key={it.id} style={{ padding: "11px 14px", borderBottom: "1px solid #F2F5FB", display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 500 }}>{it.product_name}</div>
                <div style={{ fontSize: 11.5, color: "#5B6478", marginTop: 2 }}>
                  {it.location_code}
                  {it.spec ? ` · ${it.spec}` : ""}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{it.qty}</div>
                <div style={{ fontSize: 10.5, color: "#c9cdd4", marginTop: 2 }}>{it.photo_file_id ? "已留痕" : "未拍照"}</div>
              </div>
            </div>
          ))}
        </div>

        {/* 审计结果 */}
        {detail.status === 3 && detail.audit_name && (
          <div style={{ background: "#f6ffed", border: "1px solid #b7eb8f", color: "#389e0d", borderRadius: 12, padding: 12, fontSize: 13, marginBottom: 10 }}>
            已由 {detail.audit_name} 于 {detail.audit_time?.slice(0, 16)} 审计通过，流程完成。
          </div>
        )}
        {detail.status === 4 && detail.audit_remark && (
          <div style={{ background: "#fff1f0", border: "1px solid #ffccc7", color: "#cf1322", borderRadius: 12, padding: 12, fontSize: 13, marginBottom: 10 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>驳回原因</div>
            {detail.audit_remark}
          </div>
        )}

        {/* 操作按钮 */}
        {detail.status === 1 && isOwner && (
          <Button block fill="outline" color="danger" style={{ height: 40, borderRadius: 9, marginBottom: 8 }} onClick={cancelBill}>
            取消申请（回补库存）
          </Button>
        )}
        {detail.status === 2 && isOwner && (
          <Button block fill="outline" color="danger" style={{ height: 40, borderRadius: 9, marginBottom: 8 }} onClick={cancelBill}>
            取消申请（回补库存）
          </Button>
        )}
        {detail.status === 4 && (
          <Button block color="primary" style={{ height: 42, borderRadius: 9 }} onClick={() => navigate("/requisitions/new")}>
            修改后重新提交
          </Button>
        )}
      </div>
      {/* 水印预览弹层 */}
      <Popup visible={previewOpen} onMaskClick={() => setPreviewOpen(false)} bodyStyle={{ height: "70vh", background: "#1E2433", padding: 12, overflow: "auto" }}>
        <div style={{ color: "#fff", fontSize: 13, fontWeight: 600, marginBottom: 10 }}>水印预览（实际照片下载时按同样规则添加）</div>
        {previewUrl && <img src={previewUrl} alt="水印预览" style={{ width: "100%", borderRadius: 8 }} />}
        <Button block fill="outline" color="primary" style={{ marginTop: 12, height: 40, borderRadius: 9 }} onClick={() => setPreviewOpen(false)}>
          关闭预览
        </Button>
      </Popup>
    </div>
  );
}
