/** map 模块前端 API（移动端：瓦片代理 URL）。 */
export const mapApi = {
  /** 瓦片代理 URL（经后端缓存；Session Cookie 同源携带）。 */
  tileUrl: (source: string, z: number | string, x: number | string, y: number | string) =>
    `${import.meta.env?.VITE_API_BASE ?? "/api/v1"}/map/tile/${source}/${z}/${x}/${y}`,
};
