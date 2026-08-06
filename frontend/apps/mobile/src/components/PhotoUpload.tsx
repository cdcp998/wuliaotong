import { useRef, useState } from "react";
import { Button, Toast } from "antd-mobile";

import { fileApi } from "@wlt/shared";

/** 拍照/选图上传（可选）：返回 file_id，展示已拍缩略图。 */
export function PhotoUpload({
  bizType,
  fileId,
  onChange,
}: {
  bizType: string;
  fileId?: number;
  onChange: (fileId: number | undefined) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(
    fileId ? `/api/v1/files/${fileId}` : null
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

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
      {preview ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <img src={preview} alt="已拍" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 8 }} />
          <Button
            size="mini"
            fill="outline"
            color="danger"
            onClick={() => {
              setPreview(null);
              onChange(undefined);
            }}
          >
            重拍
          </Button>
        </div>
      ) : (
        <Button size="mini" fill="outline" onClick={() => inputRef.current?.click()}>
          拍照记录(可选)
        </Button>
      )}
    </div>
  );
}
