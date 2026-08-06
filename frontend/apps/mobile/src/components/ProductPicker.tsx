import { useMemo, useState } from "react";
import { Button, Input, Popup, Tag, Toast } from "antd-mobile";

import { baseApi, type Product } from "@wlt/shared";

/** 商品选择弹层：关键字搜索 → 选择（手机端仓管员出入库/盘点用）。 */
export function ProductPicker({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (p: Product) => void;
}) {
  const [keyword, setKeyword] = useState("");
  const [list, setList] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const searched = useMemo(() => list.length > 0, [list]);

  async function search() {
    if (!keyword.trim()) {
      Toast.show("请输入关键字");
      return;
    }
    setLoading(true);
    try {
      const data = await baseApi.products(keyword.trim());
      setList(data.list);
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "查询失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Popup visible={visible} onMaskClick={onClose} bodyStyle={{ height: "70vh" }}>
      <div style={{ padding: 16, display: "flex", flexDirection: "column", height: "100%" }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <Input
            placeholder="材料名称/编码/条码"
            value={keyword}
            onChange={setKeyword}
            onEnterPress={search}
            style={{ flex: 1, border: "1px solid #e5e5e5", borderRadius: 8, padding: "0 10px" }}
          />
          <Button color="primary" size="small" loading={loading} onClick={search}>
            搜索
          </Button>
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {!searched && !loading && <div style={{ color: "#999", textAlign: "center", paddingTop: 40 }}>输入关键字搜索商品</div>}
          {list.map((p) => (
            <div
              key={p.id}
              onClick={() => {
                onPick(p);
                setList([]);
                setKeyword("");
                onClose();
              }}
              style={{
                padding: "10px 0",
                borderBottom: "1px solid #f0f0f0",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <div>{p.name}</div>
                <div style={{ color: "#999", fontSize: 12 }}>
                  {p.code}
                  {p.spec ? ` / ${p.spec}` : ""}
                </div>
              </div>
              <Tag color="primary">{p.unit_name}</Tag>
            </div>
          ))}
        </div>
      </div>
    </Popup>
  );
}
