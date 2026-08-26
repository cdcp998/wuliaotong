import { useEffect, useMemo, useState } from "react";
import { App, Button, Checkbox, Input, InputNumber, Modal, Radio, Select, Space, Table, Tag } from "antd";
import { HolderOutlined, PlusOutlined, ReloadOutlined, RedoOutlined, SearchOutlined } from "@ant-design/icons";

/** 导出格式规格（与后端 services/export_format.py 契约一致）。 */
export interface ExportFormatSpec {
  order: number[];
  fmt: Record<string, { type: string; decimals?: number; custom?: string }>;
  width: { default: "auto" | "manual"; manual?: number; cols?: Record<string, number> };
  global: { longNumberAsText: boolean; wrapText: boolean; noShrinkToFit: boolean };
}

export interface ExportField {
  key: number;
  label: string;
  /** 类型提示（仅用于默认格式建议展示，不强制）。 */
  hint?: "text" | "number" | "date";
}

const FMT_TYPE_OPTIONS = [
  { value: "default", label: "默认（保持原样）" },
  { value: "text", label: "文本（强制为文本，避免科学计数法）" },
  { value: "number", label: "数值（可设置小数位数）" },
  { value: "date", label: "日期（选择日期格式）" },
  { value: "custom", label: "自定义（输入自定义格式代码）" },
];

const DATE_PRESETS = ["yyyy-mm-dd", "yyyy-mm-dd hh:mm:ss", "yyyy/mm/dd", "hh:mm"];

/** 默认规格：全选原序 / 全部默认格式 / 自动列宽 / 全局三开关开启。 */
function defaultSpec(fields: ExportField[]): ExportFormatSpec {
  return {
    order: fields.map((f) => f.key),
    fmt: {},
    width: { default: "auto", cols: {} },
    global: { longNumberAsText: true, wrapText: true, noShrinkToFit: true },
  };
}

function loadSpec(storageKey: string, fields: ExportField[]): ExportFormatSpec {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw) as ExportFormatSpec;
      if (Array.isArray(parsed.order)) {
        // 过滤已不存在的字段并补齐新增字段
        const valid = parsed.order.filter((k) => fields.some((f) => f.key === k));
        for (const f of fields) if (!valid.includes(f.key)) valid.push(f.key);
        parsed.order = valid;
        return { ...defaultSpec(fields), ...parsed, order: valid };
      }
    }
  } catch { /* 忽略坏数据 */ }
  return defaultSpec(fields);
}

/** 按格式设置把单元格值转成预览显示文本（与后端 number_format 语义对齐）。 */
function applyCellFormat(v: unknown, f: ExportFormatSpec["fmt"][string] | undefined, globalLongAsText: boolean): string {
  if (v === null || v === undefined) return "";
  let s = typeof v === "string" ? v : String(v);
  const type = f?.type ?? "default";
  if (type === "text") return s;
  if (type === "number") {
    const n = Number(s);
    if (!Number.isNaN(n)) return n.toFixed(f?.decimals ?? 2);
  }
  if (type === "date") return s;
  // 全局：≥15 位纯数字标记为文本（预览加 ⟬ 文本 ⟭ 角标提示）
  if (globalLongAsText && /^\d{15,}$/.test(s)) return `${s} ⟨文本⟩`;
  return s;
}

/** 列宽自适应估算（CJK 计 2，钳制 8~55，与后端算法一致）。 */
function estimateWidth(samples: string[]): number {
  const contentMax = Math.max(4, ...samples.map((s) => s.length));
  const cjk = samples.reduce((acc, s) => acc + [...s].filter((ch) => ch.codePointAt(0)! > 0x2e80).length, 0);
  return Math.max(8, Math.min(55, Math.round(contentMax + cjk / Math.max(1, samples.length) + 4)));
}

/** 导出格式设置弹窗（设计语言同 OP：#5B7FFF 主色 / #F2F5FB 分区底 / 白卡圆角）。 */
export function ExportFormatModal(props: {
  open: boolean;
  onClose: () => void;
  fields: ExportField[];
  storageKey: string;
  /** 返回源列全序的样例行（前 10 条）供预览；可异步。 */
  getPreviewRows: () => unknown[][] | Promise<unknown[][]>;
  /** 「按此格式导出」回调（spec 已序列化为对象）。 */
  onExport: (spec: ExportFormatSpec) => void;
  /** 隐藏「按此格式导出」按钮（从系统设置面板打开时仅调整格式，不在当前上下文导出）。 */
  hideExportAction?: boolean;
}) {
  const { message } = App.useApp();
  const { open, onClose, fields, storageKey, getPreviewRows, onExport, hideExportAction } = props;
  const [spec, setSpec] = useState<ExportFormatSpec>(() => loadSpec(storageKey, fields));
  const [search, setSearch] = useState("");
  const [activeKey, setActiveKey] = useState<number | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [previewTick, setPreviewTick] = useState(0);
  const [asyncRows, setAsyncRows] = useState<unknown[][]>([]);

  useEffect(() => {
    if (!open) return;
    setSpec(loadSpec(storageKey, fields));
    Promise.resolve(getPreviewRows()).then(setAsyncRows).catch(() => setAsyncRows([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, storageKey, fields, previewTick]);

  const orderedFields = useMemo(() => {
    const byKey = new Map(fields.map((f) => [f.key, f]));
    return spec.order.map((k) => byKey.get(k)).filter(Boolean) as NonNullable<(typeof fields)[number]>[];
  }, [spec.order, fields]);

  const unselected = useMemo(() => {
    const kw = search.trim().toLowerCase();
    return fields.filter((f) => !spec.order.includes(f.key) && (!kw || f.label.toLowerCase().includes(kw)));
  }, [fields, spec.order, search]);

  const selectedSet = useMemo(() => new Set(spec.order), [spec.order]);
  const activeField = orderedFields.find((f) => f.key === activeKey) ?? null;
  const colFmt = (key: number) => spec.fmt[String(key)] ?? { type: "default" as const };

  const update = (patch: Partial<ExportFormatSpec>) => setSpec((s) => ({ ...s, ...patch }));
  const setColFmt = (key: number, patch: Partial<ExportFormatSpec["fmt"][string]>) =>
    setSpec((s) => ({ ...s, fmt: { ...s.fmt, [String(key)]: { ...colFmt(key), ...patch } } }));

  const toggleSelect = (key: number) => {
    setSpec((s) => ({
      ...s,
      order: selectedSet.has(key) ? s.order.filter((k) => k !== key) : [...s.order, key],
    }));
  };

  const reorder = (from: number, to: number) => {
    setSpec((s) => {
      const next = [...s.order];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return { ...s, order: next };
    });
  };

  /** 预览行（应用列筛选/顺序/格式后的前 10 行）。 */
  const previewRows = useMemo(
    () => asyncRows.map((r) => spec.order.map((srcIdx) => applyCellFormat(r[srcIdx], spec.fmt[String(srcIdx)], spec.global.longNumberAsText))),
    [asyncRows, spec]
  );

  const previewHeaders = orderedFields.map((f) => f.label);

  const save = () => {
    if (!spec.order.length) {
      message.error("请至少选择一个导出字段");
      return;
    }
    localStorage.setItem(storageKey, JSON.stringify(spec));
    message.success("导出格式设置已保存");
    onClose();
  };
  const exportNow = () => {
    if (!spec.order.length) {
      message.error("请至少选择一个导出字段");
      return;
    }
    localStorage.setItem(storageKey, JSON.stringify(spec));
    onExport(spec);
    onClose();
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={960}
      centered
      destroyOnHidden
      title={
        <div>
          <div style={{ fontSize: 17, fontWeight: 700 }}>导出格式设置</div>
          <div style={{ fontSize: 12, color: "#6A748A", fontWeight: 400, marginTop: 2 }}>
            自定义导出文件的显示方式，避免数据变形或显示不全
          </div>
        </div>
      }
      footer={
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Button
            icon={<RedoOutlined />}
            onClick={() => {
              if (window.confirm("确定恢复默认设置吗？")) setSpec(defaultSpec(fields));
            }}
          >
            恢复默认
          </Button>
          <Space>
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" onClick={save}>保存设置</Button>
            {!hideExportAction && (
              <Button type="primary" ghost onClick={exportNow} icon={<PlusOutlined />}>
                按此格式导出
              </Button>
            )}
          </Space>
        </div>
      }
      styles={{ body: { maxHeight: "72vh", overflowY: "auto", background: "#F2F5FB", borderRadius: 16, padding: 16 } }}
    >
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
        {/* 字段列表 */}
        <div style={{ width: 300, flexShrink: 0, background: "#fff", border: "1px solid #EFF3FC", borderRadius: 14, padding: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>选择导出字段</div>
          <div style={{ fontSize: 11.5, color: "#6A748A", marginBottom: 8 }}>勾选需要导出的列，可拖动调整顺序</div>
          <Input
            size="small"
            prefix={<SearchOutlined style={{ color: "#6A748A" }} />}
            placeholder="搜索字段名称"
            allowClear
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ marginBottom: 8 }}
          />
          <Checkbox
            checked={spec.order.length === fields.length}
            indeterminate={spec.order.length > 0 && spec.order.length < fields.length}
            onChange={(e) => update({ order: e.target.checked ? fields.map((f) => f.key) : [] })}
            style={{ fontSize: 12.5, marginBottom: 6 }}
          >
            全选
          </Checkbox>
          <div style={{ maxHeight: 320, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
            {orderedFields.map((f, idx) => (
              <div
                key={f.key}
                draggable
                onDragStart={() => setDragIdx(idx)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragIdx !== null && dragIdx !== idx) reorder(dragIdx, idx);
                  setDragIdx(null);
                }}
                title="拖动调整顺序"
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "6px 8px", borderRadius: 10, cursor: "grab",
                  background: activeKey === f.key ? "#EAEFFF" : dragIdx === idx ? "#F6F8FE" : undefined,
                  border: `1px solid ${activeKey === f.key ? "#5B7FFF" : "transparent"}`,
                }}
                onClick={() => setActiveKey(f.key)}
              >
                <HolderOutlined style={{ color: "#6A748A", cursor: "grab" }} />
                <Checkbox checked={selectedSet.has(f.key)} onClick={(e) => e.stopPropagation()} onChange={() => toggleSelect(f.key)} style={{ fontSize: 12.5 }} />
                <span style={{ flex: 1, fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.label}</span>
              </div>
            ))}
            {unselected.map((f) => (
              <div key={f.key} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", borderRadius: 10, opacity: 0.55 }} onClick={() => setActiveKey(f.key)}>
                <HolderOutlined style={{ visibility: "hidden" }} />
                <Checkbox checked={false} onChange={() => toggleSelect(f.key)} style={{ fontSize: 12.5 }} />
                <span style={{ flex: 1, fontSize: 12.5 }}>{f.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 右侧：格式 / 列宽 / 全局 */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          {/* 字段格式设置 */}
          <div style={{ background: "#fff", border: "1px solid #EFF3FC", borderRadius: 14, padding: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
              字段格式设置{activeField ? <Tag style={{ marginLeft: 8, borderRadius: 999, background: "#EAEFFF", color: "#3B5BDB", borderColor: "transparent" }}>{activeField.label}</Tag> : null}
            </div>
            {!activeField ? (
              <div style={{ fontSize: 12, color: "#6A748A" }}>← 在左侧点击选择一个字段后，可在此设置其显示格式与列宽</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12.5, color: "#5B6478", width: 76 }}>显示格式</span>
                  <Select
                    style={{ width: 280 }}
                    value={colFmt(activeField.key).type}
                    options={FMT_TYPE_OPTIONS}
                    onChange={(v) => setColFmt(activeField.key, { type: v })}
                  />
                </div>
                {colFmt(activeField.key).type === "number" && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 12.5, color: "#5B6478", width: 76 }}>小数位数</span>
                    <InputNumber
                      min={0}
                      max={8}
                      placeholder="0"
                      value={colFmt(activeField.key).decimals ?? 2}
                      onChange={(v) => setColFmt(activeField.key, { decimals: v ?? 2 })}
                      style={{ width: 120 }}
                    />
                    <span style={{ fontSize: 11.5, color: "#6A748A" }}>0 表示整数，2 表示保留两位小数</span>
                  </div>
                )}
                {(colFmt(activeField.key).type === "custom" || colFmt(activeField.key).type === "date") && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 12.5, color: "#5B6478", width: 76 }}>格式代码</span>
                    <Input
                      style={{ width: 220 }}
                      placeholder="例如：0.00、@、yyyy-mm-dd"
                      maxLength={60}
                      value={colFmt(activeField.key).custom}
                      onChange={(e) => setColFmt(activeField.key, { custom: e.target.value })}
                    />
                  </div>
                )}
                {colFmt(activeField.key).type === "custom" && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {DATE_PRESETS.map((p) => (
                      <a key={p} onClick={() => setColFmt(activeField.key, { custom: p })} style={{ fontSize: 11.5 }}>{p}</a>
                    ))}
                  </div>
                )}
                {colFmt(activeField.key).type === "custom" && (
                  <div style={{ fontSize: 11.5, color: "#6A748A" }}>支持 Excel 格式代码，如 “0.00” 保留两位小数，“@” 强制文本</div>
                )}

                {/* 列宽 */}
                <div style={{ borderTop: "1px dashed #EFF3FC", paddingTop: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12.5, color: "#5B6478", width: 76 }}>列宽</span>
                  <Radio.Group
                    size="small"
                    value={spec.width.cols?.[String(activeField.key)] ? "manual" : "auto"}
                    onChange={(e) => {
                      const v = e.target.value as "auto" | "manual";
                      const cols = { ...(spec.width.cols ?? {}) };
                      if (v === "manual") cols[String(activeField.key)] = cols[String(activeField.key)] ?? 20;
                      else delete cols[String(activeField.key)];
                      update({ width: { ...spec.width, cols } });
                    }}
                    options={[{ value: "auto", label: "自动调整" }, { value: "manual", label: "手动指定" }]}
                  />
                  {spec.width.cols?.[String(activeField.key)] ? (
                    <>
                      <InputNumber
                        size="small"
                        min={4}
                        max={100}
                        placeholder="例如 20"
                        value={spec.width.cols[String(activeField.key)]}
                        onChange={(v) => {
                          const cols = { ...(spec.width.cols ?? {}) };
                          if (v && v > 0) cols[String(activeField.key)] = v;
                          update({ width: { ...spec.width, cols } });
                        }}
                        style={{ width: 90 }}
                      />
                      <span style={{ fontSize: 11.5, color: "#6A748A" }}>字符宽度</span>
                    </>
                  ) : null}
                  <Button
                    size="small"
                    type="link"
                    disabled={!spec.width.cols?.[String(activeField.key)]}
                    onClick={() => {
                      const w = spec.width.cols?.[String(activeField.key)];
                      if (!w || w <= 0) return;
                      const cols: Record<string, number> = {};
                      for (const k of spec.order) cols[String(k)] = w;
                      update({ width: { ...spec.width, default: "manual", cols } });
                    }}
                  >
                    应用到所有字段
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* 全局默认设置 */}
          <div style={{ background: "#fff", border: "1px solid #EFF3FC", borderRadius: 14, padding: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>全局默认设置</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12.5 }}>
              <Checkbox checked={spec.global.longNumberAsText} onChange={(e) => update({ global: { ...spec.global, longNumberAsText: e.target.checked } })}>
                将超过 15 位的数字强制转为文本<span style={{ color: "#6A748A" }}>（避免科学计数法）</span>
              </Checkbox>
              <Checkbox checked={spec.global.wrapText} onChange={(e) => update({ global: { ...spec.global, wrapText: e.target.checked } })}>
                开启自动换行
              </Checkbox>
              <Checkbox checked={spec.global.noShrinkToFit} onChange={(e) => update({ global: { ...spec.global, noShrinkToFit: e.target.checked } })}>
                禁止缩小字体填充
              </Checkbox>
            </div>
          </div>
        </div>
      </div>

      {/* 预览 */}
      <div style={{ marginTop: 14, background: "#fff", border: "1px solid #EFF3FC", borderRadius: 14, padding: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div>
            <span style={{ fontSize: 13, fontWeight: 700 }}>预览</span>
            <span style={{ fontSize: 11.5, color: "#6A748A", marginLeft: 10 }}>预览效果基于前 10 条数据</span>
          </div>
          <Button size="small" icon={<ReloadOutlined />} onClick={() => setPreviewTick((t) => t + 1)}>刷新预览</Button>
        </div>
        <Table
          size="small"
          rowKey="__key"
          pagination={false}
          scroll={{ x: "max-content" }}
          columns={previewHeaders.map((h, i) => ({
            title: h,
            dataIndex: String(i),
            width: (() => {
              const manual = spec.width.cols?.[String(spec.order[i])];
              if (manual) return manual * 9;
              const est = estimateWidth(previewRows.map((r) => r[i] ?? ""));
              return est * 9;
            })(),
          }))}
          dataSource={previewRows.map((r, key) => ({ __key: String(key), ...Object.fromEntries(r.map((v, i) => [String(i), v])) }))}
        />
        <div style={{ fontSize: 11, color: "#6A748A", marginTop: 8 }}>
          提示：⟨文本⟩ 角标表示该长数字将按文本单元格写入，Excel 中完整显示、不会变成科学计数法。
        </div>
      </div>
    </Modal>
  );
}
