/** 导出格式设置（系统设置分区）：全局默认 + 模块级覆盖（库存查询/操作日志/盘点导出/库存流水）。
 *
 * 配置存储于 sys_config KV：export.global / export.module.<key>；
 * 合并优先级：请求级(ExportFormatModal) > 模块级 > 全局默认 > 内置默认。
 * 权限：查看=登录；修改=sys:config（超管/管理者）。
 */
import { useEffect, useMemo, useState } from "react";
import { App, Button, Card, Col, ColorPicker, InputNumber, Row, Select, Space, Switch } from "antd";
import { RedoOutlined } from "@ant-design/icons";

import { systemApi } from "@wlt/shared";

type Format = Record<string, any>;

const MODULES: { key: string; label: string }[] = [
  { key: "stock_query", label: "库存查询 / 库存报表" },
  { key: "operation_logs", label: "操作日志" },
  { key: "check_export", label: "盘点导出" },
  { key: "flow", label: "库存流水导出" },
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
      <div style={{ fontSize: 12, color: "#6A748A" }}>
        统一管理所有表格导出的样式与数据格式。合并优先级：模块级覆盖 &gt; 全局默认 &gt; 系统内置。
      </div>

      {/* 作用域选择 */}
      <Card size="small" title="配置范围">
        <Select
          style={{ width: 320 }}
          value={scope}
          onChange={(v) => setScope(v)}
          options={[{ value: "global", label: "🌐 全局默认设置" }, ...MODULES.map((m) => ({ value: m.key, label: `模块：${m.label}` }))]}
        />
        {scope !== "global" && overrides[scope] && (
          <Button size="small" type="link" danger onClick={() => void clearOverride()} style={{ marginLeft: 12 }}>
            清除本模块覆盖（回退全局）
          </Button>
        )}
      </Card>

      {/* 表格样式 */}
      <Card size="small" title="表格样式">
        <Row gutter={16}>
          <Col span={6}><span style={{ fontSize: 12.5 }}>表头背景色</span>
            <ColorPicker size="small" value={`#${String(h.bg ?? "F6F8FE").replace("#", "")}`} onChange={(c) => set(["header", "bg"], c.toHexString().replace("#", ""))} disabled={!canEdit} />
          </Col>
          <Col span={5}><span style={{ fontSize: 12.5 }}>表头字体</span>
            <Select size="small" style={{ width: "100%" }} value={h.font ?? "宋体"} onChange={(v) => set(["header", "font"], v)} disabled={!canEdit} options={["宋体", "微软雅黑", "黑体"].map((f) => ({ value: f, label: f }))} />
          </Col>
          <Col span={4}><span style={{ fontSize: 12.5 }}>字号</span>
            <InputNumber size="small" min={8} max={20} value={h.size ?? 12} onChange={(v) => set(["header", "size"], v ?? 12)} disabled={!canEdit} style={{ width: "100%" }} />
          </Col>
          <Col span={4}><span style={{ fontSize: 12.5 }}>加粗</span><br />
            <Switch size="small" checked={h.bold ?? true} onChange={(v) => set(["header", "bold"], v)} disabled={!canEdit} />
          </Col>
          <Col span={5}><span style={{ fontSize: 12.5 }}>对齐</span><br />
            <Select size="small" style={{ width: "100%" }} value={h.align ?? "center"} onChange={(v) => set(["header", "align"], v)} disabled={!canEdit} options={["left", "center", "right"].map((a) => ({ value: a, label: a }))} />
          </Col>
        </Row>
      </Card>

      {/* 列宽 / 行高 */}
      <Card size="small" title="列宽与行高">
        <Row gutter={16}>
          <Col span={6}><span style={{ fontSize: 12.5 }}>列宽模式</span><br />
            <Select size="small" style={{ width: "100%", marginTop: 2 }} value={cw.mode ?? "auto"} onChange={(v) => set(["columnWidth", "mode"], v)} disabled={!canEdit}
              options={[{ value: "auto", label: "自适应内容" }, { value: "fixed", label: "固定宽度" }]} />
          </Col>
          <Col span={4}><span style={{ fontSize: 12.5 }}>固定宽度</span><br />
            <InputNumber size="small" min={6} max={80} value={cw.fixed ?? 20} onChange={(v) => set(["columnWidth", "fixed"], v ?? 20)} disabled={!canEdit || cw.mode !== "fixed"} style={{ width: "100%" }} />
          </Col>
          <Col span={4}><span style={{ fontSize: 12.5 }}>最小宽度</span><br />
            <InputNumber size="small" min={4} max={40} value={cw.min ?? 8} onChange={(v) => set(["columnWidth", "min"], v ?? 8)} disabled={!canEdit} style={{ width: "100%" }} />
          </Col>
          <Col span={4}><span style={{ fontSize: 12.5 }}>最大宽度</span><br />
            <InputNumber size="small" min={20} max={120} value={cw.max ?? 55} onChange={(v) => set(["columnWidth", "max"], v ?? 55)} disabled={!canEdit} style={{ width: "100%" }} />
          </Col>
          <Col span={6}><span style={{ fontSize: 12.5 }}>数据行高</span><br />
            <InputNumber size="small" min={14} max={60} step={0.15} value={rh.data ?? 25.15} onChange={(v) => set(["rowHeight", "data"], v ?? 25.15)} disabled={!canEdit} style={{ width: "100%" }} />
          </Col>
        </Row>
      </Card>

      {/* 数据格式 */}
      <Card size="small" title="数据格式">
        <Row gutter={16}>
          <Col span={7}><span style={{ fontSize: 12.5 }}>日期格式</span><br />
            <Select size="small" style={{ width: "100%", marginTop: 2 }} value={df.dateFormat ?? "yyyy-mm-dd"} onChange={(v) => set(["dataFormat", "dateFormat"], v)} disabled={!canEdit}
              options={["yyyy-mm-dd", "yyyy/mm/dd", "dd-mm-yyyy"].map((f) => ({ value: f, label: f }))} />
          </Col>
          <Col span={9}><span style={{ fontSize: 12.5 }}>时间格式</span><br />
            <Select size="small" style={{ width: "100%", marginTop: 2 }} value={df.timeFormat ?? "yyyy-mm-dd hh:mm:ss"} onChange={(v) => set(["dataFormat", "timeFormat"], v)} disabled={!canEdit}
              options={["yyyy-mm-dd hh:mm:ss", "yyyy/mm/dd hh:mm", "hh:mm:ss"].map((f) => ({ value: f, label: f }))} />
          </Col>
          <Col span={4}><span style={{ fontSize: 12.5 }}>千分位</span><br />
            <Switch size="small" checked={df.thousands ?? false} onChange={(v) => set(["dataFormat", "thousands"], v)} disabled={!canEdit} />
          </Col>
          <Col span={4}><span style={{ fontSize: 12.5 }}>小数位</span><br />
            <InputNumber size="small" min={0} max={6} value={df.decimals ?? 2} onChange={(v) => set(["dataFormat", "decimals"], v ?? 2)} disabled={!canEdit} style={{ width: "100%" }} />
          </Col>
        </Row>
      </Card>

      {/* 其他选项 */}
      <Card size="small" title="其他">
        <Space wrap size={20}>
          <span style={{ fontSize: 12.5 }}>冻结首行 <Switch size="small" checked={op.freezeHeader ?? true} onChange={(v) => set(["options", "freezeHeader"], v)} disabled={!canEdit} /></span>
          <span style={{ fontSize: 12.5 }}>自动筛选 <Switch size="small" checked={op.autoFilter ?? true} onChange={(v) => set(["options", "autoFilter"], v)} disabled={!canEdit} /></span>
          <span style={{ fontSize: 12.5 }}>显示网格线 <Switch size="small" checked={op.gridlines ?? false} onChange={(v) => set(["options", "gridlines"], v)} disabled={!canEdit} /></span>
          <span style={{ fontSize: 12.5 }}>长号码强制文本 <Switch size="small" checked={draft.longNumberAsText ?? true} onChange={(v) => set(["longNumberAsText"], v)} disabled={!canEdit} /></span>
          <span style={{ fontSize: 12.5 }}>自动换行 <Switch size="small" checked={draft.wrapText ?? true} onChange={(v) => set(["wrapText"], v)} disabled={!canEdit} /></span>
        </Space>
      </Card>

      {canEdit && (
        <div>
          <Button type="primary" icon={<RedoOutlined />} loading={saving} onClick={() => void save()}>保存{scope === "global" ? "全局默认" : "模块覆盖"}设置</Button>
        </div>
      )}
    </div>
  );
}
