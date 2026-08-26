import { useState, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { App, Button, Checkbox, Popover, Table, Tooltip } from "antd";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";
import { DeleteOutlined, SettingOutlined } from "@ant-design/icons";

/**
 * 通用增强表格（全站列表统一使用）：
 * - 列宽拖拽：表头右侧 6px 手柄，拖动实时调整（最小 60px）；未设宽的列自动补 140
 * - 行选择：rowSelection 开启复选框；工具条显示已选数量
 * - 批量操作：onBatchDelete（删除/停用）或 batchActions（自定义批量按钮，如批量通过/驳回），执行前弹窗确认
 * - 列设置：columnSelector（默认开启）可勾选显示/隐藏列（自定义需要获取的字段）
 */
export interface DataTableBatchAction {
  label: string;
  danger?: boolean;
  icon?: ReactNode;
  /** 确认弹窗文案；不传则直接执行。 */
  confirm?: string;
  onClick: (keys: React.Key[]) => Promise<void> | void;
}

export interface DataTableProps<T extends object> {
  rowKey: keyof T | ((r: T) => React.Key);
  columns: ColumnsType<T>;
  dataSource: T[];
  loading?: boolean;
  pagination?: false | TablePaginationConfig;
  /** 开启行选择（复选框）。 */
  rowSelection?: boolean;
  /** 批量删除/停用回调（确认弹窗通过后调用，keys 为选中行主键）。 */
  onBatchDelete?: (keys: React.Key[]) => Promise<void> | void;
  /** 批量删除确认文案。 */
  batchDeleteConfirm?: string;
  /** 自定义批量操作按钮（如批量通过/驳回）。 */
  batchActions?: DataTableBatchAction[];
  /** 操作列渲染（追加为最后一列）。 */
  actions?: (record: T, index: number) => ReactNode;
  actionsWidth?: number;
  /** 列设置（勾选显示列）。 */
  columnSelector?: boolean;
  scroll?: { x?: number | string | true; y?: number | string };
  locale?: Record<string, unknown>;
  size?: "small" | "middle" | "large";
  style?: CSSProperties;
  footer?: (data: readonly T[]) => ReactNode;
}

type ResizeHeaderProps = HTMLAttributes<HTMLTableCellElement> & { width?: number; onResize?: (w: number) => void };
function ResizableTitle({ width, onResize, children, ...rest }: ResizeHeaderProps) {
  return (
    <th {...rest} style={{ ...rest.style, position: "relative" }}>
      {children}
      {onResize && (
        <span
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const startX = e.clientX;
            const startW = width ?? 120;
            const move = (ev: MouseEvent) => onResize(Math.max(60, startW + ev.clientX - startX));
            const up = () => {
              document.removeEventListener("mousemove", move);
              document.removeEventListener("mouseup", up);
              document.body.style.cursor = "";
              document.body.style.userSelect = "";
            };
            document.addEventListener("mousemove", move);
            document.addEventListener("mouseup", up);
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
          }}
          style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: 6, cursor: "col-resize", zIndex: 2, userSelect: "none" }}
        />
      )}
    </th>
  );
}

/** 取列唯一 key（用于列宽记忆/列设置）。 */
function colKey<T extends object>(c: ColumnsType<T>[number], index: number): string {
  const k = (c as { key?: unknown }).key ?? (c as { dataIndex?: unknown }).dataIndex;
  return typeof k === "string" || typeof k === "number" ? String(k) : `col-${index}`;
}

/** 批量逐条执行（onBatchDelete / batchActions 回调专用）：单条失败不中断后续，
 * 返回成功条数与失败原因列表（后端业务提示），由调用方统一刷新列表并提示部分失败。 */
export async function runBatchEach(
  keys: React.Key[],
  run: (id: number) => Promise<unknown>
): Promise<{ ok: number; fail: string[] }> {
  let ok = 0;
  const fail: string[] = [];
  for (const k of keys) {
    try {
      await run(Number(k));
      ok++;
    } catch (e) {
      fail.push(e instanceof Error ? e.message : `行 ${String(k)}`);
    }
  }
  return { ok, fail };
}

export function DataTable<T extends object>(props: DataTableProps<T>) {
  const { modal, message } = App.useApp();
  const {
    rowKey,
    columns,
    dataSource,
    loading,
    pagination,
    rowSelection: enableSelect,
    onBatchDelete,
    batchDeleteConfirm = "确定删除选中的行吗？删除后不可恢复，且存在业务引用的行会被拒绝。",
    batchActions,
    actions,
    actionsWidth = 120,
    columnSelector = true,
    scroll,
    locale,
    size: initSize = "middle",
    style,
    footer,
  } = props;

  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set());

  function toggleCol(key: string, show: boolean) {
    setHiddenCols((prev) => {
      const next = new Set(prev);
      if (show) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const allCols: ColumnsType<T> = [
    ...columns
      .map((c, i) => {
        const key = colKey(c, i);
        // 未显式设宽的列补默认宽 140，保证全部列都可拖拽调整
        const width = (c as { width?: number }).width ?? 140;
        return {
          ...c,
          width: colWidths[key] ?? width,
          onHeaderCell: () => ({
            width: colWidths[key] ?? width,
            onResize: (w: number) => setColWidths((m) => ({ ...m, [key]: w })),
          }),
        } as ColumnsType<T>[number];
      })
      .filter((c, i) => !hiddenCols.has(colKey(c, i))),
    ...(actions
      ? [
          {
            title: "操作",
            key: "__actions",
            width: actionsWidth,
            fixed: "right" as const,
            render: (_: unknown, r: T, i: number) => actions(r, i),
          },
        ]
      : []),
  ];

  function runBatch(label: string, danger: boolean | undefined, confirm: string | undefined, run: () => Promise<void> | void) {
    const doRun = async () => {
      try {
        await run();
      } catch (e) {
        // 兜底：回调内部未捕获的业务异常必须提示用户（禁止静默失败）；保留选中便于重试
        message.error(e instanceof Error ? e.message : `${label}失败`);
        return;
      }
      setSelectedKeys([]);
    };
    if (confirm) {
      modal.confirm({
        title: `${label} ${selectedKeys.length} 行`,
        content: confirm,
        okText: label,
        okButtonProps: danger ? { danger: true } : undefined,
        cancelText: "取消",
        onOk: doRun,
      });
    } else {
      void doRun();
    }
  }

  const selectorCols = columns
    .map((c, i) => ({ key: colKey(c, i), title: (c as { title?: ReactNode }).title }))
    .filter((c) => c.title != null);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        {enableSelect && onBatchDelete && (
          <Button
            danger
            size="small"
            icon={<DeleteOutlined />}
            disabled={!selectedKeys.length}
            onClick={() =>
              runBatch("批量删除", true, batchDeleteConfirm, () => onBatchDelete(selectedKeys))
            }
          >
            批量删除{selectedKeys.length ? `（${selectedKeys.length}）` : ""}
          </Button>
        )}
        {enableSelect &&
          batchActions?.map((a) => (
            <Button
              key={a.label}
              danger={a.danger}
              size="small"
              icon={a.icon}
              disabled={!selectedKeys.length}
              onClick={() => runBatch(a.label, a.danger, a.confirm, () => a.onClick(selectedKeys))}
            >
              {a.label}
              {selectedKeys.length ? `（${selectedKeys.length}）` : ""}
            </Button>
          ))}
        {enableSelect && selectedKeys.length > 0 && (
          <span style={{ color: "#5B6478", fontSize: 12 }}>已选 {selectedKeys.length} 行</span>
        )}
        <div style={{ flex: 1 }} />
        {columnSelector && selectorCols.length > 1 && (
          <Popover
            trigger="click"
            placement="bottomRight"
            content={
              <div style={{ maxHeight: 300, overflow: "auto", minWidth: 160 }}>
                {selectorCols.map((c) => (
                  <div key={c.key} style={{ padding: "3px 0" }}>
                    <Checkbox checked={!hiddenCols.has(c.key)} onChange={(e) => toggleCol(c.key, e.target.checked)}>
                      {String(c.title)}
                    </Checkbox>
                  </div>
                ))}
              </div>
            }
          >
            <Tooltip title="自定义需要获取的字段（显示/隐藏列）">
              <Button size="small" icon={<SettingOutlined />}>列设置</Button>
            </Tooltip>
          </Popover>
        )}
      </div>
      <Table<T>
        rowKey={rowKey}
        columns={allCols}
        dataSource={dataSource}
        loading={loading}
        pagination={pagination}
        size={initSize}
        scroll={scroll}
        locale={locale}
        style={style}
        footer={footer}
        components={{ header: { cell: ResizableTitle } }}
        rowSelection={
          enableSelect
            ? {
                selectedRowKeys: selectedKeys,
                onChange: setSelectedKeys,
              }
            : undefined
        }
      />
    </div>
  );
}
