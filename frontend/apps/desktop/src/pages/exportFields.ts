/** 导出字段定义（与后端导出表头一一对应，供 ExportFormatModal 选择列/设置格式）。
 *
 * 各模块共用此单一来源，保证「导出格式设置」界面与实际导出列始终一致。
 */
import type { ExportField } from "../components/ExportFormatModal";

/** 库存查询 / 库存报表（后端 /reports/export?type=stock 表头）。 */
export const STOCK_FIELDS: ExportField[] = [
  { key: 0, label: "商品编码", hint: "text" },
  { key: 1, label: "商品名称" },
  { key: 2, label: "规格" },
  { key: 3, label: "仓库" },
  { key: 4, label: "数量", hint: "number" },
  { key: 5, label: "成本价", hint: "number" },
  { key: 6, label: "金额", hint: "number" },
  { key: 7, label: "30天出库", hint: "number" },
  { key: 8, label: "最近变动" },
  { key: 9, label: "呆滞天数", hint: "number" },
];

/** 库存流水导出（后端 /reports/export?type=flow 表头）。 */
export const FLOW_FIELDS: ExportField[] = [
  { key: 0, label: "时间" },
  { key: 1, label: "商品编码", hint: "text" },
  { key: 2, label: "商品名称" },
  { key: 3, label: "仓库" },
  { key: 4, label: "库位" },
  { key: 5, label: "类型" },
  { key: 6, label: "单据号", hint: "text" },
  { key: 7, label: "变动前", hint: "number" },
  { key: 8, label: "变动数量", hint: "number" },
  { key: 9, label: "变动后", hint: "number" },
  { key: 10, label: "成本价", hint: "number" },
  { key: 11, label: "备注" },
];

/** 操作日志（后端 /logs/export 表头，含变更对比列）。 */
export const LOGS_FIELDS: ExportField[] = [
  { key: 0, label: "时间" },
  { key: 1, label: "操作人" },
  { key: 2, label: "模块" },
  { key: 3, label: "动作" },
  { key: 4, label: "方法" },
  { key: 5, label: "URL" },
  { key: 6, label: "查询参数" },
  { key: 7, label: "提交内容" },
  { key: 8, label: "变更对比" },
  { key: 9, label: "IP" },
  { key: 10, label: "耗时(ms)", hint: "number" },
  { key: 11, label: "状态码", hint: "number" },
];

/** 盘点导出（后端 /checks/{id}/export 收发存模板 21 列表头）。 */
export const CHECK_FIELDS: ExportField[] = [
  { key: 0, label: "年月" },
  { key: 1, label: "仓库名称" },
  { key: 2, label: "物料分类编码", hint: "text" },
  { key: 3, label: "物料分类名称" },
  { key: 4, label: "物料编码", hint: "text" },
  { key: 5, label: "物料名称" },
  { key: 6, label: "规格型号" },
  { key: 7, label: "计量单位" },
  { key: 8, label: "月度期初数量", hint: "number" },
  { key: 9, label: "月度期初金额", hint: "number" },
  { key: 10, label: "月度入库数量", hint: "number" },
  { key: 11, label: "月度入库金额", hint: "number" },
  { key: 12, label: "月度出库数量", hint: "number" },
  { key: 13, label: "月度出库金额", hint: "number" },
  { key: 14, label: "月度结存数量", hint: "number" },
  { key: 15, label: "月度结存金额", hint: "number" },
  { key: 16, label: "账面数量", hint: "number" },
  { key: 17, label: "实盘数量", hint: "number" },
  { key: 18, label: "盘盈盘亏数量", hint: "number" },
  { key: 19, label: "盘盈盘亏金额", hint: "number" },
  { key: 20, label: "备注" },
];

/** 历史价格（后端 /purchase-in/history-price/export 表头）。 */
export const HISTORY_PRICE_FIELDS: ExportField[] = [
  { key: 0, label: "入库日期" },
  { key: 1, label: "单据号", hint: "text" },
  { key: 2, label: "材料编码", hint: "text" },
  { key: 3, label: "材料名称" },
  { key: 4, label: "规格" },
  { key: 5, label: "单位" },
  { key: 6, label: "供应商" },
  { key: 7, label: "单价", hint: "number" },
  { key: 8, label: "数量", hint: "number" },
  { key: 9, label: "金额", hint: "number" },
  { key: 10, label: "涨跌" },
];
