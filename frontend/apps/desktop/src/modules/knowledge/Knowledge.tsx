/** knowledge 模块：知识库（/knowledge，knowledge:view）——已发布文章浏览 + 检索。 */
import { useCallback, useEffect, useState } from "react";
import { App, Card, Drawer, Empty, Input, Space, Spin, Tag, Typography } from "antd";

import { knowledgeApi, type ArticleItem } from "./api";

export function KnowledgePage() {
  const { message } = App.useApp();
  const [items, setItems] = useState<ArticleItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<{ id: number; title: string; snippet: string; category: string }[]>([]);
  const [detail, setDetail] = useState<ArticleItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await knowledgeApi.list({ page_size: 50 });
      setItems(r.items);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => { void load(); }, [load]);

  const open = async (a: ArticleItem) => {
    setDetailLoading(true);
    setDetail(null);
    try {
      setDetail(await knowledgeApi.get(a.id));
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载详情失败");
    } finally {
      setDetailLoading(false);
    }
  };

  const doSearch = async () => {
    if (!keyword.trim()) return;
    setSearching(true);
    try {
      const r = await knowledgeApi.search(keyword.trim(), 20);
      setSearchResults(r.items ?? []);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "检索失败");
    } finally {
      setSearching(false);
    }
  };

  return (
    <div>
      <Space style={{ marginBottom: 12, width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>知识库</Typography.Title>
        <Input.Search placeholder="检索已发布知识（故障现象/关键词）" style={{ width: 360 }} allowClear
          onSearch={doSearch} loading={searching} />
      </Space>
      {searchResults.length > 0 || searching ? (
        <Space direction="vertical" style={{ width: "100%" }} size={8}>
          {searchResults.map((a) => (
            <Card key={a.id} size="small" hoverable onClick={() => knowledgeApi.get(a.id).then((d) => setDetail(d)).catch(() => undefined)}>
              <Space>
                <Typography.Text strong>{a.title}</Typography.Text>
                <Tag>{a.category || "未分类"}</Tag>
              </Space>
              <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }} ellipsis={{ rows: 2 }}>
                {a.snippet}
              </Typography.Paragraph>
            </Card>
          ))}
          {!searching && searchResults.length === 0 && <Empty description="无匹配的已发布知识" />}
        </Space>
      ) : (
        <Spin spinning={loading}>
          <Space direction="vertical" style={{ width: "100%" }} size={8}>
            {items.filter((a) => a.status === 1).map((a) => (
              <Card key={a.id} size="small" hoverable onClick={() => open(a)}>
                <Space>
                  <Typography.Text strong>{a.title}</Typography.Text>
                  <Tag>{a.category || "未分类"}</Tag>
                  {a.author_type === "ai" && <Tag color="purple">AI 生成</Tag>}
                </Space>
                <div style={{ fontSize: 12, color: "#888" }}>
                  版本 {a.published_version}　{a.published_at ? new Date(a.published_at).toLocaleString() : ""}
                </div>
              </Card>
            ))}
            {!loading && items.filter((a) => a.status === 1).length === 0 && <Empty description="知识库为空" />}
          </Space>
        </Spin>
      )}

      <Drawer open={!!detail || detailLoading} onClose={() => setDetail(null)} width={640} title={detail?.title}>
        {detailLoading ? <Spin /> : detail && (
          <div>
            <Space style={{ marginBottom: 12 }}>
              <Tag>{detail.category || "未分类"}</Tag>
              <Tag color={detail.status === 1 ? "success" : detail.status === 2 ? "default" : "orange"}>
                {["草稿", "已发布", "已归档"][detail.status]}
              </Tag>
              <Tag>v{detail.version}</Tag>
              {detail.tags?.map((t) => <Tag key={t} color="blue">{t}</Tag>)}
            </Space>
            <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.8 }}>{detail.content}</div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
