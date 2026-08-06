import { useState, type CSSProperties, type MouseEvent } from "react";

/** 文件访问 URL（登录 Cookie 自动携带）。 */
export function fileUrl(fileId: number): string {
  return `/api/v1/files/${fileId}`;
}

/**
 * 图片预览组件（两端通用，无 UI 库依赖）：
 * - 渲染小图；桌面鼠标悬浮显示大图浮层；点击打开全屏 Lightbox 放大
 * - 手机端无悬浮，点击直接放大；不需要下载文件
 */
export function FileImage({
  fileId,
  url,
  size = 48,
  alt = "图片",
  style,
}: {
  fileId?: number;
  url?: string;
  size?: number;
  alt?: string;
  style?: CSSProperties;
}) {
  const src = url ?? (fileId ? fileUrl(fileId) : "");
  const [open, setOpen] = useState(false);
  const [hovering, setHovering] = useState(false);

  if (!src) {
    return <span style={{ color: "#bbb", fontSize: 12 }}>无</span>;
  }

  function stop(e: MouseEvent) {
    e.stopPropagation();
  }

  return (
    <>
      <span style={{ position: "relative", display: "inline-block", verticalAlign: "middle", ...style }}>
        <img
          src={src}
          alt={alt}
          onClick={(e) => {
            stop(e);
            setOpen(true);
          }}
          onMouseEnter={() => setHovering(true)}
          onMouseLeave={() => setHovering(false)}
          style={{
            width: size,
            height: size,
            objectFit: "cover",
            borderRadius: 6,
            cursor: "zoom-in",
            background: "#f0f0f0",
            display: "block",
          }}
        />
        {hovering && (
          <img
            src={src}
            alt={alt}
            style={{
              position: "absolute",
              left: "50%",
              bottom: size + 8,
              transform: "translateX(-50%)",
              maxWidth: 320,
              maxHeight: 240,
              objectFit: "contain",
              borderRadius: 8,
              boxShadow: "0 8px 24px rgba(0,0,0,.25)",
              background: "#fff",
              zIndex: 1000,
              pointerEvents: "none",
            }}
          />
        )}
      </span>
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.78)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "zoom-out",
          }}
        >
          <img
            src={src}
            alt={alt}
            onClick={stop}
            style={{ maxWidth: "92vw", maxHeight: "92vh", objectFit: "contain", borderRadius: 4, boxShadow: "0 12px 48px rgba(0,0,0,.5)" }}
          />
          <span
            onClick={() => setOpen(false)}
            style={{ position: "absolute", top: 14, right: 20, color: "#fff", fontSize: 30, lineHeight: 1, cursor: "pointer" }}
            aria-label="关闭"
          >
            ✕
          </span>
        </div>
      )}
    </>
  );
}
