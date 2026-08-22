/** 手机端：知识（方案 §7.3）——已发布知识检索与浏览。 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Card, Input, List, NavBar, Tag, Toast } from "antd-mobile";

import { ModuleGate } from "../../components/ModuleGate";
import { knowledgeApi, type ArticleItem } from "../api";

export function MobileKnowledgePage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ArticleItem[]>([]);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<ArticleItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await knowledgeApi.list(100);
      setItems(r.items.filter((a) => a.status === 1));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const doSearch = async () => {
    if (!keyword.trim()) { void load(); return; }
    setLoading(true);
    try {
      const r = await knowledgeApi.search(keyword.trim());
      const found = await Promise.all(r.items.map((i) => knowledgeApi.get(i.id).catch(() => null)));
      setItems(found.filter(Boolean) as ArticleItem[]);
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "检索失败");
    } finally {
      setLoading(false);
    }
  };

  const open = async (a: ArticleItem) => {
    try {
      setDetail(await knowledgeApi.get(a.id));
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "加载失败");
    }
  };

  return (
    <ModuleGate code="knowledge" title="知识库">
    <div>
      <NavBar onBack={() => navigate(-1)}>知识库</NavBar>
      <div style={{ padding: 12 }}>
        <Input placeholder="检索已发布知识" value={keyword} onChange={setKeyword} onEnterPress={doSearch} clearable
          style={{ background: "#f5f6f8", borderRadius: 8, padding: "8px 12px" }} />
      </div>
      <List style={{ minHeight: "60dvh" }}>
        {items.map((a) => (
          <List.Item key={a.id} onClick={() => open(a)} description={`${a.category || "未分类"}${a.author_type === "ai" ? " · AI 生成" : ""}`}>
            {a.title}
          </List.Item>
        ))}
        {!loading && items.length === 0 && <List.Item>暂无已发布知识</List.Item>}
      </List>
      {detail && (
        <Card style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 1000, maxHeight: "75dvh", overflow: "auto", borderTopLeftRadius: 16, borderTopRightRadius: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <Tag color="primary">{detail.category || "未分类"}</Tag>
            <span onClick={() => setDetail(null)} style={{ color: "#999" }}>关闭 ×</span>
          </div>
          <h3>{detail.title}</h3>
          <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.8, fontSize: 14 }}>{detail.content}</div>
        </Card>
      )}
    </div>
    </ModuleGate>
  );
}
