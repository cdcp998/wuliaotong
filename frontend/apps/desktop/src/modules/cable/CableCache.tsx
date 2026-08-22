/** cable 模块：地图缓存管理（/cable/cache，map:cache；地图源配置 map:config）——区域批量下载 + 源配置。 */
import { useCallback, useEffect, useState } from "react";
import { App, Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag, Typography } from "antd";
import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";

import { useAuthStore } from "@wlt/shared";

import { cableApi, type MapSourceInfo } from "./api";

const REGION_STATUS: Record<number, { label: string; color: string }> = {
  0: { label: "未开始", color: "default" },
  1: { label: "下载中", color: "processing" },
  2: { label: "完成", color: "success" },
  3: { label: "已暂停", color: "warning" },
};

interface RegionRow {
  id: number;
  name: string;
  min_zoom: number;
  max_zoom: number;
  tile_count: number;
  cache_size: number;
  last_download_at: string | null;
  update_mode: string;
  status: number;
  pending?: number;
}

export function CableCachePage() {
  const { message } = App.useApp();
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const [regions, setRegions] = useState<RegionRow[]>([]);
  const [progress, setProgress] = useState<{ pending: number; done: number; failed: number }>({ pending: 0, done: 0, failed: 0 });
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sources, setSources] = useState<Record<string, MapSourceInfo>>({});
  const [srcOpen, setSrcOpen] = useState(false);
  const [srcSaving, setSrcSaving] = useState(false);
  const [srcForm] = Form.useForm();
  const [form] = Form.useForm();
  const canConfig = hasPerm("map:config");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, p] = await Promise.all([cableApi.listRegions(), cableApi.downloadProgress()]);
      setRegions(r.map((x) => ({ ...x, pending: p.regions.find((y) => y.id === x.id)?.pending ?? 0 })));
      setProgress({ pending: p.pending, done: p.done, failed: p.failed });
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [message]);

  const loadSources = useCallback(async () => {
    if (!canConfig) return;
    try {
      const r = await cableApi.mapSources();
      setSources(r.map_sources);
    } catch {
      /* 无 map:config 权限静默 */
    }
  }, [canConfig]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadSources(); }, [loadSources]);

  const createRegion = async () => {
    const v = await form.validateFields();
    if (v.east <= v.west || v.north <= v.south) {
      message.warning("bbox 范围不正确（east>west 且 north>south）");
      return;
    }
    if (v.min_zoom > v.max_zoom) {
      message.warning("最小缩放不能大于最大缩放");
      return;
    }
    setSaving(true);
    try {
      const geometry = { type: "Polygon", bbox: [v.west, v.south, v.east, v.north] };
      await cableApi.createRegion({ name: v.name, geometry, min_zoom: v.min_zoom, max_zoom: v.max_zoom, update_mode: v.update_mode ?? "manual" });
      message.success("区域已创建（点击「开始下载」生成瓦片任务）");
      setOpen(false);
      form.resetFields();
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "创建失败");
    } finally {
      setSaving(false);
    }
  };

  const act = async (r: RegionRow, action: "start" | "pause" | "clear") => {
    try {
      let msg = "";
      if (action === "start") {
        const resp = await cableApi.startRegionDownload(r.id);
        msg = `已生成 ${resp.tiles_queued ?? 0} 个下载任务（后台 worker 自动抓取）`;
      } else if (action === "pause") {
        await cableApi.pauseRegionDownload(r.id);
        msg = "已暂停";
      } else {
        await cableApi.clearRegion(r.id);
        msg = "已清理";
      }
      message.success(msg);
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "操作失败");
    }
  };

  const openSrcEdit = (key: string) => {
    const s = sources[key];
    if (s) srcForm.setFieldsValue({ key: s.key, name: s.name, type: s.type, coordinate_space: s.coordinate_space, url_template: s.url_template, api_key: s.api_key, api_secret: s.api_secret, enabled: s.enabled });
    else srcForm.resetFields();
    setSrcOpen(true);
  };

  const saveSources = async () => {
    const v = await srcForm.validateFields();
    setSrcSaving(true);
    try {
      await cableApi.saveMapSources([{
        key: v.key, name: v.name, type: v.type ?? "xyz", coordinate_space: v.coordinate_space ?? "wgs84",
        url_template: v.url_template, api_key: v.api_key ?? "", api_secret: v.api_secret ?? "", enabled: v.enabled ?? true,
      }]);
      message.success("地图源已保存（秘钥加密入库，回读脱敏）");
      setSrcOpen(false);
      void loadSources();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSrcSaving(false);
    }
  };

  return (
    <div>
      <Space style={{ marginBottom: 12, width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>地图缓存管理</Typography.Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => { void load(); void loadSources(); }}>刷新</Button>
          {canConfig && <Button onClick={() => openSrcEdit(Object.keys(sources)[0] ?? "")}>地图源配置</Button>}
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>新建下载区域</Button>
        </Space>
      </Space>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        下载进度：待下载 <Tag color="blue">{progress.pending}</Tag>　成功 <Tag color="green">{progress.done}</Tag>　失败 <Tag color="red">{progress.failed}</Tag>
        <span style={{ marginLeft: 12 }}>瓦片经后端代理缓存（磁盘优先命中 → 在线源抓取落盘），可离线使用。</span>
      </Typography.Paragraph>

      <Table<RegionRow>
        rowKey="id" loading={loading} dataSource={regions} pagination={false}
        columns={[
          { title: "区域", dataIndex: "name" },
          { title: "缩放", key: "zoom", width: 110, render: (_, r) => `z${r.min_zoom}–${r.max_zoom}` },
          { title: "任务数", dataIndex: "tile_count", width: 90, render: (v: number, r) => `${v}${r.pending ? `（待 ${r.pending}）` : ""}` },
          { title: "模式", dataIndex: "update_mode", width: 90, render: (v: string) => ({ manual: "手动", daily: "每日", weekly: "每周" })[v] ?? v },
          { title: "状态", dataIndex: "status", width: 100, render: (v: number) => <Tag color={REGION_STATUS[v]?.color}>{REGION_STATUS[v]?.label ?? v}</Tag> },
          { title: "最后下载", dataIndex: "last_download_at", width: 160, render: (v: string | null) => (v ? new Date(v).toLocaleString() : "—") },
          {
            title: "操作", width: 260,
            render: (_, r) => (
              <Space size={4}>
                {(r.status === 0 || r.status === 3) && <Button size="small" type="primary" onClick={() => act(r, "start")}>开始下载</Button>}
                {r.status === 1 && <Button size="small" onClick={() => act(r, "pause")}>暂停</Button>}
                <Popconfirm title="清理区域任务与磁盘瓦片？" onConfirm={() => act(r, "clear")}>
                  <Button size="small" danger>清理</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      {canConfig && (
        <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
          已配置地图源：{Object.values(sources).map((s) => `${s.name}(${s.coordinate_space})`).join("、") || "无"}（{Object.keys(sources).length} 个）
        </Typography.Paragraph>
      )}

      <Modal open={open} onCancel={() => setOpen(false)} onOk={createRegion} confirmLoading={saving} title="新建缓存下载区域" width={520} destroyOnHidden>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="区域名称" rules={[{ required: true, message: "请输入名称" }]}>
            <Input maxLength={100} placeholder="如 城东机房片区" />
          </Form.Item>
          <Space>
            <Form.Item name="west" label="西经" rules={[{ required: true }]}><InputNumber style={{ width: 110 }} min={-180} max={180} /></Form.Item>
            <Form.Item name="south" label="南纬" rules={[{ required: true }]}><InputNumber style={{ width: 110 }} min={-90} max={90} /></Form.Item>
            <Form.Item name="east" label="东经" rules={[{ required: true }]}><InputNumber style={{ width: 110 }} min={-180} max={180} /></Form.Item>
            <Form.Item name="north" label="北纬" rules={[{ required: true }]}><InputNumber style={{ width: 110 }} min={-90} max={90} /></Form.Item>
          </Space>
          <Space>
            <Form.Item name="min_zoom" label="最小缩放" initialValue={12}><InputNumber min={0} max={22} /></Form.Item>
            <Form.Item name="max_zoom" label="最大缩放" initialValue={18}><InputNumber min={0} max={22} /></Form.Item>
            <Form.Item name="update_mode" label="更新模式" initialValue="manual">
              <Select style={{ width: 130 }} options={[{ value: "manual", label: "手动" }, { value: "daily", label: "每日" }, { value: "weekly", label: "每周" }]} />
            </Form.Item>
          </Space>
          <Typography.Text type="secondary">提示：建议按片区限制缩放范围；配置过大区域会产生大量瓦片任务（容量由 cache.max_size 与每日配额保护）。</Typography.Text>
        </Form>
      </Modal>

      <Modal open={srcOpen} onCancel={() => setSrcOpen(false)} onOk={saveSources} confirmLoading={srcSaving} title="地图源配置（保存后加密入库，回读脱敏）" width={560} destroyOnHidden>
        <Form form={srcForm} layout="vertical">
          <Space>
            <Form.Item name="key" label="源标识" rules={[{ required: true }]}><Input style={{ width: 160 }} /></Form.Item>
            <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input style={{ width: 200 }} /></Form.Item>
          </Space>
          <Space>
            <Form.Item name="type" label="类型">
              <Select style={{ width: 140 }} options={["esri", "mapbox", "google", "amap", "baidu", "tms", "wms", "wmts", "xyz"].map((v) => ({ value: v, label: v }))} />
            </Form.Item>
            <Form.Item name="coordinate_space" label="坐标空间">
              <Select style={{ width: 140 }} options={[{ value: "wgs84", label: "WGS84" }, { value: "gcj02", label: "GCJ-02" }, { value: "bd09", label: "BD-09" }]} />
            </Form.Item>
            <Form.Item name="enabled" label="启用" initialValue={true}>
              <Select style={{ width: 120 }} options={[{ value: true, label: "是" }, { value: false, label: "否" }]} />
            </Form.Item>
          </Space>
          <Form.Item name="url_template" label="瓦片 URL 模板（{z}/{x}/{y} 或 {z}/{y}/{x}）" rules={[{ required: true, message: "请输入模板" }]}>
            <Input placeholder="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />
          </Form.Item>
          <Space>
            <Form.Item name="api_key" label="API Key（可选，加密存储）"><Input style={{ width: 240 }} /></Form.Item>
            <Form.Item name="api_secret" label="API Secret（可选，加密存储）"><Input style={{ width: 240 }} /></Form.Item>
          </Space>
        </Form>
      </Modal>
    </div>
  );
}
