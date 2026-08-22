/** 导航管理（动态菜单）接口：当前用户可见菜单树 + 管理员全量 CRUD。 */
import { http } from "./client";

export interface MenuNode {
  id: number;
  parent_id: number;
  name: string;
  path: string;
  icon: string;
  perm_code: string;
  visible: number;
  sort: number;
  remark?: string;
  children?: MenuNode[];
}

export interface MenuInput {
  parent_id: number;
  name: string;
  path?: string;
  icon?: string;
  perm_code?: string;
  visible?: number;
  sort?: number;
  remark?: string;
}

export const menuApi = {
  /** 当前用户可见菜单树（动态导航渲染）。 */
  menus: () => http.get<MenuNode[]>("/menus"),
  /** 全量菜单树（导航管理页，含隐藏项）。 */
  menusAll: () => http.get<MenuNode[]>("/menus/all"),
  create: (body: MenuInput) => http.post<MenuNode>("/menus", body),
  update: (id: number, body: MenuInput) => http.put<null>(`/menus/${id}`, body),
  remove: (id: number) => http.delete<null>(`/menus/${id}`),
};
