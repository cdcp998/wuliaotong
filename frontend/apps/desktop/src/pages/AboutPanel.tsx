import { useEffect, useState } from "react";
import { Button, Tag } from "antd";
import { GithubOutlined, LinkOutlined, SafetyCertificateOutlined } from "@ant-design/icons";

import { systemApi } from "@wlt/shared";

/** 本项目开源仓库（「关于」页入口）。 */
const PROJECT_REPO = "https://github.com/cdcp998/wuliaotong";

/** 开源组件清单（与 backend/requirements.txt、frontend 各 package.json 实际依赖对齐）。 */
interface OssItem {
  name: string;
  site: string;          // 项目主页/仓库
  usage: string;         // 在本系统中的用途
  version: string;       // 依赖声明版本
  license: string;       // 许可证类型
  licenseUrl: string;    // 完整许可证文本
}

const MIT = { license: "MIT", licenseUrl: "https://opensource.org/licenses/MIT" };
const BSD3 = { license: "BSD-3-Clause", licenseUrl: "https://opensource.org/licenses/BSD-3-Clause" };
const APACHE2 = {
  license: "Apache-2.0",
  licenseUrl: "https://www.apache.org/licenses/LICENSE-2.0",
};

const OSS_LIST: OssItem[] = [
  // —— 前端 ——
  { name: "React", site: "https://react.dev", usage: "前端 UI 框架", version: "19.x", ...MIT },
  { name: "Ant Design", site: "https://ant.design", usage: "企业级组件库", version: "6.x", ...MIT },
  { name: "@ant-design/icons", site: "https://ant.design/components/icons", usage: "图标库", version: "6.x", ...MIT },
  { name: "React Router", site: "https://reactrouter.com", usage: "路由管理", version: "8.x", ...MIT },
  { name: "Leaflet", site: "https://leafletjs.com", usage: "地图渲染引擎", version: "1.9", license: "BSD-2-Clause", licenseUrl: "https://opensource.org/licenses/BSD-2-Clause" },
  { name: "React Leaflet", site: "https://react-leaflet.js.org", usage: "Leaflet React 绑定", version: "5.x", ...MIT },
  { name: "Day.js", site: "https://day.js.org", usage: "日期时间处理", version: "1.x", ...MIT },
  { name: "Vite", site: "https://vite.dev", usage: "构建工具", version: "6.x", ...MIT },
  // —— 后端 ——
  { name: "FastAPI", site: "https://fastapi.tiangolo.com", usage: "Web 框架", version: "0.115+", ...MIT },
  { name: "Uvicorn", site: "https://www.uvicorn.org", usage: "ASGI 服务器", version: "0.30+", ...BSD3 },
  { name: "SQLAlchemy", site: "https://www.sqlalchemy.org", usage: "ORM / 数据库访问", version: "2.0", ...MIT },
  { name: "PyMySQL", site: "https://pymysql.readthedocs.io", usage: "MySQL 驱动", version: "1.1+", ...MIT },
  { name: "redis-py", site: "https://redis-py.readthedocs.io", usage: "Redis 缓存客户端", version: "5.0+", ...MIT },
  { name: "APScheduler", site: "https://apscheduler.readthedocs.io", usage: "定时任务调度", version: "3.x", ...MIT },
  { name: "Pydantic", site: "https://docs.pydantic.dev", usage: "数据校验（FastAPI 内置依赖）", version: "2.x", ...MIT },
  { name: "bcrypt", site: "https://github.com/pyca/bcrypt", usage: "密码哈希", version: "4.1+", ...APACHE2 },
  { name: "cryptography", site: "https://cryptography.io", usage: "密钥加密存储", version: "42+", ...APACHE2 },
  { name: "openpyxl", site: "https://openpyxl.readthedocs.io", usage: "Excel 导入导出", version: "3.1+", ...MIT },
  { name: "Pillow", site: "https://python-pillow.org", usage: "图片处理（水印/照片）", version: "10+", license: "MIT-CMU (HPND)", licenseUrl: "https://opensource.org/license/mit-cmu" },
  { name: "python-dotenv", site: "https://saurabh-kumar.com/python-dotenv/", usage: ".env 配置加载", version: "1.0+", ...BSD3 },
  { name: "psutil", site: "https://psutil.readthedocs.io", usage: "系统资源监控", version: "6.x", ...BSD3 },
  { name: "httpx", site: "https://www.python-httpx.org", usage: "HTTP 客户端（LLM 调用等）", version: "0.27+", ...BSD3 },
  { name: "python-multipart", site: "https://github.com/Kludex/python-multipart/", usage: "文件上传解析", version: "0.0.x", ...APACHE2 },
  { name: "ZXing-C++", site: "https://github.com/zxing-cpp/zxing-cpp", usage: "条码识别", version: "2.0+", ...APACHE2 },
  { name: "PaddlePaddle", site: "https://www.paddlepaddle.org.cn", usage: "深度学习框架（OCR 底座）", version: "3.2.2", ...APACHE2 },
  { name: "PaddleOCR", site: "https://github.com/PaddlePaddle/PaddleOCR", usage: "送货单 OCR 识别", version: "3.x", ...APACHE2 },
];

const LICENSE_TEXT_URLS: Record<string, string> = {
  MIT: "https://opensource.org/licenses/MIT",
  "BSD-2-Clause": "https://opensource.org/licenses/BSD-2-Clause",
  "BSD-3-Clause": "https://opensource.org/licenses/BSD-3-Clause",
  "Apache-2.0": "https://www.apache.org/licenses/LICENSE-2.0",
  "MIT-CMU (HPND)": "https://opensource.org/license/mit-cmu",
};

/** 「关于」面板（系统设置 · 设计语言同 OP：#F2F5FB 分区底 + 白卡 r16 柔投影）。
 *
 * 版本信息：系统版本号（唯一源 backend/app/__init__.py __version__，经 Vite 注入）、
 * 构建号（git 短哈希）、发布日期（当前版本最后提交日）；服务端版本与数据库/Redis
 * 状态实时取自 GET /health。
 */
export function AboutPanel() {
  const [server, setServer] = useState<{ version: string; db: string; redis: string } | null>(null);
  const [serverDown, setServerDown] = useState(false);

  useEffect(() => {
    systemApi
      .serverHealth()
      .then((h) => setServer({ version: h.version, db: h.db, redis: h.redis }))
      .catch(() => setServerDown(true));
  }, []);

  const isDevBuild = __BUILD_INFO__.hash === "dev";

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
      {/* 分区一：版本信息 */}
      <div style={{ background: "#fff", border: "1px solid #EFF3FC", borderRadius: 16, padding: "20px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 52, height: 52, borderRadius: 15, flexShrink: 0,
              background: "linear-gradient(135deg,#5B7FFF,#7C93FF)", color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 24, fontWeight: 700, boxShadow: "0 6px 18px rgba(91,127,255,.35)",
            }}
          >
            物
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 20, fontWeight: 700, color: "#1E2433" }}>物料通管理系统</span>
              <Tag style={{ borderRadius: 999, background: "#EAEFFF", color: "#3B5BDB", borderColor: "transparent", fontWeight: 600 }}>v{__APP_VERSION__}</Tag>
              {isDevBuild && (
                <Tag style={{ borderRadius: 999, background: "#FEF4E2", color: "#B45309", borderColor: "transparent" }}>开发版</Tag>
              )}
            </div>
            <div style={{ fontSize: 12, color: "#8A93A8", marginTop: 3 }}>企业物资数字化底座：库存 · 领用 · 线缆地图 · 维修 · 知识库</div>
          </div>
          <Button
            icon={<GithubOutlined />}
            href={PROJECT_REPO}
            target="_blank"
            style={{ borderColor: "#CBD6EC", color: "#1E2433", flexShrink: 0 }}
          >
            开源仓库
          </Button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginTop: 16 }}>
          {[
            { label: "系统版本号", value: `v${__APP_VERSION__}`, color: "#5B7FFF" },
            {
              label: "构建号",
              value: isDevBuild ? "开发构建" : `git-${__BUILD_INFO__.hash}`,
              color: "#1E2433",
              mono: true,
            },
            { label: "发布日期", value: __BUILD_INFO__.released || "—", color: "#15803D" },
            {
              label: "服务端版本",
              value: server ? `v${server.version}` : serverDown ? "不可用" : "获取中…",
              color: serverDown ? "#DC2626" : "#3B5BDB",
            },
          ].map((it) => (
            <div key={it.label} style={{ background: "#F6F8FE", borderRadius: 12, padding: "10px 14px" }}>
              <div style={{ fontSize: 11.5, color: "#8A93A8" }}>{it.label}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: it.color, fontVariantNumeric: "tabular-nums", fontFamily: it.mono ? "ui-monospace, SFMono-Regular, Consolas, monospace" : undefined, marginTop: 2 }}>{it.value}</div>
            </div>
          ))}
        </div>

        {/* 运行环境状态 */}
        {server && (
          <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
            {[
              { k: "数据库", ok: server.db === "ok" },
              { k: "Redis 缓存", ok: server.redis === "ok" },
            ].map((s) => (
              <span key={s.k} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, padding: "3px 12px", borderRadius: 999, background: s.ok ? "#E8F9EF" : "#FDEBEC", color: s.ok ? "#15803D" : "#DC2626" }}>
                <span style={{ width: 6, height: 6, borderRadius: 3, background: "currentColor" }} />
                {s.k} {s.ok ? "运行正常" : "未连接"}
              </span>
            ))}
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, padding: "3px 12px", borderRadius: 999, background: "#F6F8FE", color: "#5B6478" }}>
              构建时间 {__BUILD_INFO__.builtAt}
            </span>
          </div>
        )}
      </div>

      {/* 分区二：开源信息 */}
      <div style={{ background: "#fff", border: "1px solid #EFF3FC", borderRadius: 16, padding: "20px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <SafetyCertificateOutlined style={{ color: "#5B7FFF", fontSize: 16 }} />
          <span style={{ fontSize: 15, fontWeight: 700, color: "#1E2433" }}>开源信息</span>
        </div>
        <div style={{ fontSize: 12, color: "#8A93A8", marginBottom: 12 }}>
          本系统基于以下优秀开源组件构建。各组件版权归其原作者所有；点击「许可证」可查看完整许可证文本。
        </div>
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 12.5 }}>
          <thead>
            <tr>
              {["组件", "用途", "版本", "许可证"].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "8px 10px", background: "#F6F8FE", color: "#5B6478", fontWeight: 600, borderTop: "1px solid #EFF3FC", borderBottom: "1px solid #EFF3FC", position: "sticky", top: 0 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {OSS_LIST.map((o, i) => (
              <tr key={o.name} style={{ background: i % 2 ? "#FBFCFF" : undefined }}>
                <td style={{ padding: "7px 10px", borderBottom: "1px solid #F3F6FD" }}>
                  <a href={o.site} target="_blank" rel="noreferrer" style={{ color: "#3B5BDB", fontWeight: 600, textDecoration: "none" }}>
                    {o.name} <LinkOutlined style={{ fontSize: 10 }} />
                  </a>
                </td>
                <td style={{ padding: "7px 10px", borderBottom: "1px solid #F3F6FD", color: "#5B6478" }}>{o.usage}</td>
                <td style={{ padding: "7px 10px", borderBottom: "1px solid #F3F6FD", color: "#5B6478", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{o.version}</td>
                <td style={{ padding: "7px 10px", borderBottom: "1px solid #F3F6FD", whiteSpace: "nowrap" }}>
                  <a href={LICENSE_TEXT_URLS[o.license] ?? o.licenseUrl} target="_blank" rel="noreferrer" style={{ color: "#5B7FFF" }}>
                    {o.license}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 版权与致谢 */}
      <div style={{ textAlign: "center", fontSize: 11.5, color: "#8A93A8", lineHeight: 1.9, paddingBottom: 8 }}>
        <GithubOutlined style={{ marginRight: 6 }} />
        版权所有 © 2026 物料通管理系统 · 开源地址{" "}
        <a href={PROJECT_REPO} target="_blank" rel="noreferrer" style={{ color: "#5B7FFF" }}>
          github.com/cdcp998/wuliaotong
        </a>
        {" "}· 基于 {OSS_LIST.length} 个开源组件构建，感谢开源社区的贡献
        <br />
        本软件按「现状」提供，不含任何明示或默示担保；各开源组件之著作权归其各自原作者所有，
        详细条款以各组件随源码分发的许可证文本为准。
      </div>
    </div>
  );
}
