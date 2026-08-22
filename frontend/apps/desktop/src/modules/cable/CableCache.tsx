/** cable 模块：地图缓存管理（/cable/cache，map:cache）+ 图源管理（map:config 编辑/新增/删除，查看脱敏）。 */
import { useCallback, useEffect, useState } from "react";
import { App, Button, Form, Input, InputNumber, Modal, Popconfirm, Progress, Select, Space, Table, Tag, Typography } from "antd";
import { CaretRightOutlined, EnvironmentOutlined, PauseOutlined, PlusOutlined, ReloadOutlined, SettingOutlined } from "@ant-design/icons";

import { useAuthStore } from "@wlt/shared";

import { cableApi, type MapSourceInfo } from "./api";
import { MapView } from "./MapView";

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
  done?: number;
  failed?: number;
  total?: number;
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
  const [srcModalOpen, setSrcModalOpen] = useState(false);
  const [srcSaving, setSrcSaving] = useState(false);
  const [srcEditKey, setSrcEditKey] = useState<string | null>(null);
  const [testingKey, setTestingKey] = useState<string | null>(null);
  const [srcForm] = Form.useForm();
  const [form] = Form.useForm();
  const canConfig = hasPerm("map:config");
  // 地图框选区域（新建缓存区域）
  const [regionSources, setRegionSources] = useState<Record<string, MapSourceInfo>>({});
  const [regionPicks, setRegionPicks] = useState<{ lat: number; lng: number }[]>([]);
  const [regionRect, setRegionRect] = useState<[number, number][]>([]);
  const [regionPicking, setRegionPicking] = useState(false);

  const pickRegionCorner = (lat: number, lng: number) => {
    if (!regionPicking) return;
    const picks = [...regionPicks, { lat, lng }];
    setRegionPicks(picks);
    if (picks.length < 2) return;
    const [a, b] = picks;
    const west = Math.min(a.lng, b.lng);
    const east = Math.max(a.lng, b.lng);
    const south = Math.min(a.lat, b.lat);
    const north = Math.max(a.lat, b.lat);
    form.setFieldsValue({ west, south, east, north });
    setRegionRect([
      [south, west], [south, east], [north, east], [north, west], [south, west],
    ] as [number, number][]);
    setRegionPicks([]);
    setRegionPicking(false);
  };

  const applyProgress = useCallback((p: Awaited<ReturnType<typeof cableApi.downloadProgress>>) => {
    const stat = Object.fromEntries(p.regions.map((x) => [x.id, x]));
    setRegions((prev) =>
      prev.map((x) => ({
        ...x,
        pending: stat[x.id]?.pending ?? 0,
        done: stat[x.id]?.done ?? 0,
        failed: stat[x.id]?.failed ?? 0,
        total: stat[x.id]?.total ?? 0,
      }))
    );
    setProgress({ pending: p.pending, done: p.done, failed: p.failed });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, p] = await Promise.all([cableApi.listRegions(), cableApi.downloadProgress()]);
      setRegions(r.map((x) => ({ ...x, pending: 0, done: 0, failed: 0, total: 0 })));
      applyProgress(p);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [applyProgress, message]);

  // 任一区域下载中 → 每 3 秒轮询进度（实时进度条；暂停/完成后自动停止）
  const downloading = regions.some((r) => r.status === 1);
  useEffect(() => {
    if (!downloading) return;
    const timer = window.setInterval(() => {
      cableApi.downloadProgress().then(applyProgress).catch(() => {});
    }, 3000);
    return () => window.clearInterval(timer);
  }, [downloading, applyProgress]);

  const loadSources = useCallback(async () => {
    try {
      const r = await cableApi.mapSources();
      // 后端每个源对象不含 key（key 为外层对象键），注入 key 供表格行内操作（测试/编辑/停用/删除）使用
      const withKey = Object.fromEntries(Object.entries(r.map_sources).map(([k, v]) => [k, { ...v, key: k }]));
      setSources(withKey);
      setRegionSources(withKey);
    } catch {
      /* 无权限/接口异常静默 */
    }
  }, []);

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
      setRegionPicks([]);
      setRegionRect([]);
      setRegionPicking(false);
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
        msg = `已生成 ${resp.tiles_queued ?? 0} 个下载任务，后台开始下载`;
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

  const openSrcEdit = (key: string | null) => {
    if (!canConfig) return;
    setSrcEditKey(key);
    const s = key ? sources[key] : undefined;
    if (s) {
      srcForm.setFieldsValue({
        key: s.key, name: s.name, type: s.type, coordinate_space: s.coordinate_space,
        url_template: s.url_template ?? "", api_key: s.api_key ?? "", api_secret: s.api_secret ?? "", enabled: s.enabled,
      });
    } else {
      srcForm.resetFields();
      srcForm.setFieldsValue({ type: "xyz", coordinate_space: "wgs84", enabled: true });
    }
    setSrcModalOpen(true);
  };

  const saveSources = async () => {
    const v = await srcForm.validateFields();
    if (srcEditKey && v.key !== srcEditKey) {
      message.warning("源标识创建后不可修改（如需重命名请新建源）");
      return;
    }
    setSrcSaving(true);
    try {
      await cableApi.saveMapSources([{
        key: v.key, name: v.name, type: v.type ?? "xyz", coordinate_space: v.coordinate_space ?? "wgs84",
        url_template: v.url_template, api_key: v.api_key ?? "", api_secret: v.api_secret ?? "", enabled: v.enabled ?? true,
      }]);
      message.success("地图源已保存（密钥加密入库，回读脱敏；「******」表示保持不变）");
      setSrcOpen(false);
      void loadSources();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSrcSaving(false);
    }
  };

  const toggleSource = async (s: MapSourceInfo) => {
    if (!canConfig) return;
    try {
      await cableApi.saveMapSources([{ ...s, enabled: !s.enabled }]);
      message.success(s.enabled ? "已停用" : "已启用");
      void loadSources();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "操作失败");
    }
  };

  const deleteSource = async (key: string) => {
    if (!canConfig) return;
    try {
      await cableApi.deleteMapSource(key);
      message.success("已删除（若删除后无可用源，瓦片代理将回退内置默认 Esri）");
      void loadSources();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "删除失败");
    }
  };

  const testSource = async (s: MapSourceInfo) => {
    setTestingKey(s.key);
    try {
      const url = cableApi.tileUrl(s.key, 2, 1, 1);
      const resp = await fetch(url, { credentials: "include" });
      if (resp.ok) {
        message.success(`「${s.name}」连接正常（瓦片 ${resp.status}）`);
      } else {
        const body = await resp.json().catch(() => null);
        message.error(`「${s.name}」连接失败：${body?.message ?? `HTTP ${resp.status}`}`);
      }
    } catch (e) {
      message.error(`「${s.name}」连接失败：${e instanceof Error ? e.message : "网络异常"}`);
    } finally {
      setTestingKey(null);
    }
  };

  const defaultKey = Object.keys(sources).find((k) => sources[k]?.enabled);

  return (
    <div>
      <Space style={{ marginBottom: 12, width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>地图缓存管理</Typography.Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => { void load(); void loadSources(); }}>刷新</Button>
          <Button icon={<SettingOutlined />} onClick={() => setSrcOpen(true)}>图源管理</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>新建下载区域</Button>
        </Space>
      </Space>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        <Space size={12} wrap>
          <span>下载进度：</span>
          <Progress
            percent={progress.pending + progress.done + progress.failed > 0
              ? Math.round(((progress.done + progress.failed) / (progress.pending + progress.done + progress.failed)) * 100)
              : 0}
            size="small" style={{ width: 220 }}
            status={progress.failed > 0 ? "exception" : undefined}
            format={() => `${progress.done + progress.failed} / ${progress.pending + progress.done + progress.failed}`}
          />
          <span>待 <Tag color="blue">{progress.pending}</Tag></span>
          <span>成功 <Tag color="green">{progress.done}</Tag></span>
          <span>失败 <Tag color="red">{progress.failed}</Tag></span>
          <span>瓦片经后端代理缓存（磁盘优先命中 → 在线源抓取落盘），可离线使用。</span>
        </Space>
      </Typography.Paragraph>

      <Table<RegionRow>
        rowKey="id" loading={loading} dataSource={regions} pagination={false}
        columns={[
          { title: "区域", dataIndex: "name" },
          { title: "缩放", key: "zoom", width: 110, render: (_, r) => `z${r.min_zoom}–${r.max_zoom}` },
          {
            title: "下载进度", key: "progress", width: 230,
            render: (_, r) => {
              const total = r.total ?? 0;
              const done = r.done ?? 0;
              const failed = r.failed ?? 0;
              if (!total) return <Typography.Text type="secondary">—</Typography.Text>;
              const percent = Math.round(((done + failed) / total) * 100);
              return (
                <div style={{ minWidth: 190 }}>
                  <Progress percent={percent} size="small" status={failed > 0 ? "exception" : undefined} format={() => `${done} / ${total}`} />
                  <div style={{ fontSize: 12, color: "#86909c", marginTop: 2 }}>
                    待 {r.pending ?? 0} · 成功 {done}
                    {failed > 0 && <span style={{ color: "#cf1322" }}> · 失败 {failed}</span>}
                  </div>
                </div>
              );
            },
          },
          { title: "模式", dataIndex: "update_mode", width: 90, render: (v: string) => ({ manual: "手动", daily: "每日", weekly: "每周" })[v] ?? v },
          { title: "状态", dataIndex: "status", width: 100, render: (v: number) => <Tag color={REGION_STATUS[v]?.color}>{REGION_STATUS[v]?.label ?? v}</Tag> },
          { title: "最后下载", dataIndex: "last_download_at", width: 160, render: (v: string | null) => (v ? new Date(v).toLocaleString() : "—") },
          {
            title: "操作", width: 230,
            render: (_, r) => (
              <Space size={4}>
                {(r.status === 0 || r.status === 2) && <Button size="small" type="primary" onClick={() => act(r, "start")}>开始下载</Button>}
                {r.status === 1 && <Button size="small" icon={<PauseOutlined />} onClick={() => act(r, "pause")}>暂停</Button>}
                {r.status === 3 && <Button size="small" icon={<CaretRightOutlined />} onClick={() => act(r, "start")}>继续</Button>}
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
          已配置地图源：{Object.values(sources).map((s) => `${s.name}(${s.coordinate_space})`).join("、") || "无（使用内置默认 Esri）"}（{Object.keys(sources).length} 个）
        </Typography.Paragraph>
      )}

      {/* 图源管理（弹窗式，宽屏自适应） */}
      <Modal
        open={srcOpen}
        onCancel={() => setSrcOpen(false)}
        footer={null}
        width={1200}
        title="图源管理"
        destroyOnHidden
        styles={{ body: { maxHeight: "70vh", overflow: "auto" } }}
      >
        <Space direction="vertical" style={{ width: "100%" }} size={12}>
          <Space align="center" style={{ width: "100%", justifyContent: "space-between" }}>
            <Typography.Text type="secondary">
              数据一律 WGS84 存储；仅显示层按源 coordinate_space 转换（gcj02/bd09 可配）。密钥加密存储、回读脱敏。「内置」为系统自带图源，已写入配置库，可测试/编辑/停用。
            </Typography.Text>
            {canConfig && <Button type="primary" icon={<PlusOutlined />} onClick={() => openSrcEdit(null)}>新增图源</Button>}
          </Space>
          <Table<MapSourceInfo>
            rowKey="key"
            dataSource={Object.values(sources)}
            pagination={false}
            scroll={{ x: 1120 }}
            columns={[
              { title: "标识", dataIndex: "key", width: 170, render: (v: string) => (
                <span style={{ whiteSpace: "nowrap" }}>
                  <Typography.Text code>{v}</Typography.Text>
                  {v === "esri" && <Tag color="blue" style={{ marginLeft: 6 }}>内置</Tag>}
                </span>
              ) },
              { title: "名称", dataIndex: "name", width: 280, ellipsis: true },
              { title: "类型", dataIndex: "type", width: 110, render: (v: string) => <Tag style={{ whiteSpace: "nowrap" }}>{v}</Tag> },
              { title: "坐标空间", dataIndex: "coordinate_space", width: 120, render: (v: string) => <span style={{ whiteSpace: "nowrap" }}>{v}</span> },
              {
                title: "状态", dataIndex: "enabled", width: 160,
                render: (v: boolean, s) => (
                  <span style={{ whiteSpace: "nowrap" }}>
                    <Tag color={v ? "success" : "default"}>{v ? "启用" : "停用"}</Tag>
                    {defaultKey === s.key && <Tag color="blue">默认</Tag>}
                  </span>
                ),
              },
              {
                title: "操作", width: 300,
                render: (_, s) => (
                  <Space size={4} wrap={false}>
                    <Button size="small" onClick={() => testSource(s)} loading={testingKey === s.key}>测试</Button>
                    {canConfig && <Button size="small" onClick={() => openSrcEdit(s.key)}>编辑</Button>}
                    {canConfig && (
                      <Button size="small" onClick={() => toggleSource(s)}>{s.enabled ? "停用" : "启用"}</Button>
                    )}
                    {canConfig && (
                      <Popconfirm title={s.key === "esri" ? "删除内置 Esri？之后系统会在无可用源时自动回退内置默认（可能再次出现）。" : `删除图源「${s.name}」？删除后瓦片代理不再使用它。`} onConfirm={() => deleteSource(s.key)}>
                        <Button size="small" danger>删除</Button>
                      </Popconfirm>
                    )}
                  </Space>
                ),
              },
            ]}
          />
          {!canConfig && <Typography.Text type="secondary">当前账号仅有查看权限（脱敏）；新增/编辑/停用/删除需要「地图源配置」权限（超级管理员）。</Typography.Text>}
        </Space>
      </Modal>

      <Modal open={open} onCancel={() => setOpen(false)} onOk={createRegion} confirmLoading={saving} title="新建缓存下载区域" width={720} destroyOnHidden>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="区域名称" rules={[{ required: true, message: "请输入名称" }]}>
            <Input maxLength={100} placeholder="如 城东机房片区" />
          </Form.Item>
          {/* 地图框选区域：点两角自动填 bbox（可再手调） */}
          <Typography.Text strong>地图选择区域（点击两角拖动另算：点两个对角点即可）</Typography.Text>
          <div style={{ height: 240, margin: "8px 0", border: "1px solid #e5e6eb", borderRadius: 6, overflow: "hidden" }}>
            <MapView
              sources={regionSources}
              overlays={{ cables: [], faults: [], markersByCable: {} }}
              previewPath={regionRect}
              onPick={pickRegionCorner}
              picking={regionPicking ? "在地图上点击第「一个角」，再点对角" : undefined}
              height="240px"
            />
          </div>
          <Space style={{ marginBottom: 8 }}>
            <Button size="small" icon={<EnvironmentOutlined />} onClick={() => { setRegionPicking(true); setRegionPicks([]); setRegionRect([]); }}>重新框选</Button>
            {regionRect.length > 0 && <Typography.Text type="secondary">已选区域（可手动修正输入框）</Typography.Text>}
          </Space>
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

      <Modal open={srcModalOpen} onCancel={() => setSrcModalOpen(false)} onOk={saveSources} confirmLoading={srcSaving} title={srcEditKey ? `编辑图源：${srcEditKey}` : "新增图源（密钥加密入库，回读脱敏）"} width={560} destroyOnHidden>
        <Form form={srcForm} layout="vertical">
          <Space>
            <Form.Item name="key" label="源标识" rules={[{ required: true }]}>
              <Input style={{ width: 160 }} disabled={!!srcEditKey} placeholder="如 amap" />
            </Form.Item>
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
          <Typography.Text type="secondary">回显为「******」表示已存密钥；保持原值重存不会覆盖（留空则清除）。</Typography.Text>
        </Form>
      </Modal>
    </div>
  );
}
