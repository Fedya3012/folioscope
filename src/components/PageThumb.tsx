import { useEffect, useRef, useState } from "react";
import { bucketFor, requestThumb } from "../lib/thumbs";
import { displaySize, type PageItem } from "../lib/organizer";

/** Khung hiển thị của một ô: luôn rộng bằng cỡ thumbnail, trang ngang thì thấp hơn. */
export function tileBox(p: PageItem, thumb: number): [number, number] {
  const [dw, dh] = displaySize(p);
  const scale = Math.min(thumb / dw, (thumb * 1.33) / dh);
  return [Math.round(dw * scale), Math.round(dh * scale)];
}

export function Thumb({ item, bw, bh }: { item: PageItem; bw: number; bh: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // ảnh luôn vẽ theo chiều gốc rồi xoay bằng CSS, nên chiều của ảnh đổi chỗ khi xoay 90/270
  const turned = item.rot % 180 !== 0;
  const iw = turned ? bh : bw;
  const ih = turned ? bw : bh;
  const px = bucketFor(Math.round(iw * Math.min(window.devicePixelRatio || 1, 2)));

  useEffect(() => {
    const node = ref.current;
    if (!node || visible) return;
    const io = new IntersectionObserver(
      (e) => { if (e[0].isIntersecting) { setVisible(true); io.disconnect(); } },
      { rootMargin: "500px 0px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible || item.source === null) return;
    setFailed(false);
    return requestThumb(item.source, item.index, px, setSrc, () => setFailed(true));
  }, [visible, item.source, item.index, px]);

  return (
    <div ref={ref} className={`othumb${src || item.source === null ? "" : " loading"}`} style={{ width: bw, height: bh }}>
      {src && (
        <img
          src={src} width={iw} height={ih} draggable={false}
          alt={`Trang ${item.index + 1}`}
          style={{ transform: `translate(-50%, -50%) rotate(${item.rot}deg)` }}
        />
      )}
      {failed && <span className="ofail">Không vẽ được</span>}
    </div>
  );
}

/** Phần bị cắt đi được tô mờ, phần còn lại viền nét đứt (như Acrobat). */
export function CropShade({ item, bw }: { item: PageItem; bw: number }) {
  const c = item.crop;
  if (!c) return null;
  const [dw] = displaySize(item);
  const k = bw / dw;
  const l = c.l * k, t = c.t * k, r = c.r * k, b = c.b * k;
  return (
    <div className="ocrop" aria-hidden="true">
      <i style={{ left: 0, top: 0, right: 0, height: t }} />
      <i style={{ left: 0, bottom: 0, right: 0, height: b }} />
      <i style={{ left: 0, top: t, bottom: b, width: l }} />
      <i style={{ right: 0, top: t, bottom: b, width: r }} />
      <u style={{ left: l, top: t, right: r, bottom: b }} />
    </div>
  );
}

/** Số trang sẽ được in, đặt đúng góc đã chọn (kích thước theo tỉ lệ ô). */
export function StampBadge({ item, bw }: { item: PageItem; bw: number }) {
  const st = item.stamp;
  if (!st) return null;
  const [dw] = displaySize(item);
  const k = bw / dw;
  const c = item.crop ?? { l: 0, t: 0, r: 0, b: 0 };
  const style: React.CSSProperties = { fontSize: Math.max(6, st.size * k), [st.pos[0] === "t" ? "top" : "bottom"]: st.margin * k };
  const h = st.pos[1];
  if (h === "l") style.left = st.margin * k;
  else if (h === "r") style.right = st.margin * k;
  else { style.left = "50%"; style.transform = "translateX(-50%)"; }
  return (
    <div className="ostamp-area" style={{ left: c.l * k, top: c.t * k, right: c.r * k, bottom: c.b * k }} aria-hidden="true">
      <span className="ostamp" style={style}>{st.text}</span>
    </div>
  );
}
