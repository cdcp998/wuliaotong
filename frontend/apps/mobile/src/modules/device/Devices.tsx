/** 手机端：设备（方案 §7.3）——设备定位/状态。 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { List, NavBar, Tag, Toast } from "antd-mobile";

import { ModuleGate } from "../../components/ModuleGate";
import { DEVICE_STATUS, deviceApi, type DeviceItem } from "../api";

export function MobileDevicesPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<DeviceItem[]>([]);

  const load = useCallback(async () => {
    try {
      const r = await deviceApi.list({ page_size: 100 });
      setRows(r.items);
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "加载失败");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <ModuleGate code="device" title="设备">
    <div>
      <NavBar onBack={() => navigate(-1)}>设备</NavBar>
      <List style={{ minHeight: "80dvh" }}>
        {rows.map((d) => (
          <List.Item key={d.id} description={`${d.model || "—"}　${d.location || (d.lat ? `${d.lat.toFixed(5)}, ${d.lng?.toFixed(5)}` : "未定位")}`}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>{d.name}（{d.code}）</span>
              <Tag color={d.status === 1 ? "success" : d.status === 2 ? "warning" : d.status === 4 ? "danger" : "default"}>{DEVICE_STATUS[d.status]}</Tag>
            </div>
          </List.Item>
        ))}
        {rows.length === 0 && <List.Item>暂无设备</List.Item>}
      </List>
    </div>
    </ModuleGate>
  );
}
