/** knowledge 模块：知识库（/knowledge，knowledge:view）——已发布文章浏览 + 检索。
 *  v2 界面：左列表 + 右阅读面板双栏（与设计稿一致）。 */
import { useCallback, useEffect, useState } from "react";
import { App, Empty, Input, Spin, Tag, theme, Button } from "antd";
import { SearchOutlined, BookOutlined, CloseOutlined, ClockCircleOutlined } from "@ant-design/icons";

import { knowledgeApi, type ArticleItem } from "./api";

const STATUS_LABEL = ["草稿", "已发布", "已归档"];

export function KnowledgePage() {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const [items, setItems] = useState<ArticleItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");
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

  const published = items.filter((a) => a.status === 1);

  return (
    <div style={{ padding: 24 }}>
      {/* 页头 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>知识库</h2>
          <p style={{ margin: "6px 0 0", fontSize: 12.5, color: token.colorTextSecondary }}>维修经验沉淀：线缆 / 故障 / 设备相关知识点，支持按物料与故障类型关联检索</p>
        </div>
        <Input.Search
          prefix={<SearchOutlined style={{ color: token.colorTextTertiary }} />}
          placeholder="检索已发布知识（故障现象/关键词）"
          style={{ width: 380 }} allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)}
          onSearch={doSearch} loading={searching}
          onClear={() => setSearchResults([])}
        />
      </div>

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* 左：列表 */}
        <div className="wlt-glass" style={{ width: 430, padding: 14, display: "flex", flexDirection: "column", gap: 10, flexShrink: 0, maxHeight: 640, overflowY: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 700, flex: 1 }}>{searching || searchResults.length ? "检索结果" : `全部知识（${published.length}）`}</span>
            {(searching || searchResults.length > 0) && (
              <Button size="small" type="text" icon={<CloseOutlined />} onClick={() => { setSearchResults([]); setKeyword(""); }}>退出检索</Button>
            )}
          </div>
          <Spin spinning={loading || searching}>
            {!searching && searchResults.length === 0 && published.map((a) => (
              <div key={a.id} onClick={() => open(a)}
                style={{ cursor: "pointer", border: `1px solid ${detail?.id === a.id ? "#5B7FFF" : token.colorBorder}`, background: detail?.id === a.id ? "#FBFDFF" : "#fff", borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 6, transition: "border-color .2s ease" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: 13, flex: 1 }}>{a.title}</span>
                  {a.author_type === "ai" && <Tag color="purple" style={{ marginInlineEnd: 0, borderRadius: 999 }}>AI</Tag>}
                  <Tag style={{ marginInlineEnd: 0, borderRadius: 999, color: "#475569", background: "#EFF3FC", borderColor: "transparent" }}>v{a.published_version}</Tag>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {a.category && <Tag style={{ marginInlineEnd: 0, borderRadius: 999, color: "#3B5BDB", background: "#EAEFFF", borderColor: "transparent" }}>{a.category}</Tag>}
                  {a.tags?.slice(0, 3).map((t) => <Tag key={t} style={{ marginInlineEnd: 0, borderRadius: 999 }}>{t}</Tag>)}
                </div>
                <div style={{ fontSize: 11, color: token.colorTextTertiary, display: "flex", alignItems: "center", gap: 4 }}>
                  <ClockCircleOutlined style={{ fontSize: 11 }} />
                  {a.published_at ? new Date(a.published_at).toLocaleString() : "—"}
                </div>
              </div>
            ))}
            {!searching && searchResults.length === 0 && published.length === 0 && !loading && (
              <Empty style={{ padding: "32px 0" }} description="知识库为空" />
            )}
            {!searching && searchResults.length > 0 && searchResults.map((a) => (
              <div key={a.id} onClick={() => knowledgeApi.get(a.id).then((d) => { setDetail(d); setDetailLoading(true); }).catch(() => undefined)}
                style={{ cursor: "pointer", border: `1px solid ${token.colorBorder}`, borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: 13, flex: 1 }}>{a.title}</span>
                  {a.category && <Tag style={{ marginInlineEnd: 0, borderRadius: 999 }}>{a.category}</Tag>}
                </div>
                <div style={{ fontSize: 12, color: token.colorTextSecondary, lineHeight: 1.6 }}>{a.snippet}</div>
              </div>
            ))}
            {!searching && searchResults.length === 0 && keyword.trim() && <Empty style={{ padding: "32px 0" }} description="无匹配的已发布知识" />}
          </Spin>
        </div>

        {/* 右：阅读面板 */}
        <div className="wlt-glass" style={{ flex: 1, minWidth: 320, padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
          {detailLoading && <div style={{ textAlign: "center", padding: 60 }}><Spin /></div>}
          {!detailLoading && detail ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 18, fontWeight: 700, flex: 1, lineHeight: 1.4 }}>{detail.title}</span>
                <Tag style={{ borderRadius: 999, background: "#E8F9EF", color: "#15803D", borderColor: "transparent" }}>{STATUS_LABEL[detail.status]}</Tag>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {detail.category && <Tag style={{ borderRadius: 999, color: "#3B5BDB", background: "#EAEFFF", borderColor: "transparent" }}>{detail.category}</Tag>}
                <Tag style={{ borderRadius: 999 }}>v{detail.version}</Tag>
                {detail.tags?.map((t) => <Tag key={t} style={{ borderRadius: 999 }}>{t}</Tag>)}
                {detail.author_type === "ai" && <Tag color="purple" style={{ borderRadius: 999 }}>AI 生成</Tag>}
              </div>
              <div style={{ height: 1, background: token.colorBorder }} />
              <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.9, fontSize: 14, color: token.colorText }}>{detail.content}</div>
            </>
          ) : (
            !detailLoading && (
              <div style={{ textAlign: "center", padding: "70px 20px", color: token.colorTextTertiary, display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
                <BookOutlined style={{ fontSize: 42, color: "#CBD6EC" }} />
                <div style={{ fontWeight: 600, fontSize: 14 }}>选择左侧知识开始阅读</div>
                <div style={{ fontSize: 12, lineHeight: 1.6 }}>支持按标题 / 内容 / 标签检索；知识可从维修任务直接推荐</div>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
