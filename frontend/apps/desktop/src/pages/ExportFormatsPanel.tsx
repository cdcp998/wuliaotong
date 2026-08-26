/** 导出格式设置（系统设置分区）· v3 重设计：左右主从布局。
 *
 * THESIS：作用域是导航而不是下拉框——左栏常驻「全局 + 四个模块」（含覆盖状态徽标与列级
 * 弹窗⚙入口），右侧专注当前作用域的设置；内容区首个分区是真实样式的 Excel 效果预览，
 * 改任何格式立即所见即所得。设计语言沿用全站 OP 体系（品牌蓝 #5B7FFF / 浅底 #F2F5FB /
 * 白卡大圆角），不另起视觉世界。
 *
 * 配置存储于 sys_config KV：export.global / export.module.<key>；
 * 合并优先级：请求级(ExportFormatModal) > 模块级 > 全局默认 > 内置默认。
 * 权限：查看=登录；修改=sys:config（超管/管理者）。
 */
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { App, Button, ColorPicker, InputNumber, Segmented, Select, Space, Switch, Tag, Tooltip } from "antd";
import { DatabaseOutlined, FileExcelOutlined, FileSearchOutlined, GlobalOutlined, ProfileOutlined, SaveOutlined, SettingOutlined, SwapOutlined, UndoOutlined } from "@ant-design/icons";

import { adminApi, checkApi, exportReportPreview, systemApi } from "@wlt/shared";

import { ExportFormatModal, type ExportField } from "../components/ExportFormatModal";
import { CHECK_FIELDS, FLOW_FIELDS, LOGS_FIELDS, STOCK_FIELDS } from "./exportFields";

type Format = Record<string, any>;

const C = {
  primary: "#5B7FFF",
  deep: "#3B5BDB",
  text: "#1E2433",
  sub: "#6A748A",
  hint: "#68748E",
  border: "#EFF3FC",
  borderStrong: "#D9E0F2",
  sectionBg: "#F2F5FB",
  selectedBg: "#EAEFFF",
};

const MODULES: { key: string; label: string; desc: string; icon: ReactNode }[] = [
  { key: "stock_query", label: "库存查询 / 库存报表", desc: "库存余额、周转与呆滞报表导出", icon: <DatabaseOutlined /> },
  { key: "operation_logs", label: "操作日志", desc: "写操作审计记录导出", icon: <FileSearchOutlined /> },
  { key: "check_export", label: "盘点导出", desc: "收发存模板 + 盘点结果", icon: <ProfileOutlined /> },
  { key: "flow", label: "库存流水导出", desc: "出入库流明明细", icon: <SwapOutlined /> },
];

/** 各模块「导出格式设置」弹窗接入：字段定义 / 本地存储键 / 预览数据源（前 10 条真实数据）。
 * 与各业务模块页内按钮共用同一 storageKey，任意一处修改全局生效。 */
const MODULE_EXPORT_META: Record<string, { fields: ExportField[]; storageKey: string; preview: () => Promise<unknown[][]> }> = {
  stock_query: { fields: STOCK_FIELDS, storageKey: "export_fmt_stock", preview: () => exportReportPreview({ type: "stock" }).then((r) => r.rows) },
  operation_logs: { fields: LOGS_FIELDS, storageKey: "export_fmt_operation_logs", preview: () => adminApi.logsExportPreview().then((r) => r.rows) },
  check_export: {
    fields: CHECK_FIELDS,
    storageKey: "export_fmt_check_export",
    // 预览取最近一张盘点单；无盘点单时返回空（仍可选择列/格式并保存）
    preview: async () => {
      const d = await checkApi.list(undefined, 1, 1);
      const id = d.list[0]?.id;
      if (!id) return [];
      return (await checkApi.exportPreview(id)).rows;
    },
  },
  flow: { fields: FLOW_FIELDS, storageKey: "export_fmt_flow", preview: () => exportReportPreview({ type: "flow" }).then((r) => r.rows) },
};

/** 合并优先级链（生效顺序自上而下递减）。 */
const PRIORITY_CHAIN: [string, string][] = [
  ["请求级 · 弹窗当次设置", C.deep],
  ["模块级覆盖", "#15803D"],
  ["全局默认", "#B45309"],
  ["系统内置", "#5B6478"],
];

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

/** 响应式断点（按视口宽）：≥1024 桌面 / 768~1023 平板 / <768 移动端。 */
export type ViewportTier = "mobile" | "tablet" | "desktop";

export function useViewportTier(): ViewportTier {
  const [w, setW] = useState(() => (typeof window === "undefined" ? 1024 : window.innerWidth));
  useEffect(() => {
    const onResize = () => setW(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return w >= 1024 ? "desktop" : w >= 768 ? "tablet" : "mobile";
}

/** 表单字段：统一标签（上方）+ 控件（下方）的纵向节奏。 */
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <span style={{ fontSize: 13, color: C.sub }}>
        {label}
        {hint ? <span style={{ marginLeft: 6, fontSize: 11.5, color: C.hint }}>{hint}</span> : null}
      </span>
      {children}
    </div>
  );
}

/** 布尔开关字段：与输入控件同高内联（开关+文字），不再独占栅格列被拉空。 */
function BoolField({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 13, visibility: "hidden" }} aria-hidden>占位</span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 32 }}>
        <Switch checked={checked} onChange={onChange} disabled={disabled} />
        <span style={{ fontSize: 13.5, color: C.text }}>{label}</span>
      </span>
    </div>
  );
}

/** 表单控件行：流式换行、底部对齐，窄容器自动折行而不拉伸。 */
const FIELD_ROW: CSSProperties = { display: "flex", flexWrap: "wrap", gap: "14px 22px", alignItems: "flex-end" };

/** 内容区分节头：小图标 + 标题，右侧可放说明。 */
function SectionHead({ icon, title, hint }: { icon: ReactNode; title: string; hint?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 22, height: 22, borderRadius: 7, background: C.selectedBg, color: C.deep, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>{icon}</span>
        <b style={{ fontSize: 13.5, color: C.text }}>{title}</b>
      </span>
      {hint ? <span style={{ fontSize: 11.5, color: C.hint }}>{hint}</span> : null}
    </div>
  );
}

/** 分节之间的通栏分隔线。 */
function Rule() {
  return <div aria-hidden style={{ height: 1, background: C.border, margin: "16px -18px" }} />;
}

const PREVIEW_COLS: { title: string; width?: number; kind: "text" | "longtext" | "num" | "date" }[] = [
  { title: "物料编码", width: 190, kind: "longtext" },
  { title: "物料名称", kind: "text" },
  { title: "数量", width: 96, kind: "num" },
  { title: "金额", width: 110, kind: "num" },
  { title: "入库日期", width: 118, kind: "date" },
];

const LONG_NO = "61022520230601000123";

function dateSample(fmt: string): string {
  if (fmt === "yyyy/mm/dd") return "2026/08/26";
  if (fmt === "dd-mm-yyyy") return "26-08-2026";
  return "2026-08-26";
}

function numSample(v: number, decimals: number, thousands: boolean): string {
  return thousands
    ? v.toLocaleString("zh-CN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    : v.toFixed(decimals);
}

/** 用当前草稿渲染的 Excel 效果示意（表头色/字体/字号/加粗/对齐、正文字体、行高、
 * 千分位与小数位、日期格式、网格线开关、长号码文本保护提示）。 */
function ExcelPreview({ draft }: { draft: Format }) {
  const h = draft.header ?? {};
  const b = draft.body ?? {};
  const rh = draft.rowHeight ?? {};
  const df = draft.dataFormat ?? {};
  const op = draft.options ?? {};

  const pt2px = (pt: number) => Math.max(10, Math.round(pt * 1.25));
  const headFont: CSSProperties = {
    fontFamily: `"${h.font ?? "宋体"}", serif`,
    fontSize: pt2px(h.size ?? 12),
    fontWeight: (h.bold ?? true) ? 700 : 400,
  };
  const bodyFont: CSSProperties = { fontFamily: `"${b.font ?? "宋体"}", serif`, fontSize: pt2px(b.size ?? 11) };
  const rowH = Math.min(46, Math.max(22, Math.round((rh.data ?? 25.15) * 1.25)));
  const headAlign = (h.align ?? "center") as CSSProperties["textAlign"];
  const dec = typeof df.decimals === "number" ? df.decimals : 2;
  const thousands = Boolean(df.thousands);

  const rows: string[][] = [
    [LONG_NO, "冷轧板 1.5×1250×2500", numSample(1234.5, dec, thousands), numSample(98760, dec, thousands), dateSample(String(df.dateFormat ?? "yyyy-mm-dd"))],
    ["M-000872", "镀锌方管 40×40×2000", numSample(88, dec, thousands), numSample(3520, dec, thousands), dateSample(String(df.dateFormat ?? "yyyy-mm-dd"))],
  ];

  return (
    <div>
      <div style={{ overflowX: "auto", paddingBottom: 2 }}>
        <div style={{ border: `1px solid ${C.borderStrong}`, borderRadius: 10, background: "#fff", minWidth: 560, maxWidth: 720, overflow: "hidden" }}>
          {/* 表头行 */}
          <div style={{ display: "flex", background: `#${String(h.bg ?? "F6F8FE").replace("#", "")}`, borderBottom: "1px solid #C9D4EE" }}>
            {PREVIEW_COLS.map((c) => (
              <div
                key={c.title}
                style={{
                  ...(c.width ? { width: c.width, flexShrink: 0 } : { flex: 1, minWidth: 0 }),
                  padding: "7px 12px", textAlign: headAlign, color: "#1F2937",
                  borderRight: "1px solid rgba(30, 36, 51, 0.08)", whiteSpace: "nowrap", ...headFont,
                }}
              >
                {c.title}
              </div>
            ))}
          </div>
          {/* 数据行 */}
          {rows.map((r, ri) => (
            <div key={ri} style={{ display: "flex", height: rowH, borderBottom: op.gridlines ? "1px solid #E4EAF6" : ri < rows.length - 1 ? "1px solid rgba(30,36,51,0.04)" : undefined }}>
              {r.map((v, ci) => {
                const c = PREVIEW_COLS[ci];
                const numeric = c.kind === "num";
                return (
                  <div
                    key={ci}
                    style={{
                      ...(c.width ? { width: c.width, flexShrink: 0 } : { flex: 1, minWidth: 0 }),
                      padding: "4px 12px", lineHeight: `${rowH - 10}px`,
                      textAlign: numeric ? "right" : "left",
                      color: c.kind === "longtext" && /^\d{15,}$/.test(v) && (draft.longNumberAsText ?? true) ? C.sub : C.text,
                      borderRight: ci < r.length - 1 && op.gridlines ? "1px solid #E4EAF6" : undefined,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", ...bodyFont,
                    }}
                    title={v}
                  >
                    {v}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 3, fontSize: 11.5 }}>
        {(draft.longNumberAsText ?? true) ? (
          <span style={{ color: C.hint }}>⟬文本⟭ 长号码按文本写入，Excel 中完整显示、不会变科学计数法。</span>
        ) : (
          <span style={{ color: "#B45309" }}>⚠ 未开启长号码文本保护，{LONG_NO.slice(0, 6)}… 可能被 Excel 显示为科学计数法。</span>
        )}
        <span style={{ color: C.hint }}>预览实时反映上方配置（含未保存的修改）；行高/字号为近似换算，以实际导出为准。</span>
      </div>
    </div>
  );
}

export function ExportFormatsPanel({ canEdit }: { canEdit: boolean }) {
  const { message } = App.useApp();
  // 断点：<768 移动端（左栏横向滑动条带）、768~1023 平板（左栏自动换行卡片）、≥1024 桌面（左右主从）
  const tier = useViewportTier();
  const railVertical = tier === "desktop";

  const [scope, setScope] = useState<string>("global"); // global | moduleKey
  const [overrides, setOverrides] = useState<Record<string, Format | null>>({});
  const [globalCfg, setGlobalCfg] = useState<Format>({});
  const [builtin, setBuiltin] = useState<Format>({});
  /** 当前作用域内用户未保存的编辑增量（相对合并结果）。 */
  const [edits, setEdits] = useState<Format>({});
  const [saving, setSaving] = useState(false);
  /** 当前打开「导出格式设置」弹窗的模块（null=关闭；global 无列级弹窗）。 */
  const [fmtModule, setFmtModule] = useState<string | null>(null);
  const fmtMeta = fmtModule ? MODULE_EXPORT_META[fmtModule] : null;

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
  const scopedDesc =
    scope === "global"
      ? "作用于全部导出模块；某模块存在独立覆盖时，该模块导出优先使用覆盖值。"
      : (MODULES.find((m) => m.key === scope)?.desc ?? "") +
        ((overrides[scope] && Object.keys(overrides[scope]).length) ? " · 当前已启用模块级覆盖。" : " · 未单独覆盖，导出时跟随全局默认。");

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

  /** 左栏作用域项（radio 语义，支持键盘选择）。 */
  const scopeItems = [
    { key: "global", label: "全局默认设置", desc: "", icon: <GlobalOutlined />, overridden: false },
    ...MODULES.map((m) => ({ ...m, overridden: Boolean(overrides[m.key] && Object.keys(overrides[m.key] ?? {}).length) })),
  ];

  return (
    <div style={{ display: "flex", flexDirection: railVertical ? "row" : "column", gap: 16, alignItems: "stretch" }}>
      {/* ── 左栏：作用域导航 + 优先级图例 ─────────────────────────── */}
      <aside style={{ width: railVertical ? 232 : undefined, flexShrink: 0, display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: C.sub, padding: "0 2px" }}>配置范围</div>
        <div
          role="radiogroup"
          aria-label="配置范围"
          style={{
            display: "flex",
            flexDirection: railVertical ? "column" : "row",
            flexWrap: tier === "tablet" ? "wrap" : undefined,
            gap: 6,
            overflowX: tier === "mobile" ? "auto" : undefined,
            paddingBottom: tier === "mobile" ? 4 : undefined,
          }}
        >
          {scopeItems.map((m) => {
            const active = scope === m.key;
            return (
              <div
                key={m.key}
                role="radio"
                aria-checked={active}
                tabIndex={0}
                onClick={() => setScope(m.key)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setScope(m.key); } }}
                style={{
                  flexShrink: tier === "mobile" ? 0 : undefined,
                  display: "flex", alignItems: "center", gap: 9,
                  padding: "8px 8px 8px 12px", borderRadius: 12, cursor: "pointer", userSelect: "none",
                  minWidth: tier === "mobile" ? 176 : undefined,
                  maxWidth: "100%",
                  background: active ? C.selectedBg : "#FFFFFF",
                  border: `1.5px solid ${active ? C.primary : C.border}`,
                  boxShadow: active ? "0 2px 10px rgba(91,127,255,.14)" : "none",
                  transition: "border-color .15s ease, box-shadow .15s ease, background .15s ease",
                }}
              >
                <span style={{ width: 24, height: 24, borderRadius: 7, background: active ? C.primary : C.sectionBg, color: active ? "#fff" : C.deep, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, flexShrink: 0 }}>{m.icon}</span>
                <span style={{ flex: 1, textAlign: "left", fontSize: 13, fontWeight: active ? 700 : 500, color: active ? C.deep : C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.label}</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                  {m.overridden && (
                    <Tag style={{ marginInlineEnd: 0, borderRadius: 999, background: "#E8F9EF", color: "#15803D", borderColor: "transparent", fontSize: 10.5, lineHeight: "16px", paddingInline: 7 }}>覆盖中</Tag>
                  )}
                  {m.key !== "global" && (
                    <Tooltip title="打开该模块的「导出格式设置」弹窗（列选择 / 字段格式 / 列宽）">
                      <Button
                        size="small"
                        type="text"
                        aria-label={`打开 ${m.label} 导出格式设置弹窗`}
                        icon={<SettingOutlined style={{ color: active ? C.primary : C.sub }} />}
                        onClick={(e) => { e.stopPropagation(); setFmtModule(m.key); }}
                      />
                    </Tooltip>
                  )}
                </span>
              </div>
            );
          })}
        </div>

        {/* 优先级图例 + 权限（窄屏时移到条带下方） */}
        <div style={{ background: C.sectionBg, borderRadius: 12, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 11.5, color: C.sub }}>合并优先级（上 ＞ 下）</div>
          {PRIORITY_CHAIN.map(([t, fg]) => (
            <div key={t} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, color: fg }}>
              <span style={{ width: 7, height: 7, borderRadius: 999, background: fg, flexShrink: 0 }} />
              {t}
            </div>
          ))}
          <Tag style={{ marginTop: 2, borderRadius: 999, background: canEdit ? "#E8F9EF" : "#EFF3FC", color: canEdit ? "#15803D" : C.sub, borderColor: "transparent", marginInlineEnd: 0, alignSelf: "flex-start" }}>
            {canEdit ? "可修改（sys:config）" : "只读查看"}
          </Tag>
        </div>
      </aside>

      {/* ── 右栏：当前作用域详情 ───────────────────────────────────── */}
      <section style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        {/* 作用域标题行 */}
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap", padding: "0 2px" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.text }}>{scopedLabel}</h3>
              {scope !== "global" && (overrides[scope] && Object.keys(overrides[scope]).length ? (
                <Tag style={{ borderRadius: 999, background: "#E8F9EF", color: "#15803D", borderColor: "transparent", marginInlineEnd: 0 }}>模块覆盖生效中</Tag>
              ) : (
                <span style={{ fontSize: 12, color: C.hint }}>跟随全局默认</span>
              ))}
            </div>
            <p style={{ margin: "4px 0 0", fontSize: 12.5, color: C.sub }}>{scopedDesc}</p>
          </div>
          {scope !== "global" && fmtMeta && (
            <Button size="small" icon={<SettingOutlined />} onClick={() => setFmtModule(scope)}>
              列级格式弹窗
            </Button>
          )}
        </header>

        {/* 设置卡片：预览 + 各分节（单一平面，避免卡中卡） */}
        <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 16, padding: "16px 18px" }}>
          <section>
            <SectionHead icon={<FileExcelOutlined />} title="效果预览" hint="所见即所得 · 实时反映下方配置" />
            <ExcelPreview draft={draft} />
          </section>

          <Rule />

          <section>
            <SectionHead icon={<FileExcelOutlined />} title="表格样式" hint="表头行的外观" />
            <div style={FIELD_ROW}>
              <Field label="表头背景色">
                <Space size={10}>
                  <ColorPicker value={`#${String(h.bg ?? "F6F8FE").replace("#", "")}`} onChange={(c) => set(["header", "bg"], c.toHexString().replace("#", ""))} disabled={!canEdit} showText />
                </Space>
              </Field>
              <div style={{ width: 156 }}><Field label="表头字体">
                <Select style={{ width: "100%" }} value={h.font ?? "宋体"} onChange={(v) => set(["header", "font"], v)} disabled={!canEdit} options={["宋体", "微软雅黑", "黑体"].map((f) => ({ value: f, label: f }))} />
              </Field></div>
              <div style={{ width: 104 }}><Field label="字号">
                <InputNumber min={8} max={20} value={h.size ?? 12} onChange={(v) => set(["header", "size"], v ?? 12)} disabled={!canEdit} style={{ width: "100%" }} />
              </Field></div>
              <BoolField label="加粗" checked={h.bold ?? true} onChange={(v) => set(["header", "bold"], v)} disabled={!canEdit} />
              <Field label="对齐">
                <Segmented
                  value={h.align ?? "center"}
                  onChange={(v) => set(["header", "align"], v)}
                  disabled={!canEdit}
                  options={[{ value: "left", label: "居左" }, { value: "center", label: "居中" }, { value: "right", label: "居右" }]}
                />
              </Field>
            </div>
          </section>

          <Rule />

          <section>
            <SectionHead icon={<SwapOutlined />} title="列宽与行高" hint="自适应范围或固定宽度" />
            <div style={FIELD_ROW}>
              <div style={{ width: 156 }}><Field label="列宽模式">
                <Select style={{ width: "100%" }} value={cw.mode ?? "auto"} onChange={(v) => set(["columnWidth", "mode"], v)} disabled={!canEdit}
                  options={[{ value: "auto", label: "自适应内容" }, { value: "fixed", label: "固定宽度" }]} />
              </Field></div>
              <div style={{ width: 110 }}><Field label="固定宽度"><InputNumber min={6} max={80} value={cw.fixed ?? 20} onChange={(v) => set(["columnWidth", "fixed"], v ?? 20)} disabled={!canEdit || cw.mode !== "fixed"} style={{ width: "100%" }} /></Field></div>
              <div style={{ width: 110 }}><Field label="最小宽度"><InputNumber min={4} max={40} value={cw.min ?? 8} onChange={(v) => set(["columnWidth", "min"], v ?? 8)} disabled={!canEdit} style={{ width: "100%" }} /></Field></div>
              <div style={{ width: 110 }}><Field label="最大宽度"><InputNumber min={20} max={120} value={cw.max ?? 55} onChange={(v) => set(["columnWidth", "max"], v ?? 55)} disabled={!canEdit} style={{ width: "100%" }} /></Field></div>
              <div style={{ width: 124 }}><Field label="数据行高"><InputNumber min={14} max={60} step={0.15} value={rh.data ?? 25.15} onChange={(v) => set(["rowHeight", "data"], v ?? 25.15)} disabled={!canEdit} style={{ width: "100%" }} /></Field></div>
            </div>
          </section>

          <Rule />

          <section>
            <SectionHead icon={<ProfileOutlined />} title="数据格式" hint="数值精度与日期显示" />
            <div style={FIELD_ROW}>
              <Field label="日期格式">
                <Select style={{ width: 172 }} value={df.dateFormat ?? "yyyy-mm-dd"} onChange={(v) => set(["dataFormat", "dateFormat"], v)} disabled={!canEdit}
                  options={["yyyy-mm-dd", "yyyy/mm/dd", "dd-mm-yyyy"].map((f) => ({ value: f, label: f }))} />
              </Field>
              <Field label="时间格式">
                <Select style={{ width: 216 }} value={df.timeFormat ?? "yyyy-mm-dd hh:mm:ss"} onChange={(v) => set(["dataFormat", "timeFormat"], v)} disabled={!canEdit}
                  options={["yyyy-mm-dd hh:mm:ss", "yyyy/mm/dd hh:mm", "hh:mm:ss"].map((f) => ({ value: f, label: f }))} />
              </Field>
              <Field label="数值">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 32 }}>
                  <Switch checked={df.thousands ?? false} onChange={(v) => set(["dataFormat", "thousands"], v)} disabled={!canEdit} />
                  <span style={{ fontSize: 13.5, color: C.text }}>千分位</span>
                  <span aria-hidden style={{ width: 1, height: 18, background: C.borderStrong, margin: "0 4px" }} />
                  <InputNumber min={0} max={6} value={df.decimals ?? 2} onChange={(v) => set(["dataFormat", "decimals"], v ?? 2)} disabled={!canEdit} style={{ width: 76 }} />
                  <span style={{ fontSize: 13.5, color: C.text }}>位小数</span>
                </span>
              </Field>
            </div>
          </section>

          <Rule />

          <section>
            <SectionHead icon={<GlobalOutlined />} title="其他" hint="通用行为开关" />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {([
                ["冻结首行", op.freezeHeader ?? true, (v: boolean) => set(["options", "freezeHeader"], v)],
                ["自动筛选", op.autoFilter ?? true, (v: boolean) => set(["options", "autoFilter"], v)],
                ["显示网格线", op.gridlines ?? false, (v: boolean) => set(["options", "gridlines"], v)],
                ["长号码强制文本", draft.longNumberAsText ?? true, (v: boolean) => set(["longNumberAsText"], v)],
                ["自动换行", draft.wrapText ?? true, (v: boolean) => set(["wrapText"], v)],
              ] as [string, boolean, (v: boolean) => void][]).map(([label, checked, onChange]) => (
                <div
                  key={label}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 9,
                    background: C.sectionBg, borderRadius: 10, padding: "8px 14px",
                    fontSize: 13.5, color: C.text,
                  }}
                >
                  <span>{label}</span>
                  <Switch size="small" checked={checked} onChange={onChange} disabled={!canEdit} />
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* 底部操作条：状态 + 放弃 / 清除覆盖 / 保存 */}
        {canEdit && (
          <div style={{
            position: "sticky", bottom: 0, zIndex: 2,
            display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap",
            background: "rgba(255,255,255,.94)", backdropFilter: "blur(6px)",
            border: `1px solid ${dirty ? "#D9E3FF" : C.border}`, borderRadius: 14, padding: "10px 14px",
            boxShadow: dirty ? "0 4px 18px rgba(91,127,255,.12)" : "0 2px 8px rgba(30,36,51,.04)",
          }}>
            <span style={{ fontSize: 12, color: C.sub, display: "inline-flex", alignItems: "center", gap: 8 }}>
              正在编辑：<b style={{ color: C.deep }}>{scopedLabel}</b>
              {dirty ? (
                <Tag style={{ borderRadius: 999, background: "#FFF6E5", color: "#B45309", borderColor: "transparent", marginInlineEnd: 0 }}>有未保存的修改</Tag>
              ) : (
                <span style={{ color: C.hint }}>与已保存配置一致</span>
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
              {/* 文字恒白：全局 .ant-btn-primary 渐变底未锁字色，这里内联保证对比度；禁用态交还 antd 默认灰字 */}
              <Button
                type="primary"
                icon={<SaveOutlined />}
                loading={saving}
                disabled={!dirty}
                style={dirty ? { color: "#fff" } : undefined}
                onClick={() => void save()}
              >
                保存{scope === "global" ? "全局默认" : "模块覆盖"}设置
              </Button>
            </Space>
          </div>
        )}
      </section>

      {/* 模块级「导出格式设置」弹窗（与业务模块页内按钮共用同一份本地格式，统一修改入口） */}
      <ExportFormatModal
        open={Boolean(fmtMeta)}
        onClose={() => setFmtModule(null)}
        fields={fmtMeta?.fields ?? []}
        storageKey={fmtMeta?.storageKey ?? "export_fmt_none"}
        getPreviewRows={() => (fmtMeta ? fmtMeta.preview() : Promise.resolve([]))}
        onExport={() => message.info("请在对应业务页面点击「导出 Excel」，将自动应用此处保存的格式")}
        hideExportAction
      />
    </div>
  );
}
