import { useCallback, useEffect, useState } from "react";
import {
  App,
  Alert,
  Badge,
  Button,
  Descriptions,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { ReloadOutlined } from "@ant-design/icons";

import { moduleApi, type ModuleInfo, type ModuleRescanResult, type ModuleState } from "@wlt/shared";

const STATE_META: Record<ModuleState, { color: string; label: string }> = {
  NOT_INSTALLED: { color: "default", label: "未安装" },
  INSTALLING: { color: "processing", label: "安装中" },
  INSTALLED: { color: "cyan", label: "已安装(停用)" },
  ENABLED: { color: "success", label: "已启用" },
  DISABLED: { color: "warning", label: "已停用" },
  ERROR: { color: "error", label: "异常" },
  UPGRADING: { color: "processing", label: "升级中" },
};

/** 安装模块（系统管理，module:manage）：源码已部署模块的安装/启停/升级/卸载 + 源码重扫预检。 */
export function ModulesPage() {
  const { message, modal } = App.useApp();
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

  return (
    <div>
      <Space style={{ marginBottom: 12, justifyContent: "space-between", width: "100%" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          安装模块
        </Typography.Title>
        <Button icon={<ReloadOutlined />} onClick={rescan} loading={rescanning}>
          重新扫描模块源码
        </Button>
      </Space>
      <Alert
        style={{ marginBottom: 12 }}
        type="info"
        showIcon
        message="模块插件机制：源码存在 ≠ 已安装 ≠ 已启用。安装/启停由管理员触发；卸载不删除任何表与数据；升级后需重启后端进程加载新代码。"
      />
      <Table<ModuleInfo>
        rowKey="code"
        loading={loading}
        dataSource={rows}
        pagination={false}
        columns={[
          {
            title: "模块",
            dataIndex: "name",
            render: (_, m) => (
              <Space direction="vertical" size={0}>
                <Space>
                  <Typography.Text strong>{m.name}</Typography.Text>
                  <Tag>{m.code}</Tag>
                </Space>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {m.description || "—"}
                </Typography.Text>
              </Space>
            ),
          },
          {
            title: "版本",
            dataIndex: "version",
            width: 170,
            render: (_, m) => (
              <Space direction="vertical" size={0}>
                <Space size={4}>
                  <Tag color="blue">{m.version}</Tag>
                  {m.deployed && m.source_version && m.source_version !== m.version && (
                    <Tooltip title="源码已更新，可升级（升级后需重启后端）">
                      <Tag color="gold">可升级</Tag>
                    </Tooltip>
                  )}
                </Space>
                {!m.deployed && <Typography.Text type="secondary" style={{ fontSize: 12 }}>源码未部署</Typography.Text>}
              </Space>
            ),
          },
          {
            title: "状态",
            dataIndex: "state",
            width: 110,
            render: (_, m) => (
              <Tooltip title={m.state === "ERROR" ? m.last_error : undefined}>
                <Badge status={m.state === "ERROR" ? "error" : m.state === "ENABLED" ? "success" : "default"} text={STATE_META[m.state]?.label ?? m.state} />
              </Tooltip>
            ),
          },
          {
            title: "依赖",
            dataIndex: "depends",
            width: 130,
            render: (deps: string[]) =>
              deps?.length ? <Space size={4}>{deps.map((d) => <Tag key={d}>{d}</Tag>)}</Space> : <Typography.Text type="secondary">无</Typography.Text>,
          },
          { title: "菜单", dataIndex: "menu_count", width: 60, align: "center" },
          { title: "权限点", dataIndex: "perm_count", width: 70, align: "center" },
          { title: "SQL 版本", dataIndex: "schema_version", width: 90, align: "center" },
          {
            title: "checksum",
            dataIndex: "source_checksum_prefix",
            width: 110,
            render: (v: string, m) => (
              <Tooltip title={m.source_checksum || "无"}>
                <Typography.Text code style={{ fontSize: 12 }}>{v || "—"}</Typography.Text>
              </Tooltip>
            ),
          },
          {
            title: "安装时间",
            dataIndex: "installed_at",
            width: 160,
            render: (v: string | null) => (v ? new Date(v).toLocaleString() : "—"),
          },
          {
            title: "操作",
            key: "action",
            width: 300,
            render: (_, m) => (
              <Space wrap size={4}>
                {canInstall(m) && (
                  <Button size="small" type="primary" loading={acting === `install:${m.code}`} onClick={() => act(m, "install")}>
                    安装
                  </Button>
                )}
                {canEnable(m) && (
                  <Button size="small" loading={acting === `enable:${m.code}`} onClick={() => act(m, "enable")}>
                    启用
                  </Button>
                )}
                {canDisable(m) && (
                  <Popconfirm title="停用后模块接口 403、菜单隐藏，数据保留" onConfirm={() => act(m, "disable")}>
                    <Button size="small" loading={acting === `disable:${m.code}`}>停用</Button>
                  </Popconfirm>
                )}
                {canUpgrade(m) && (
                  <Popconfirm title={`升级到 ${m.source_version ?? m.version}？应用新迁移后需重启后端`} onConfirm={() => act(m, "upgrade")}>
                    <Button size="small" loading={acting === `upgrade:${m.code}`}>升级</Button>
                  </Popconfirm>
                )}
                {canUninstall(m) && (
                  <Popconfirm
                    title="确认卸载该模块？"
                    description="⚠ 不删除任何表与数据，可重装幂等续用"
                    onConfirm={() => act(m, "uninstall")}
                  >
                    <Button size="small" danger loading={acting === `uninstall:${m.code}`}>卸载</Button>
                  </Popconfirm>
                )}
                <Button size="small" type="link" onClick={() => setDetail(m)}>详情</Button>
              </Space>
            ),
          },
        ]}
      />

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
