/** 图标集（SVG path 绘制，自定义 path 数据）：
 *  stroke 风格与 TabLayout/Home 现有图标一致（strokeWidth 1.8、round 端点），
 *  用于替代界面中的 emoji 图标（开发规范 §2.5：不使用 emoji 作图标）。
 *  - CameraIcon：相机轮廓 + 镜头圆
 *  - AlbumIcon：图片相框 + 圆点 + 山形折线
 *  - PlusIcon：加号
 *  - WarnIcon：警示三角 + 感叹号
 */
export function CameraIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h3.2L9 5h6l1.8 2H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" />
      <circle cx="12" cy="14" r="3.5" />
    </svg>
  );
}

export function AlbumIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="m5.5 17 4.5-4.5 2.5 2.5 3-3L19 16" />
    </svg>
  );
}

export function PlusIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function WarnIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.3 4.3 2.9 17.2a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z" />
      <path d="M12 9.5v4.5" />
      <path d="M12 17.2h.01" />
    </svg>
  );
}
