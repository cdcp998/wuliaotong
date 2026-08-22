import { useRef, useState, type ReactNode } from "react";

/**
 * 移动端宫格卡片拖拽排序（无第三方库，Pointer Events 实现）：
 * - 按住任意卡片直接拖动：被拖卡片变「幽灵」跟随手指（position:fixed，直接改 DOM 不触发 React 渲染 → 流畅）
 * - 原位置留空位，其余卡片 CSS transform 平移让位（含跨行换位计算），松手一次性重排 + 持久化
 * - 仅在跨格时更新目标下标（不逐像素重排），不卡顿
 * - 卡片内 `data-nodrag` 元素（按钮等）按下不启动拖拽
 */
export function ReorderGrid<T extends { key: string }>({
  items,
  cols = 4,
  gap = 10,
  onChange,
  onDrop,
  renderContent,
  placeholder,
  footer,
}: {
  items: T[];
  cols?: number;
  gap?: number;
  onChange?: (items: T[]) => void;
  onDrop?: (items: T[]) => void;
  renderContent: (item: T, index: number) => ReactNode;
  /** 拖拽占位卡片的渲染（保持原格位大小）；缺省给一个虚线占位。 */
  placeholder?: () => ReactNode;
  footer?: ReactNode;
}) {
  const [dragIndex, setDragIndex] = useState(-1);
  const [targetIndex, setTargetIndex] = useState(-1);
  const [cellSize, setCellSize] = useState({ w: 0, h: 0 });
  const dragRef = useRef<{ index: number; w: number; h: number } | null>(null);
  const targetRef = useRef(-1);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const cellsRef = useRef(new Map<string, HTMLDivElement>());
  const indexByKey = useRef(new Map<string, number>());

  function beginDrag(e: React.PointerEvent, key: string, index: number) {
    if ((e.target as HTMLElement).closest("[data-nodrag]")) return;
    e.preventDefault();
    const cell = cellsRef.current.get(key);
    if (!cell) return;
    const rect = cell.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    setCellSize({ w, h });
    dragRef.current = { index, w, h };
    targetRef.current = index;
    setDragIndex(index);
    setTargetIndex(index);
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* 部分环境不支持 capture */
    }
    // 幽灵渲染后定位到指针处
    requestAnimationFrame(() => {
      if (ghostRef.current) {
        ghostRef.current.style.left = `${e.clientX - w / 2}px`;
        ghostRef.current.style.top = `${e.clientY - h / 2}px`;
      }
    });
  }

  function moveDrag(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    // 幽灵跟随指针：直接改 DOM，不走 React state（保证 60fps 不卡顿）
    if (ghostRef.current) {
      ghostRef.current.style.left = `${e.clientX - d.w / 2}px`;
      ghostRef.current.style.top = `${e.clientY - d.h / 2}px`;
    }
    // 找指针中心最近的卡片 → 目标下标（跨格才更新）
    const cx = e.clientX;
    const cy = e.clientY;
    let target = targetRef.current;
    let best = Infinity;
    cellsRef.current.forEach((el) => {
      const r = el.getBoundingClientRect();
      const c = Math.abs(r.left + r.width / 2 - cx) + Math.abs(r.top + r.height / 2 - cy);
      if (c < best) {
        best = c;
        const k = indexByKey.current.get(el.dataset.key ?? "") ?? -1;
        if (k >= 0) target = k;
      }
    });
    if (target !== targetRef.current) {
      targetRef.current = target;
      setTargetIndex(target);
    }
  }

  function endDrag() {
    const d = dragRef.current;
    dragRef.current = null;
    const t = targetRef.current;
    if (d && t !== d.index && t >= 0) {
      const next = [...items];
      const [moved] = next.splice(d.index, 1);
      next.splice(t, 0, moved);
      onChange?.(next);
      onDrop?.(next);
    }
    targetRef.current = -1;
    setDragIndex(-1);
    setTargetIndex(-1);
  }

  const s = dragIndex;
  const t = targetIndex;
  const cw = cellSize.w + gap;
  const ch = cellSize.h + gap;

  const placeholderNode = placeholder ?? (() => <span />);

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols},1fr)`, gap }}>
        {items.map((item, i) => {
          // 拖拽中其余卡片平移让位（含跨行换位）
          let transform = "none";
          if (s >= 0 && t >= 0 && i !== s) {
            if (t > s && i > s && i <= t) {
              transform =
                i % cols !== 0
                  ? `translateX(${-cw}px)`
                  : `translateX(${(cols - 1) * cw}px) translateY(${-ch}px)`;
            } else if (t < s && i >= t && i < s) {
              transform =
                i % cols !== cols - 1
                  ? `translateX(${cw}px)`
                  : `translateX(${-(cols - 1) * cw}px) translateY(${ch}px)`;
            }
          }
          return (
            <div
              key={item.key}
              data-key={item.key}
              data-cell
              ref={(el) => {
                if (el) {
                  cellsRef.current.set(item.key, el);
                  indexByKey.current.set(item.key, i);
                } else {
                  cellsRef.current.delete(item.key);
                }
              }}
              onPointerDown={(e) => beginDrag(e, item.key, i)}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              style={{
                position: "relative",
                transform,
                transition: i === s ? "none" : "transform .18s ease",
                touchAction: "none",
                WebkitUserSelect: "none",
                userSelect: "none",
                WebkitTouchCallout: "none",
              }}
            >
              {i === s ? placeholderNode() : renderContent(item, i)}
            </div>
          );
        })}
      </div>
      {/* 拖拽幽灵：fixed 跟随指针 */}
      {s >= 0 && items[s] && (
        <div
          ref={ghostRef}
          style={{
            position: "fixed",
            left: -9999,
            top: -9999,
            width: cellSize.w || 80,
            minHeight: cellSize.h || 76,
            zIndex: 1000,
            pointerEvents: "none",
            boxShadow: "0 10px 28px rgba(31,35,41,.22)",
            transform: "scale(1.04)",
          }}
        >
          {renderContent(items[s], s)}
        </div>
      )}
      {footer}
    </div>
  );
}
