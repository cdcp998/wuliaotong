import { useRef } from "react";
import { Button, Space } from "antd-mobile";

import { AlbumIcon, CameraIcon } from "./icons";

/** 相机拍摄 / 相册选择双按钮。
 * 关键：相册 input 不能带 capture（带 capture 时移动端浏览器强制只打开相机，
 * 用户无法从相册选图）；拍照 input 保留 capture="environment" 直达后置相机。
 * translucent：半透明样式（主色浅底 + 半透明描边 + 毛玻璃），用于弱化按钮感的表单场景（如领用申请出库拍照留痕）。 */
export function CameraAlbum({ onPick, loading, translucent }: { onPick: (f: File) => void; loading?: boolean; translucent?: boolean }) {
  const camRef = useRef<HTMLInputElement>(null);
  const albRef = useRef<HTMLInputElement>(null);
  // 半透明：主色浅底 + 半透明描边 + 毛玻璃（-webkit- 前缀兼容 iOS Safari）
  const translucentStyle: React.CSSProperties = translucent
    ? {
        background: "rgba(22,119,255,.08)",
        border: "1px solid rgba(22,119,255,.35)",
        color: "var(--adm-color-primary)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }
    : {};

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ""; // 允许连续选择同一张图
    if (f) onPick(f);
  }

  return (
    <>
      <input ref={camRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={pick} />
      <input ref={albRef} type="file" accept="image/*" style={{ display: "none" }} onChange={pick} />
      <Space wrap>
        <Button fill="outline" disabled={loading} style={translucentStyle} onClick={() => camRef.current?.click()}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <CameraIcon size={15} /> 拍照
          </span>
        </Button>
        <Button fill="outline" disabled={loading} style={translucentStyle} onClick={() => albRef.current?.click()}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <AlbumIcon size={15} /> 相册
          </span>
        </Button>
      </Space>
    </>
  );
}
