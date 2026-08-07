import { useEffect, useRef, useState } from "react";
import { Button, NavBar, Popup, Toast } from "antd-mobile";

import { fileApi, ocrApi } from "@wlt/shared";
import type { ReaderOptions } from "zxing-wasm/reader";

// zxing-cpp WASM 以静态资源导入（带 hash、自动 base 前缀，与 JS 同目录，部署必配）
import zxingWasmUrl from "../assets/zxing_reader.wasm?url";

/** 条码扫描模块：摄像头实时扫码（zxing-cpp WASM 解码，与服务端同源，EAN/CODE128/QR 等全格式）。
 * 摄像头不可用/权限拒绝/非 HTTPS → 自动退化为拍照/相册选图 → 服务端解码。 */
export function BarcodeScanner({
  visible,
  onClose,
  onScan,
  autoClose = true,
}: {
  visible: boolean;
  onClose: () => void;
  onScan: (code: string) => void;
  /** 扫码成功后是否自动关闭（默认 true）；调用方需要异步处理后自行关闭时传 false。 */
  autoClose?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanTimerRef = useRef<number>(0); // 手动帧循环定时器
  const noDetectTimerRef = useRef<number>(0);
  const finishedRef = useRef(false);
  const camRef = useRef<HTMLInputElement>(null);
  const albRef = useRef<HTMLInputElement>(null);
  const [cameraOk, setCameraOk] = useState(false);
  const [zxingFail, setZxingFail] = useState<string | null>(null); // 解码库加载失败原因（null=正常）
  const [torchOn, setTorchOn] = useState(false);
  const [decoding, setDecoding] = useState(false);
  const [noDetectTip, setNoDetectTip] = useState(false);

  /** 停止摄像头、解码循环与提示定时器。 */
  function stopCamera() {
    if (scanTimerRef.current) {
      window.clearTimeout(scanTimerRef.current);
      scanTimerRef.current = 0;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  /** 扫码成功：只回调一次；默认自动关闭，autoClose=false 时由调用方在 onScan 回调中自行关闭。 */
  function finish(code: string) {
    if (finishedRef.current) return;
    finishedRef.current = true;
    stopCamera();
    onScan(code);
    if (autoClose) onClose();
  }

  /** 拍照/相册兜底：上传图片 → 服务端解码。 */
  async function handleFile(f: File | undefined) {
    if (!f || decoding) return;
    setDecoding(true);
    try {
      const up = await fileApi.upload(f, "ocr");
      const data = await ocrApi.decodeBarcode(up.file_id);
      finish(data.barcode);
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "未识别到条码");
    } finally {
      setDecoding(false);
    }
  }

  /** 启动 zxing-cpp WASM 手动帧循环解码：canvas 拉帧（长边≤720 提速）→ readBarcodes 全格式解码，
   * 约 300ms/帧；与服务端同源（zxing-cpp）。不依赖相机就绪——与 getUserMedia 并行预加载 WASM。
   * 加载失败时把具体原因写入 zxingFail 显示在界面，便于定位。 */
  async function startZxing() {
    try {
      const { readBarcodes, prepareZXingModule } = await import("zxing-wasm/reader");
      // 指定本地 WASM 并预热（消除默认 jsDelivr CDN 依赖）；失败会抛出具体原因
      await prepareZXingModule({
        overrides: { locateFile: () => zxingWasmUrl },
        fireImmediately: true,
      });
      const options: ReaderOptions = {
        tryHarder: true,
        formats: [
          "EAN13", "EAN8", "Code128", "Code39", "Code93", "ITF", "UPCA", "UPCE", "Codabar", "QRCode", "DataMatrix",
        ] as ReaderOptions["formats"],
      };
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        setZxingFail("canvas 不可用");
        return;
      }
      const scanOnce = async () => {
        if (finishedRef.current) return;
        const v = videoRef.current;
        if (v && v.readyState >= 2 && v.videoWidth > 0) {
          const scale = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight));
          canvas.width = Math.max(2, Math.round(v.videoWidth * scale));
          canvas.height = Math.max(2, Math.round(v.videoHeight * scale));
          ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
          try {
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const results = await readBarcodes(imageData, options);
            const text = results[0]?.text?.trim();
            if (text) {
              finish(text);
              return;
            }
          } catch {
            // 本帧解码异常/未识别到：下一帧继续
          }
        }
        scanTimerRef.current = window.setTimeout(() => void scanOnce(), 300);
      };
      void scanOnce();
    } catch (e) {
      // 动态加载/WASM 实例化失败 → 界面显示具体原因（拍照/相册仍可用）
      console.error("实时扫码解码库加载失败:", e);
      setZxingFail(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    if (!visible) return;
    finishedRef.current = false;
    setCameraOk(false);
    setZxingFail(null);
    setTorchOn(false);
    setNoDetectTip(false);
    let cancelled = false;
    // 解码库（WASM）与摄像头权限请求并行预加载，互不等待
    const zxingPromise = startZxing();
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "environment",
            // 限制采集分辨率：解码更快更稳（iOS 默认 1080p 全帧解码慢且易漏检）
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const v = videoRef.current;
        if (!v) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        v.srcObject = stream;
        await v.play();
        setCameraOk(true);
        // 长时间未识别到提示：8s 后提示可拍照/相册选图
        noDetectTimerRef.current = window.setTimeout(() => setNoDetectTip(true), 8000);
        await zxingPromise; // 等待解码库就绪（已并行加载）；失败时 zxingFail 已置位
      } catch {
        // 摄像头不可用/权限拒绝/非 HTTPS → 拍照/相册兜底
        setCameraOk(false);
      }
    })();
    return () => {
      cancelled = true;
      if (noDetectTimerRef.current) {
        window.clearTimeout(noDetectTimerRef.current);
        noDetectTimerRef.current = 0;
      }
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  /** 手电筒（尽力而为：部分设备/浏览器不支持）。 */
  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) {
      Toast.show("摄像头未开启");
      return;
    }
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn }] } as unknown as MediaTrackConstraints);
      setTorchOn((v) => !v);
    } catch {
      Toast.show("当前设备不支持手电筒");
    }
  }

  return (
    <Popup visible={visible} onMaskClick={onClose} bodyStyle={{ height: "100vh", background: "#000" }} destroyOnClose>
      <div style={{ height: "100%", position: "relative", overflow: "hidden" }}>
        <video ref={videoRef} playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        {/* 取景框 */}
        <div style={{ position: "absolute", inset: 0, display: "flex", pointerEvents: "none" }}>
          <div
            style={{
              width: 240,
              height: 240,
              margin: "auto",
              border: "2px solid rgba(255,255,255,.9)",
              borderRadius: 16,
              boxShadow: "0 0 0 9999px rgba(0,0,0,.35)",
            }}
          />
        </div>
        {!cameraOk && (
          <div
            style={{
              position: "absolute",
              left: 24,
              right: 24,
              top: "42%",
              background: "rgba(0,0,0,.72)",
              borderRadius: 12,
              padding: "14px 16px",
              color: "#fff",
              fontSize: 13,
              lineHeight: 1.6,
              textAlign: "center",
            }}
          >
            当前浏览器/设备不支持摄像头扫码（或权限被拒绝），请使用下方「拍照 / 相册」选择条码图片识别
          </div>
        )}
        {cameraOk && zxingFail && (
          <div
            style={{
              position: "absolute",
              left: 24,
              right: 24,
              top: "20%",
              background: "rgba(0,0,0,.72)",
              borderRadius: 12,
              padding: "12px 16px",
              color: "#fff",
              fontSize: 13,
              lineHeight: 1.6,
              textAlign: "center",
            }}
          >
            实时扫码组件加载失败（{zxingFail.length > 60 ? `${zxingFail.slice(0, 60)}…` : zxingFail}），请使用下方「拍照 / 相册」识别条码
          </div>
        )}
        {cameraOk && !zxingFail && noDetectTip && (
          <div
            style={{
              position: "absolute",
              left: 24,
              right: 24,
              top: "20%",
              background: "rgba(0,0,0,.72)",
              borderRadius: 12,
              padding: "12px 16px",
              color: "#fff",
              fontSize: 13,
              lineHeight: 1.6,
              textAlign: "center",
            }}
          >
            长时间未识别到条码？请将条码完整对准取景框，或点击下方「拍照 / 相册」选图识别
          </div>
        )}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0 }}>
          <NavBar onBack={onClose} style={{ background: "rgba(0,0,0,.35)", color: "#fff", "--adm-color-text": "#fff" } as React.CSSProperties}>
            扫描条码
          </NavBar>
        </div>
        <div style={{ position: "absolute", bottom: 28, left: 0, right: 0, display: "flex", gap: 12, justifyContent: "center" }}>
          <Button style={{ minWidth: 96 }} disabled={!cameraOk} onClick={() => void toggleTorch()}>
            {torchOn ? "🔦 关闭" : "🔦 手电筒"}
          </Button>
          <Button style={{ minWidth: 96 }} onClick={() => camRef.current?.click()}>
            📷 拍照
          </Button>
          <Button style={{ minWidth: 96 }} loading={decoding} onClick={() => albRef.current?.click()}>
            🖼 相册
          </Button>
        </div>
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
      </div>
    </Popup>
  );
}
