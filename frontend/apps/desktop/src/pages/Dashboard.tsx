import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Button, Card, Col, Row, Statistic, Tag } from "antd";

import { reportApi, type DashboardData } from "@wlt/shared";

const BAR_MAX = 100;

function TrendChart({ trend }: { trend: DashboardData["trend_7d"] }) {
  const max = Math.max(1, ...trend.map((t) => Math.max(Number(t.in_qty), Number(t.out_qty))));
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 12, height: 180, paddingTop: 8 }}>
      {trend.map((t) => {
        const inH = Math.round((Number(t.in_qty) / max) * BAR_MAX);
        const outH = Math.round((Number(t.out_qty) / max) * BAR_MAX);
        return (
          <div key={t.date} style={{ flex: 1, textAlign: "center" }}>
            <div style={{ display: "flex", justifyContent: "center", alignItems: "flex-end", gap: 3, height: BAR_MAX + 20 }}>
              <div title={`入库 ${t.in_qty}`} style={{ width: 14, height: `${inH}%`, background: "#1677ff", borderRadius: "3px 3px 0 0" }} />
              <div title={`出库 ${t.out_qty}`} style={{ width: 14, height: `${outH}%`, background: "#fa8c16", borderRadius: "3px 3px 0 0" }} />
            </div>
            <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>{t.date.slice(5)}</div>
            <div style={{ fontSize: 11, color: "#666" }}>{t.in_qty}/{t.out_qty}</div>
          </div>
        );
      })}
    </div>
  );
}

/** 经营看板（电脑端，管理者）：今日/本周/本月出入库、预警、待办、近 7 日趋势。 */
export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [err, setErr] = useState("");
  const navigate = useNavigate();

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

  const todos = data?.todos;
  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>统计面板</h2>
        <Button onClick={() => void load()}>刷新</Button>
      </div>
      {err && <p style={{ color: "#f5222d" }}>{err}</p>}
      {data && (
        <>
          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            <Col span={4}><Card size="small"><Statistic title="SKU 数（有库存）" value={data.sku_count} /></Card></Col>
            <Col span={4}><Card size="small"><Statistic title="库存总件数" value={Number(data.total_qty)} /></Card></Col>
            <Col span={4}><Card size="small"><Statistic title="今日入库" value={Number(data.today.in_qty)} suffix="件" /></Card></Col>
            <Col span={4}><Card size="small"><Statistic title="今日出库" value={Number(data.today.out_qty)} suffix="件" /></Card></Col>
            <Col span={4}><Card size="small"><Statistic title="本周入库/出库" value={`${data.week.in_qty}/${data.week.out_qty}`} /></Card></Col>
            <Col span={4}>
              <Card size="small" style={data.alert_count > 0 ? { borderColor: "#f5222d" } : undefined}>
                <Statistic title="库存预警" value={data.alert_count} styles={{ content: { color: data.alert_count > 0 ? "#f5222d" : undefined } }} />
              </Card>
            </Col>
          </Row>

          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            <Col span={8}>
              <Card size="small" title="待办事项">
                {todos && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <a onClick={() => navigate("/requisitions")} style={{ cursor: "pointer" }}>
                      待审计领用单 <Tag color={todos.pending_requisitions > 0 ? "red" : "default"}>{todos.pending_requisitions}</Tag>
                    </a>
                    <a onClick={() => navigate("/transfers")} style={{ cursor: "pointer" }}>
                      待审核调拨单 <Tag color={todos.pending_transfers > 0 ? "orange" : "default"}>{todos.pending_transfers}</Tag>
                    </a>
                    <a onClick={() => navigate("/checks")} style={{ cursor: "pointer" }}>
                      盘点进行中 <Tag color={todos.pending_checks > 0 ? "blue" : "default"}>{todos.pending_checks}</Tag>
                    </a>
                  </div>
                )}
              </Card>
            </Col>
            <Col span={16}>
              <Card size="small" title="近 7 日出入库趋势（蓝=入库 橙=出库）">
                <TrendChart trend={data.trend_7d} />
              </Card>
            </Col>
          </Row>
        </>
      )}
    </div>
  );
}
