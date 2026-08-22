import { useRef, useState, type ReactNode } from "react";

/**
 * 移动端整卡拖拽排序竖向列表（无第三方库，Pointer Events 实现）：
 * - 按住卡片任意位置上下拖动 → 被拖卡片跟随手指，其余卡片平滑让位（CSS transform）
 * - 拖拽期间【不】重排数组（无 splice/sort 重渲染），松手时一次性重排 + 持久化 → 流畅不卡顿
 * - 卡片内 `data-nodrag` 元素（按钮等）按下不启动拖拽，单击照常生效
 */
export function ReorderList<T extends { key: string }>({
  items,
  onChange,
  onDrop,
  renderContent,
  footer,
}: {
  items: T[];
  onChange?: (items: T[]) => void;
  onDrop?: (items: T[]) => void;
  renderContent: (item: T, index: number) => ReactNode;
  footer?: ReactNode;
}) {
  const [dragIndex, setDragIndex] = useState(-1); // 被拖卡片下标（-1=未拖）
  const [dragOffset, setDragOffset] = useState(0); // 被拖卡片偏移
  const [targetIndex, setTargetIndex] = useState(-1); // 目标插入位
  const dragRef = useRef<{ index: number; startY: number; rowH: number; target: number } | null>(null);

  function beginDrag(e: React.PointerEvent, index: number) {
    // 按下的是卡片内按钮等（data-nodrag）→ 不启动拖拽，让点击照常生效
    if ((e.target as HTMLElement).closest("[data-nodrag]")) return;
    e.preventDefault();
    const row = (e.currentTarget as HTMLElement).closest("[data-row]") as HTMLElement | null;
    dragRef.current = { index, startY: e.clientY, rowH: row?.offsetHeight || 44, target: index };
    setDragIndex(index);
    setTargetIndex(index);
    setDragOffset(0);
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* 部分环境不支持 capture，仍可拖动 */
    }
  }

  function moveDrag(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const offset = e.clientY - d.startY;
    const target = Math.max(0, Math.min(items.length - 1, d.index + Math.round(offset / d.rowH)));
    d.target = target;
    setDragOffset(offset);
    setTargetIndex(target);
  }

  function endDrag() {
    const d = dragRef.current;
    dragRef.current = null;
    if (d && d.target !== d.index) {
      const next = [...items];
      const [moved] = next.splice(d.index, 1);
      next.splice(d.target, 0, moved);
      onChange?.(next);
      onDrop?.(next);
    }
    setDragIndex(-1);
    setTargetIndex(-1);
    setDragOffset(0);
  }

  const rowH = dragRef.current?.rowH ?? 0;

  return (
    <div>
      {items.map((item, i) => {
        let transform = "none";
        if (dragIndex === i) {
          transform = `translateY(${dragOffset}px)`;
        } else if (dragIndex >= 0 && targetIndex >= 0 && i !== dragIndex) {
          if (i > dragIndex && i <= targetIndex) transform = `translateY(-${rowH}px)`;
          else if (i < dragIndex && i >= targetIndex) transform = `translateY(${rowH}px)`;
        }
        const dragging = dragIndex === i;
        return (
          <div
            key={item.key}
            data-row
            onPointerDown={(e) => beginDrag(e, i)}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            style={{
              position: "relative",
              zIndex: dragging ? 10 : 1,
              transform,
              transition: dragging ? "none" : "transform .18s ease",
              touchAction: "none",
              WebkitTouchCallout: "none",
              WebkitUserSelect: "none",
              userSelect: "none",
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "#fff",
              border: "1px solid #f0f1f3",
              borderRadius: 10,
              padding: "8px 10px",
              marginBottom: 8,
              cursor: "grab",
              boxShadow: dragging ? "0 8px 22px rgba(31,35,41,.16)" : "none",
            }}
          >
            {renderContent(item, i)}
          </div>
        );
      })}
      {footer}
    </div>
  );
}
