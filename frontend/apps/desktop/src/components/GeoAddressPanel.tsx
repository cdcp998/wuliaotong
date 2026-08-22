import { useState } from "react";
import { Button, Input, InputNumber, Space, Spin } from "antd";

import { geoApi } from "@wlt/shared";

/**
 * GPS 坐标查询地址组件（透明背景）：
 * - 支持手动输入坐标，或由外部传入初始坐标（lat/lng props）
 * - 查询后展示地址（OpenStreetMap 逆地理编码，可手动编辑）
 * - 展示字号可调（12~28px）
 * - 适用于无原始 {location} 记录的场景：查询结果可保存回单据水印/记录
 */
export function GeoAddressPanel({
  lat: initLat = "",
  lng: initLng = "",
  location: initLocation = "",
  onSaved,
  onCancel,
}: {
  lat?: string;
  lng?: string;
  location?: string;
  onSaved?: (lat: string, lng: string, location: string) => void;
  onCancel?: () => void;
}) {
  const [lat, setLat] = useState(initLat);
  const [lng, setLng] = useState(initLng);
  const [location, setLocation] = useState(initLocation);
  const [fontSize, setFontSize] = useState(16);
  const [querying, setQuerying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hint, setHint] = useState("");

  async function query() {
    if (!lat.trim() || !lng.trim()) {
      setHint("请先输入纬度与经度");
      return;
    }
    const la = Number(lat);
    const lo = Number(lng);
    if (Number.isNaN(la) || Number.isNaN(lo) || la < -90 || la > 90 || lo < -180 || lo > 180) {
      setHint("坐标超出有效范围（纬度 ±90，经度 ±180）");
      return;
    }
    setQuerying(true);
    setHint("");
    try {
      const d = await geoApi.reverse(lat.trim(), lng.trim());
      setLocation(d.short_address || d.address);
      setHint(`查询成功：${d.address}`);
    } catch (e) {
      setHint(e instanceof Error ? e.message : "查询失败");
    } finally {
      setQuerying(false);
    }
  }

  async function save() {
    if (!location.trim()) {
      setHint("地点不能为空");
      return;
    }
    setSaving(true);
    try {
      await onSaved?.(lat.trim(), lng.trim(), location.trim());
    } finally {
      setSaving(false);
    }
  }

  return (
    // 透明背景容器（不设 background/border，随宿主页面）
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 13, color: "#4e5969" }}>GPS 坐标</span>
        <InputNumber
          placeholder="纬度（如 31.2304）"
          value={lat ? Number(lat) : undefined}
          onChange={(v) => setLat(v === null || v === undefined ? "" : String(v))}
          style={{ width: 150 }}
          min={-90}
          max={90}
        />
        <InputNumber
          placeholder="经度（如 121.4737）"
          value={lng ? Number(lng) : undefined}
          onChange={(v) => setLng(v === null || v === undefined ? "" : String(v))}
          style={{ width: 150 }}
          min={-180}
          max={180}
        />
        <Button type="primary" ghost loading={querying} onClick={() => void query()}>
          GPS 查询地址
        </Button>
      </div>

      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <span style={{ fontSize: 13, color: "#4e5969", paddingTop: 4 }}>地址</span>
        {/* 地址可编辑；展示字号可调 */}
        <Input.TextArea
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="查询或手动填写地址"
          autoSize={{ minRows: 1, maxRows: 4 }}
          style={{ width: 340, fontSize, lineHeight: 1.6, background: "transparent", resize: "none" }}
        />
        <Space orientation="vertical" size={4}>
          <Button size="small" disabled={fontSize >= 28} onClick={() => setFontSize((s) => Math.min(28, s + 2))}>
            A+
          </Button>
          <Button size="small" disabled={fontSize <= 12} onClick={() => setFontSize((s) => Math.max(12, s - 2))}>
            A−
          </Button>
        </Space>
      </div>

      {hint && <div style={{ fontSize: 12, color: hint.includes("失败") || hint.includes("错误") || hint.includes("为空") ? "#cf1322" : "#5B6478" }}>{hint}</div>}

      <Space>
        <Button type="primary" loading={saving} onClick={() => void save()}>
          保存地点与坐标
        </Button>
        {onCancel && <Button onClick={onCancel}>取消</Button>}
      </Space>
      <Spin spinning={querying} />
    </div>
  );
}
