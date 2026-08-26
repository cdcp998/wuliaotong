import { useCallback, useEffect, useState } from "react";
import {
  App,
  Alert,
  Button,
  Descriptions,
  Modal,
  Popconfirm,
  Space,
  Tag,
  Tooltip,
  Typography,
  theme,
} from "antd";
import { ReloadOutlined } from "@ant-design/icons";

import { moduleApi, type ModuleInfo, type ModuleRescanResult, type ModuleState } from "@wlt/shared";

const STATE_META: Record<ModuleState, { color: string; label: string; fg?: string; bg?: string }> = {
  NOT_INSTALLED: { color: "default", label: "未安装", fg: "#5B6478", bg: "#EFF3FC" },
  INSTALLING: { color: "processing", label: "安装中", fg: "#0E7490", bg: "#E0F2FE" },
  INSTALLED: { color: "cyan", label: "已安装(停用)", fg: "#0E7490", bg: "#E0F2FE" },
  ENABLED: { color: "success", label: "已启用", fg: "#15803D", bg: "#E8F9EF" },
  DISABLED: { color: "warning", label: "已停用", fg: "#B45309", bg: "#FEF4E2" },
  ERROR: { color: "error", label: "异常", fg: "#B91C1C", bg: "#FDEBEC" },
  UPGRADING: { color: "processing", label: "升级中", fg: "#0E7490", bg: "#E0F2FE" },
};

/** 安装模块（系统管理，module:manage）：源码已部署模块的安装/启停/升级/卸载 + 源码重扫预检。
 * 设计页 32：模块卡片墙（浅色玻璃卡片 + 状态胶囊 + 依赖链标注），.wlt-grid 响应式（桌面多列→平板减列→手机单列）。 */
export function ModulesPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { message, modal } = App.useApp();
  const { token } = theme.useToken();
  const [rows, setRows] = useState<ModuleInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState<string>("");
  const [rescanned, setRescanned] = useState<ModuleRescanResult | null>(null);
  const [rescanOpen, setRescanOpen] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [detail, setDetail] = useState<ModuleInfo | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await moduleApi.list());
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载模块列表失败");
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (m: ModuleInfo, action: "install" | "enable" | "disable" | "upgrade" | "uninstall") => {
    setActing(`${action}:${m.code}`);
    try {
      const resp = await moduleApi[action](m.code);
      message.success(
        action === "upgrade"
          ? "升级完成：请重启后端进程使新代码生效（界面与接口变更需重启后可见）"
          : "操作成功"
      );
      if (action === "upgrade" && resp.need_restart) {
        modal.warning({
          title: "模块已升级",
          content: "按插件方案约定：模块代码变更需重启后端进程后加载。请重启后端（管理界面已强制提示）。",
        });
      }
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "操作失败");
      await load(); // 失败也可能改状态（如依赖不满足 → ERROR），刷新展示 last_error
    } finally {
      setActing("");
    }
  };

  const rescan = async () => {
    setRescanning(true);
    try {
      const r = await moduleApi.rescan();
      setRescanned(r);
      setRescanOpen(true);
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "扫描失败");
    } finally {
      setRescanning(false);
    }
  };

  const canInstall = (m: ModuleInfo) => ["NOT_INSTALLED", "INSTALLED", "DISABLED", "ERROR"].includes(m.state) && !acting;
  const canEnable = (m: ModuleInfo) => ["INSTALLED", "DISABLED", "ERROR"].includes(m.state) && !acting;
  const canDisable = (m: ModuleInfo) => m.state === "ENABLED" && !acting;
  const canUpgrade = (m: ModuleInfo) =>
    m.deployed &&
    ["INSTALLED", "DISABLED", "ENABLED", "ERROR"].includes(m.state) &&
    (!m.source_version || m.source_version !== m.version);
  const canUninstall = (m: ModuleInfo) => ["INSTALLED", "DISABLED", "ERROR"].includes(m.state) && !acting;

  function renderStatePill(m: ModuleInfo) {
    const meta = STATE_META[m.state] ?? { color: "default", label: m.state, fg: "#5B6478", bg: "#EFF3FC" };
    return (
      <Tooltip title={m.state === "ERROR" ? m.last_error : undefined}>
        <span className="wlt-pill" style={{ background: meta.bg, color: meta.fg }}>{meta.label}</span>
      </Tooltip>
    );
  }

  return (
    <div style={{ padding: embedded ? 0 : 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        {!embedded && (
          <div>
            <h2 style={{ margin: 0 }}>安装模块</h2>
            <p style={{ margin: "6px 0 0", fontSize: 12.5, color: token.colorTextSecondary }}>
              模块插件机制：源码存在 ≠ 已安装 ≠ 已启用。安装/启停由管理员触发；卸载不删除任何表与数据；升级后需重启后端进程加载新代码。
            </p>
          </div>
        )}
        <Button icon={<ReloadOutlined />} onClick={rescan} loading={rescanning}>
          重新扫描模块源码
        </Button>
      </div>

      <Alert
        style={{ marginBottom: 16 }}
        type="info"
        showIcon
        title="模块卡片墙：上方为模块状态胶囊（已启用/已停用/未安装/异常），依赖不满足时启用会被拒（4002）；「可升级」标注源码已更新。"
      />

      <div className="wlt-grid" style={{ gap: 14 }}>
        {loading && !rows.length && (
          <div className="wlt-glass" style={{ padding: 40, textAlign: "center", color: token.colorTextTertiary }}>加载模块中…</div>
        )}
        {!loading && rows.length === 0 && (
          <div className="wlt-glass" style={{ padding: 40, textAlign: "center", color: token.colorTextTertiary }}>暂无已部署模块，点击「重新扫描模块源码」预检</div>
        )}
        {rows.map((m) => {
          const installing = acting === `install:${m.code}`;
          const enabling = acting === `enable:${m.code}`;
          const disabling = acting === `disable:${m.code}`;
          const upgrading = acting === `upgrade:${m.code}`;
          const uninstalling = acting === `uninstall:${m.code}`;
          return (
            <div key={m.code} className="wlt-glass" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
              {/* 头部：名称 + 编码 + 状态胶囊 */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{m.name}</span>
                <Tag style={{ marginInlineEnd: 0, borderRadius: 6 }}>{m.code}</Tag>
                <span style={{ marginLeft: "auto" }}>{renderStatePill(m)}</span>
              </div>
              <div style={{ fontSize: 12.5, color: token.colorTextSecondary, lineHeight: 1.6, minHeight: 38 }}>{m.description || "—"}</div>

              {/* 版本 / 依赖 */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <Space size={4}>
                  <Tag color="blue" style={{ marginInlineEnd: 0 }}>v{m.version}</Tag>
                  {m.deployed && m.source_version && m.source_version !== m.version && (
                    <Tooltip title="源码已更新，可升级（升级后需重启后端）">
                      <Tag color="gold" style={{ marginInlineEnd: 0 }}>可升级</Tag>
                    </Tooltip>
                  )}
                  {!m.deployed && <Tag style={{ marginInlineEnd: 0 }}>源码未部署</Tag>}
                </Space>
                <span style={{ fontSize: 11, color: token.colorTextTertiary }}>
                  依赖：{m.depends?.length ? m.depends.map((d) => <Tag key={d} style={{ marginInlineEnd: 4 }}>{d}</Tag>) : "无"}
                </span>
              </div>

              {/* 元信息 */}
              <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", fontSize: 11.5, color: token.colorTextSecondary, padding: "8px 10px", background: "#F8FAFF", borderRadius: 12 }}>
                <span>菜单 {m.menu_count}</span>
                <span>权限点 {m.perm_count}</span>
                <span>SQL v{m.schema_version}</span>
                <Tooltip title={m.source_checksum || "无"}>
                  <span style={{ fontFamily: "monospace" }}>checksum {m.source_checksum_prefix || "—"}</span>
                </Tooltip>
                <span>装于 {m.installed_at ? new Date(m.installed_at).toLocaleString() : "—"}</span>
              </div>

              {/* 操作区 */}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", borderTop: `1px solid ${token.colorBorderSecondary}`, paddingTop: 10 }}>
                {canInstall(m) && (
                  <Button size="small" type="primary" loading={installing} onClick={() => act(m, "install")}>安装</Button>
                )}
                {canEnable(m) && (
                  <Button size="small" loading={enabling} onClick={() => act(m, "enable")}>启用</Button>
                )}
                {canDisable(m) && (
                  <Popconfirm title="停用后模块接口 403、菜单隐藏，数据保留" onConfirm={() => act(m, "disable")}>
                    <Button size="small" loading={disabling}>停用</Button>
                  </Popconfirm>
                )}
                {canUpgrade(m) && (
                  <Popconfirm title={`升级到 ${m.source_version ?? m.version}？应用新迁移后需重启后端`} onConfirm={() => act(m, "upgrade")}>
                    <Button size="small" loading={upgrading}>升级</Button>
                  </Popconfirm>
                )}
                {canUninstall(m) && (
                  <Popconfirm
                    title="确认卸载该模块？"
                    description="⚠ 不删除任何表与数据，可重装幂等续用"
                    onConfirm={() => act(m, "uninstall")}
                  >
                    <Button size="small" danger loading={uninstalling}>卸载</Button>
                  </Popconfirm>
                )}
                <Button size="small" type="link" style={{ marginLeft: "auto" }} onClick={() => setDetail(m)}>详情</Button>
              </div>
            </div>
          );
        })}
      </div>

      {/* 重扫预检结果 */}
      <Modal
        open={rescanOpen}
        onCancel={() => setRescanOpen(false)}
        onOk={() => setRescanOpen(false)}
        title="模块源码扫描结果（只读预检，未修改数据库）"
        width={640}
      >
        {rescanned && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="新模块（可安装）">
              {rescanned.new_modules?.length ? rescanned.new_modules.join("、") : "无"}
            </Descriptions.Item>
            <Descriptions.Item label="版本变化（可升级）">
              {rescanned.version_changes?.length
                ? rescanned.version_changes.map((v) => `${v.code}（${v.from} → ${v.to}）`).join("、")
                : "无"}
            </Descriptions.Item>
            <Descriptions.Item label="代码校验漂移">
              {rescanned.checksum_drift?.length
                ? rescanned.checksum_drift.map((v) => `${v.code}（${v.from}… → ${v.to}…）`).join("、")
                : "无"}
            </Descriptions.Item>
            <Descriptions.Item label="源码已移除">
              {rescanned.removed_from_source?.length ? rescanned.removed_from_source.join("、") : "无"}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>

      {/* 详情 */}
      <Modal open={!!detail} onCancel={() => setDetail(null)} footer={null} title={`模块详情：${detail?.name ?? ""}`} width={560}>
        {detail && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="编码">{detail.code}</Descriptions.Item>
            <Descriptions.Item label="名称">{detail.name}</Descriptions.Item>
            <Descriptions.Item label="版本（库/源码）">
              {detail.version} / {detail.source_version ?? "—"}
            </Descriptions.Item>
            <Descriptions.Item label="状态">
              <Tag color={STATE_META[detail.state]?.color}>{STATE_META[detail.state]?.label ?? detail.state}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="SQL 结构版本">{detail.schema_version}</Descriptions.Item>
            <Descriptions.Item label="依赖">{detail.depends?.join("、") || "无"}</Descriptions.Item>
            <Descriptions.Item label="菜单数 / 权限点数">
              {detail.menu_count} / {detail.perm_count}
            </Descriptions.Item>
            <Descriptions.Item label="源码 checksum">
              <Typography.Text code style={{ fontSize: 12 }}>{detail.source_checksum || "—"}</Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label="build_id / commit">
              {detail.build_id || "—"} / {detail.source_commit || "—"}
            </Descriptions.Item>
            {detail.last_error && (
              <Descriptions.Item label="最近异常">
                <Typography.Text type="danger">{detail.last_error}</Typography.Text>
              </Descriptions.Item>
            )}
            <Descriptions.Item label="安装时间">
              {detail.installed_at ? new Date(detail.installed_at).toLocaleString() : "—"}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
    </div>
  );
}
