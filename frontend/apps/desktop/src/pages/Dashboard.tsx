import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Alert, Button, Card, Col, Empty, Row, Skeleton, Statistic, Tag, Tooltip, theme } from "antd";
import { ReloadOutlined } from "@ant-design/icons";

import { reportApi, useAuthStore, type DashboardData } from "@wlt/shared";

const BAR_H = 140;

/** 近 7 日出入库趋势（双柱：入库蓝 / 出库绿，《UI设计方案.md》§4.2）。 */
function TrendChart({ trend }: { trend: DashboardData["trend_7d"] }) {
  const { token } = theme.useToken();
  if (trend.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无近 7 日出入库数据" />;
  }
  const max = Math.max(1, ...trend.map((t) => Math.max(Number(t.in_qty), Number(t.out_qty))));
  return (
    <div>
      <div style={{ display: "flex", gap: 16, marginBottom: 14, fontSize: 12, color: token.colorTextSecondary }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: token.colorPrimary }} />
          入库
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: token.colorSuccess }} />
          出库
        </span>
        <span style={{ marginLeft: "auto", color: token.colorTextTertiary }}>单位：件</span>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
        {trend.map((t) => {
          const inH = Math.round((Number(t.in_qty) / max) * BAR_H);
          const outH = Math.round((Number(t.out_qty) / max) * BAR_H);
          return (
            <div key={t.date} style={{ flex: 1, minWidth: 0, textAlign: "center" }}>
              <Tooltip title={`${t.date} 入库 ${t.in_qty} 件 / 出库 ${t.out_qty} 件`}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "flex-end",
                    gap: 4,
                    height: BAR_H + 12,
                    paddingTop: 12,
                    borderBottom: `1px solid ${token.colorBorderSecondary}`,
                    cursor: "default",
                  }}
                >
                  <div
                    style={{
                      width: 16,
                      height: inH,
                      minHeight: inH > 0 ? 2 : 0,
                      background: token.colorPrimary,
                      borderRadius: "4px 4px 0 0",
                      transition: "height 0.3s ease",
                    }}
                  />
                  <div
                    style={{
                      width: 16,
                      height: outH,
                      minHeight: outH > 0 ? 2 : 0,
                      background: token.colorSuccess,
                      borderRadius: "4px 4px 0 0",
                      transition: "height 0.3s ease",
                    }}
                  />
                </div>
              </Tooltip>
              <div style={{ fontSize: 11, color: token.colorTextSecondary, marginTop: 6 }}>{t.date.slice(5)}</div>
              <div style={{ fontSize: 11, color: token.colorTextTertiary, fontVariantNumeric: "tabular-nums" }}>
                {Number(t.in_qty)} / {Number(t.out_qty)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 6) return "夜深了";
  if (h < 11) return "早上好";
  if (h < 13) return "中午好";
  if (h < 18) return "下午好";
  return "晚上好";
}

/** 经营看板（电脑端，管理者）：欢迎条 + 4 统计卡 + 近 7 日趋势 + 待办与预警（《UI设计方案.md》§4.2）。 */
export function DashboardPage() {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const isSuper = user?.role?.code === "super_admin";
  const can = (perm: string) => isSuper || hasPerm(perm);

  const [data, setData] = useState<DashboardData | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await reportApi.dashboard());
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "加载失败");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>统计面板</h2>
        <Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
      </div>

      {err && (
        <Alert
          type="error"
          showIcon
          message="看板数据加载失败"
          description={err}
          action={<Button size="small" danger onClick={() => void load()}>重试</Button>}
          style={{ marginBottom: 16 }}
        />
      )}

      {!data && !err && (
        <Card size="small" style={{ marginBottom: 16 }}>
          <Skeleton active paragraph={{ rows: 2 }} />
        </Card>
      )}

      {data && (
        <>
          {/* 欢迎条 + 今日快捷入口（按权限显示） */}
          <Card style={{ marginBottom: 16 }} styles={{ body: { padding: "16px 20px" } }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>
                  {greeting()}，{user?.real_name ?? "同事"}
                </div>
                <div style={{ fontSize: 12.5, color: token.colorTextSecondary, marginTop: 4 }}>
                  {user?.role?.name ? `${user.role.name} · ` : ""}今日出入库与待办概览
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {can("pch:in") && <Button onClick={() => navigate("/purchase-in")}>新建采购入库</Button>}
                {can("req:audit") && <Button onClick={() => navigate("/requisitions")}>领用审计</Button>}
                {can("stk:check") && <Button onClick={() => navigate("/checks")}>新建盘点</Button>}
              </div>
            </div>
          </Card>

          {/* 4 张统计卡（可点击直达对应页面） */}
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col xs={12} md={6}>
              <Card size="small" hoverable onClick={() => navigate("/stock")}>
                <Statistic title="SKU 数（有库存）" value={data.sku_count} />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small" hoverable onClick={() => navigate("/stock")}>
                <Statistic title="库存总件数" value={Number(data.total_qty)} suffix="件" />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small" hoverable onClick={() => navigate("/purchase-in")}>
                <Statistic title="今日入库件数" value={Number(data.today.in_qty)} suffix="件" />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small" hoverable onClick={() => navigate("/stock")}>
                <Statistic title="今日出库件数" value={Number(data.today.out_qty)} suffix="件" />
              </Card>
            </Col>
          </Row>

          {/* 近 7 日趋势（16）+ 待办与预警（8） */}
          <Row gutter={[16, 16]}>
            <Col xs={24} lg={15}>
              <Card size="small" title="近 7 日出入库趋势">
                <TrendChart trend={data.trend_7d} />
              </Card>
            </Col>
            <Col xs={24} lg={9}>
              <Card size="small" title="待办与预警">
                {/* 预警 / 待审计小卡（点击直达） */}
                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                  <div
                    onClick={() => navigate("/stock")}
                    style={{
                      flex: 1,
                      padding: "10px 12px",
                      borderRadius: 8,
                      border: `1px solid ${data.alert_count > 0 ? token.colorErrorBorder : token.colorBorderSecondary}`,
                      background: data.alert_count > 0 ? token.colorErrorBg : token.colorBgContainer,
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontSize: 12, color: token.colorTextSecondary }}>库存预警</div>
                    <div
                      style={{
                        fontSize: 22,
                        fontWeight: 600,
                        lineHeight: 1.3,
                        fontVariantNumeric: "tabular-nums",
                        color: data.alert_count > 0 ? token.colorError : token.colorText,
                      }}
                    >
                      {data.alert_count}
                    </div>
                  </div>
                  <div
                    onClick={() => navigate("/requisitions")}
                    style={{
                      flex: 1,
                      padding: "10px 12px",
                      borderRadius: 8,
                      border: `1px solid ${data.todos.pending_requisitions > 0 ? token.colorWarningBorder : token.colorBorderSecondary}`,
                      background: data.todos.pending_requisitions > 0 ? token.colorWarningBg : token.colorBgContainer,
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontSize: 12, color: token.colorTextSecondary }}>待审计领用单</div>
                    <div
                      style={{
                        fontSize: 22,
                        fontWeight: 600,
                        lineHeight: 1.3,
                        fontVariantNumeric: "tabular-nums",
                        color: data.todos.pending_requisitions > 0 ? token.colorWarningText : token.colorText,
                      }}
                    >
                      {data.todos.pending_requisitions}
                    </div>
                  </div>
                </div>

                {/* 待办清单 */}
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {[
                    { label: "待审计领用单", count: data.todos.pending_requisitions, path: "/requisitions", color: "red" as const },
                    { label: "待审核调拨单", count: data.todos.pending_transfers, path: "/transfers", color: "orange" as const },
                    { label: "盘点进行中", count: data.todos.pending_checks, path: "/checks", color: "blue" as const },
                  ].map((item) => (
                    <a
                      key={item.path}
                      onClick={() => navigate(item.path)}
                      className="wlt-todo-row"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "9px 8px",
                        borderRadius: 6,
                        cursor: "pointer",
                        color: token.colorText,
                      }}
                    >
                      <span>{item.label}</span>
                      <Tag color={item.count > 0 ? item.color : "default"} style={{ marginInlineEnd: 0 }}>{item.count}</Tag>
                    </a>
                  ))}
                </div>
              </Card>
            </Col>
          </Row>
        </>
      )}
    </div>
  );
}
