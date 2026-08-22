/** 模块插件管理接口（系统管理「安装模块」，线缆和设备插件方案 §2.4 / §6.1）。 */

import { http } from "./client";

export type ModuleState =
  | "NOT_INSTALLED"
  | "INSTALLING"
  | "INSTALLED"
  | "ENABLED"
  | "DISABLED"
  | "ERROR"
  | "UPGRADING";

export interface ModuleInfo {
  id: number;
  code: string;
  name: string;
  version: string; // 库中版本（升级后更新）
  state: ModuleState;
  schema_version: string;
  depends: string[];
  description: string;
  last_error: string;
  last_error_at: string | null;
  installed_at: string | null;
  /** 源码侧信息（build_modules.py manifest/ModuleDef） */
  deployed: boolean;
  source_version: string | null;
  source_checksum: string;
  source_checksum_prefix: string;
  build_id: string;
  source_commit: string;
  menu_count: number;
  perm_count: number;
  config: Record<string, unknown> | null;
  need_restart?: boolean;
}

/** 重新扫描预检结果（build_modules.py --check-only）。 */
export interface ModuleRescanResult {
  modules?: { code: string; source_version: string; schema_version: string; deployed: boolean; runtime_version: string }[];
  new_modules?: string[];
  version_changes?: { code: string; from: string; to: string }[];
  checksum_drift?: { code: string; from: string; to: string }[];
  removed_from_source?: string[];
  raw?: string;
}

export const moduleApi = {
  list: () => http.get<ModuleInfo[]>("/modules"),
  detail: (code: string) => http.get<ModuleInfo>(`/modules/${code}`),
  install: (code: string) => http.post<ModuleInfo>(`/modules/${code}/install`),
  enable: (code: string) => http.post<ModuleInfo>(`/modules/${code}/enable`),
  disable: (code: string) => http.post<ModuleInfo>(`/modules/${code}/disable`),
  upgrade: (code: string) => http.post<ModuleInfo & { need_restart?: boolean }>(`/modules/${code}/upgrade`),
  uninstall: (code: string) => http.post<ModuleInfo>(`/modules/${code}/uninstall`),
  /** 「重新扫描模块源码」：只读预检（不改数据库），返回新模块/版本变化/代码漂移。 */
  rescan: () => http.post<ModuleRescanResult>("/modules/rescan"),
};
