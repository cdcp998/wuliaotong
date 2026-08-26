/** 导出格式设置（系统设置分区）：全局默认 + 模块级覆盖（库存查询/操作日志/盘点导出/库存流水）。
 *
 * 配置存储于 sys_config KV：export.global / export.module.<key>；
 * 合并优先级：请求级(ExportFormatModal) > 模块级 > 全局默认 > 内置默认。
 * 权限：查看=登录；修改=sys:config（超管/管理者）。
 *
 * 界面（OP 设计语言）：渐变页头 + 优先级链提示 + 模块卡片式作用域选择 +
 * 分区表单 + 底部固定操作条（脏状态提示 / 放弃修改 / 清除覆盖 / 保存）。
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { App, Button, Card, Col, ColorPicker, InputNumber, Row, Select, Space, Switch, Tag } from "antd";
import { DatabaseOutlined, FileExcelOutlined, FileSearchOutlined, GlobalOutlined, ProfileOutlined, SaveOutlined, SwapOutlined, UndoOutlined } from "@ant-design/icons";

import { systemApi } from "@wlt/shared";

type Format = Record<string, any>;

const MODULES: { key: string; label: string; desc: string; icon: ReactNode }[] = [
  { key: "stock_query", label: "库存查询 / 库存报表", desc: "库存余额、周转与呆滞报表", icon: <DatabaseOutlined /> },
  { key: "operation_logs", label: "操作日志", desc: "写操作审计记录导出", icon: <FileSearchOutlined /> },
  { key: "check_export", label: "盘点导出", desc: "收发存模板 + 盘点结果", icon: <ProfileOutlined /> },
  { key: "flow", label: "库存流水导出", desc: "出入库流明明细", icon: <SwapOutlined /> },
];

const C = {
  primary: "#5B7FFF",
  deep: "#3B5BDB",
  text: "#1E2433",
  sub: "#6A748A",
  faint: "#9AA5BD",
  border: "#EFF3FC",
  sectionBg: "#F2F5FB",
  selectedBg: "#F2F6FF",
};

function deepMerge(base: Format, override?: Format | null): Format {
  const out: Format = { ...base };
  if (!override) return out;
  for (const [k, v] of Object.entries(override)) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object"
      ? deepMerge(base[k], v)
      : v;
  }
  return out;
}

/** 表单字段：统一标签（上方）+ 控件（下方）的纵向节奏。 */
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <span style={{ fontSize: 12, color: C.sub }}>
        {label}
        {hint ? <span style={{ marginLeft: 6, fontSize: 11, color: C.faint }}>{hint}</span> : null}
      </span>
      {children}
    </div>
  );
}

/** 分区卡片：彩色小图标 + 标题，右侧可放分区说明。 */
function SectionCard({ icon, title, desc, children }: { icon: ReactNode; title: string; desc?: string; children: ReactNode }) {
  return (
    <Card
      size="small"
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 22, height: 22, borderRadius: 7, background: "#EAEFFF", color: C.deep, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>{icon}</span>
          <span style={{ fontWeight: 700, fontSize: 13.5 }}>{title}</span>
        </span>
      }
      extra={desc ? <span style={{ fontSize: 11.5, color: C.faint }}>{desc}</span> : null}
    >
      {children}
    </Card>
  );
}

export function ExportFormatsPanel({ canEdit }: { canEdit: boolean }) {
  const { message } = App.useApp();
  const [scope, setScope] = useState<string>("global"); // global | moduleKey
  const [overrides, setOverrides] = useState<Record<string, Format | null>>({});
  const [globalCfg, setGlobalCfg] = useState<Format>({});
  const [builtin, setBuiltin] = useState<Format>({});
  /** 当前作用域内用户未保存的编辑增量（相对合并结果）。 */
  const [edits, setEdits] = useState<Format>({});
  const [saving, setSaving] = useState(false);

  const reload = () => {
    systemApi.getExportFormats().then((r) => {
      setGlobalCfg(r.global ?? {});
      setOverrides(r.modules ?? {});
      setBuiltin(r.builtin ?? {});
    }).catch(() => message.error("加载导出格式配置失败"));
  };
  useEffect(() => { reload(); }, []);

  // 展示草稿 = 内置 ← 全局已存 ← 模块覆盖 ← 本次编辑（实时合并）
  const draft = useMemo(() => {
    const base = deepMerge(deepMerge(builtin, globalCfg), scope !== "global" ? (overrides[scope] ?? {}) : {});
    return deepMerge(base, edits);
  }, [builtin, globalCfg, overrides, scope, edits]);

  const dirty = Object.keys(edits).length > 0;
  const scopedLabel = scope === "global" ? "全局默认设置" : (MODULES.find((m) => m.key === scope)?.label ?? scope);
  const overrideCount = MODULES.filter((m) => overrides[m.key] && Object.keys(overrides[m.key] ?? {}).length).length;

  /** 按嵌套路径写入编辑增量。 */
  const set = (path: string[], value: unknown) => setEdits((e) => {
    const next: Format = JSON.parse(JSON.stringify(e));
    let cur = next;
    path.slice(0, -1).forEach((k) => { cur[k] ??= {}; cur = cur[k]; });
    cur[path[path.length - 1]] = value;
    return next;
  });

  const save = async () => {
    setSaving(true);
    try {
      if (scope === "global") {
        await systemApi.saveGlobalExportFormat(edits);
        message.success("全局默认格式已保存");
      } else {
        await systemApi.saveModuleExportFormat(scope, Object.keys(edits).length ? edits : null);
        message.success(Object.keys(edits).length ? "模块级覆盖已保存" : "已清除模块级覆盖，回退全局默认");
      }
      setEdits({});
      reload();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const clearOverride = async () => {
    if (scope === "global") return;
    await systemApi.saveModuleExportFormat(scope, null);
    setEdits({});
    message.success("已清除模块级覆盖，回退全局默认");
    reload();
  };

  const h = draft.header ?? {};
  const cw = draft.columnWidth ?? {};
  const rh = draft.rowHeight ?? {};
  const df = draft.dataFormat ?? {};
  const op = draft.options ?? {};

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* 页头：标题 + 合并优先级链 + 权限徽标 */}
      <div style={{ background: "linear-gradient(135deg, #EAEFFF 0%, #F6F8FE 65%)", border: `1px solid #D9E3FF`, borderRadius: 16, padding: "16px 20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 34, height: 34, borderRadius: 11, background: `linear-gradient(135deg, ${C.primary}, #7D97FF)`, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 17, boxShadow: "0 3px 10px rgba(91,127,255,.35)" }}>
                <FileExcelOutlined />
              </span>
              <span style={{ fontSize: 17, fontWeight: 700, color: C.text }}>导出格式设置</span>
            </div>
            <div style={{ marginTop: 8, fontSize: 12.5, color: C.sub }}>
              统一管理所有表格导出的样式与数据格式；各业务模块内的「导出设置」按钮会叠加此处配置。
            </div>
            {/* 合并优先级链 */}
            <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontSize: 11.5 }}>
              <span style={{ color: C.faint }}>合并优先级：</span>
              {[["弹窗当次设置", "#EAEFFF", C.deep], ["模块级覆盖", "#E8F9EF", "#15803D"], ["全局默认", "#FFF6E5", "#B45309"], ["系统内置", "#EFF3FC", "#5B6478"]].map(([t, bg, fg], i) => (
                <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  {i > 0 && <span style={{ color: C.faint }}>＜</span>}
                  <span style={{ background: bg as string, color: fg as string, borderRadius: 999, padding: "2px 10px" }}>{t}</span>
                </span>
              ))}
            </div>
          </div>
          <Tag style={{ borderRadius: 999, background: canEdit ? "#E8F9EF" : "#EFF3FC", color: canEdit ? "#15803D" : C.sub, borderColor: "transparent", marginInlineEnd: 0 }}>
            {canEdit ? "可修改（sys:config）" : "只读查看"}
          </Tag>
        </div>
      </div>

      {/* 作用域选择：卡片式（全局 + 各模块，显示覆盖状态） */}
      <SectionCard icon={<GlobalOutlined />} title="配置范围" desc={`点击切换要编辑的作用域 · 已有 ${overrideCount} 个模块使用独立覆盖`}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
          {[
            { key: "global", label: "🌐 全局默认设置", desc: "作用于全部导出模块", icon: <GlobalOutlined />, overridden: false },
            ...MODULES.map((m) => ({ ...m, overridden: Boolean(overrides[m.key] && Object.keys(overrides[m.key] ?? {}).length) })),
          ].map((m) => {
            const active = scope === m.key;
            return (
              <div
                key={m.key}
                onClick={() => setScope(m.key)}
                style={{
                  cursor: "pointer", borderRadius: 12, padding: "10px 12px",
                  border: `1.5px solid ${active ? C.primary : C.border}`,
                  background: active ? C.selectedBg : "#fff",
                  boxShadow: active ? "0 2px 10px rgba(91,127,255,.16)" : "none",
                  transition: "border-color .2s, box-shadow .2s, background .2s",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                    <span style={{ width: 20, height: 20, borderRadius: 6, background: active ? C.primary : C.sectionBg, color: active ? "#fff" : C.deep, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11 }}>{m.icon}</span>
                    <b style={{ fontSize: 12.5, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.label}</b>
                  </span>
                  {m.overridden && <span style={{ flexShrink: 0, fontSize: 10.5, background: "#E8F9EF", color: "#15803D", borderRadius: 999, padding: "1px 8px" }}>覆盖中</span>}
                  {m.key === "global" && !active && <span style={{ flexShrink: 0, fontSize: 10.5, color: C.faint }}>默认</span>}
                </div>
                <div style={{ marginTop: 5, fontSize: 11, color: m.overridden ? "#15803D" : C.sub, opacity: m.overridden ? undefined : 0.85 }}>{m.desc}</div>
              </div>
            );
          })}
        </div>
      </SectionCard>

      {/* 表格样式 */}
      <SectionCard icon={<FileExcelOutlined />} title="表格样式" desc="表头行的外观">
        <Row gutter={[16, 14]}>
          <Col xs={12} md={6}><Field label="表头背景色">
            <ColorPicker size="small" value={`#${String(h.bg ?? "F6F8FE").replace("#", "")}`} onChange={(c) => set(["header", "bg"], c.toHexString().replace("#", ""))} disabled={!canEdit} />
          </Field></Col>
          <Col xs={12} md={5}><Field label="表头字体">
            <Select size="small" style={{ width: "100%" }} value={h.font ?? "宋体"} onChange={(v) => set(["header", "font"], v)} disabled={!canEdit} options={["宋体", "微软雅黑", "黑体"].map((f) => ({ value: f, label: f }))} />
          </Field></Col>
          <Col xs={8} md={4}><Field label="字号">
            <InputNumber size="small" min={8} max={20} value={h.size ?? 12} onChange={(v) => set(["header", "size"], v ?? 12)} disabled={!canEdit} style={{ width: "100%" }} />
          </Field></Col>
          <Col xs={8} md={4}><Field label="加粗">
            <Switch size="small" checked={h.bold ?? true} onChange={(v) => set(["header", "bold"], v)} disabled={!canEdit} />
          </Field></Col>
          <Col xs={8} md={5}><Field label="对齐">
            <Select size="small" style={{ width: "100%" }} value={h.align ?? "center"} onChange={(v) => set(["header", "align"], v)} disabled={!canEdit} options={[{ value: "left", label: "左对齐" }, { value: "center", label: "居中" }, { value: "right", label: "右对齐" }]} />
          </Field></Col>
        </Row>
      </SectionCard>

      {/* 列宽 / 行高 */}
      <SectionCard icon={<SwapOutlined />} title="列宽与行高" desc="自适应范围或固定宽度">
        <Row gutter={[16, 14]}>
          <Col xs={12} md={6}><Field label="列宽模式">
            <Select size="small" style={{ width: "100%" }} value={cw.mode ?? "auto"} onChange={(v) => set(["columnWidth", "mode"], v)} disabled={!canEdit}
              options={[{ value: "auto", label: "自适应内容" }, { value: "fixed", label: "固定宽度" }]} />
          </Field></Col>
          <Col xs={8} md={4}><Field label="固定宽度"><InputNumber size="small" min={6} max={80} value={cw.fixed ?? 20} onChange={(v) => set(["columnWidth", "fixed"], v ?? 20)} disabled={!canEdit || cw.mode !== "fixed"} style={{ width: "100%" }} /></Field></Col>
          <Col xs={8} md={4}><Field label="最小宽度"><InputNumber size="small" min={4} max={40} value={cw.min ?? 8} onChange={(v) => set(["columnWidth", "min"], v ?? 8)} disabled={!canEdit} style={{ width: "100%" }} /></Field></Col>
          <Col xs={8} md={4}><Field label="最大宽度"><InputNumber size="small" min={20} max={120} value={cw.max ?? 55} onChange={(v) => set(["columnWidth", "max"], v ?? 55)} disabled={!canEdit} style={{ width: "100%" }} /></Field></Col>
          <Col xs={12} md={6}><Field label="数据行高"><InputNumber size="small" min={14} max={60} step={0.15} value={rh.data ?? 25.15} onChange={(v) => set(["rowHeight", "data"], v ?? 25.15)} disabled={!canEdit} style={{ width: "100%" }} /></Field></Col>
        </Row>
      </SectionCard>

      {/* 数据格式 */}
      <SectionCard icon={<ProfileOutlined />} title="数据格式" desc="日期/时间显示与数值精度">
        <Row gutter={[16, 14]}>
          <Col xs={12} md={7}><Field label="日期格式">
            <Select size="small" style={{ width: "100%" }} value={df.dateFormat ?? "yyyy-mm-dd"} onChange={(v) => set(["dataFormat", "dateFormat"], v)} disabled={!canEdit}
              options={["yyyy-mm-dd", "yyyy/mm/dd", "dd-mm-yyyy"].map((f) => ({ value: f, label: f }))} />
          </Field></Col>
          <Col xs={12} md={9}><Field label="时间格式">
            <Select size="small" style={{ width: "100%" }} value={df.timeFormat ?? "yyyy-mm-dd hh:mm:ss"} onChange={(v) => set(["dataFormat", "timeFormat"], v)} disabled={!canEdit}
              options={["yyyy-mm-dd hh:mm:ss", "yyyy/mm/dd hh:mm", "hh:mm:ss"].map((f) => ({ value: f, label: f }))} />
          </Field></Col>
          <Col xs={6} md={4}><Field label="千分位"><Switch size="small" checked={df.thousands ?? false} onChange={(v) => set(["dataFormat", "thousands"], v)} disabled={!canEdit} /></Field></Col>
          <Col xs={6} md={4}><Field label="小数位"><InputNumber size="small" min={0} max={6} value={df.decimals ?? 2} onChange={(v) => set(["dataFormat", "decimals"], v ?? 2)} disabled={!canEdit} style={{ width: "100%" }} /></Field></Col>
        </Row>
      </SectionCard>

      {/* 其他选项 */}
      <SectionCard icon={<GlobalOutlined />} title="其他" desc="通用行为开关">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
          {([
            ["冻结首行", op.freezeHeader ?? true, (v: boolean) => set(["options", "freezeHeader"], v)],
            ["自动筛选", op.autoFilter ?? true, (v: boolean) => set(["options", "autoFilter"], v)],
            ["显示网格线", op.gridlines ?? false, (v: boolean) => set(["options", "gridlines"], v)],
            ["长号码强制文本", draft.longNumberAsText ?? true, (v: boolean) => set(["longNumberAsText"], v)],
            ["自动换行", draft.wrapText ?? true, (v: boolean) => set(["wrapText"], v)],
          ] as [string, boolean, (v: boolean) => void][]).map(([label, checked, onChange]) => (
            <div key={label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, background: C.sectionBg, borderRadius: 10, padding: "7px 12px" }}>
              <span style={{ fontSize: 12.5, color: C.text }}>{label}</span>
              <Switch size="small" checked={checked} onChange={onChange} disabled={!canEdit} />
            </div>
          ))}
        </div>
      </SectionCard>

      {/* 底部操作条：状态 + 放弃 / 清除覆盖 / 保存 */}
      {canEdit && (
        <div style={{
          position: "sticky", bottom: 0, zIndex: 2,
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap",
          background: "rgba(246,248,254,.94)", backdropFilter: "blur(6px)",
          border: `1px solid ${dirty ? "#D9E3FF" : C.border}`, borderRadius: 12, padding: "10px 14px",
          boxShadow: dirty ? "0 -4px 16px rgba(91,127,255,.08)" : "none",
        }}>
          <span style={{ fontSize: 12, color: C.sub, display: "inline-flex", alignItems: "center", gap: 8 }}>
            正在编辑：<b style={{ color: C.deep }}>{scopedLabel}</b>
            {dirty ? (
              <Tag style={{ borderRadius: 999, background: "#FFF6E5", color: "#B45309", borderColor: "transparent", marginInlineEnd: 0 }}>有未保存的修改</Tag>
            ) : (
              <span style={{ color: C.faint }}>与已保存配置一致</span>
            )}
          </span>
          <Space wrap>
            {scope !== "global" && overrides[scope] && (
              <Button size="small" type="link" danger onClick={() => void clearOverride()}>
                清除本模块覆盖（回退全局）
              </Button>
            )}
            {dirty && (
              <Button icon={<UndoOutlined />} disabled={saving} onClick={() => setEdits({})}>放弃修改</Button>
            )}
            <Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={!dirty} onClick={() => void save()}>
              保存{scope === "global" ? "全局默认" : "模块覆盖"}设置
            </Button>
          </Space>
        </div>
      )}
    </div>
  );
}
