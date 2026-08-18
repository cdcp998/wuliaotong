import { useRef, useState } from "react";
import { ActionSheet, Button, Toast } from "antd-mobile";

import { apiBase, fileApi, FileImage } from "@wlt/shared";

import { CameraAlbum } from "./CameraAlbum";
import { AlbumIcon, CameraIcon } from "./icons";

/** 拍照/相册上传（可选）：返回 file_id，展示已拍缩略图。
 * 拍照走 capture="environment" 直达相机，相册走不带 capture 的 input（移动端可正常选图）。 */
export function PhotoUpload({
  bizType,
  fileId,
  onChange,
  translucent,
}: {
  bizType: string;
  fileId?: number;
  onChange: (fileId: number | undefined) => void;
  /** 半透明按钮样式（透传给 CameraAlbum，默认 false）。 */
  translucent?: boolean;
}) {
  const camRef = useRef<HTMLInputElement>(null);
  const albRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(
    fileId ? `${apiBase()}/files/${fileId}` : null
  );

  async function handleFile(f: File | undefined) {
    if (!f) return;
    try {
      const data = await fileApi.upload(f, bizType);
      setPreview(data.url);
      onChange(data.file_id);
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "上传失败");
    }
  }

  /** 重拍：拍照 / 相册二选一。 */
  function retake() {
    ActionSheet.show({
      actions: [
        {
          key: "camera",
          text: (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <CameraIcon size={18} /> 拍照
            </span>
          ),
        },
        {
          key: "album",
          text: (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <AlbumIcon size={18} /> 从相册选择
            </span>
          ),
        },
      ],
      cancelText: "取消",
      onAction: (a) => {
        if (a.key === "camera") camRef.current?.click();
        else if (a.key === "album") albRef.current?.click();
      },
    });
  }

  return (
    <div>
      <input
        ref={camRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={(e) => { void handleFile(e.target.files?.[0]); e.target.value = ""; }}
      />
      <input
        ref={albRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => { void handleFile(e.target.files?.[0]); e.target.value = ""; }}
      />
      {preview ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <FileImage url={preview} size={56} />
          <Button
            size="mini"
            fill="outline"
            color="danger"
            onClick={() => {
              setPreview(null);
              onChange(undefined);
            }}
          >
            删除
          </Button>
          <Button size="mini" fill="outline" onClick={retake}>
            重拍
          </Button>
        </div>
      ) : (
        <CameraAlbum translucent={translucent} onPick={(f) => void handleFile(f)} />
      )}
    </div>
  );
}
