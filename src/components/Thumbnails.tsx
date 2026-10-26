import { useEffect, useRef, useState } from "react";
import { renderPage } from "../lib/api";
import { useStore } from "../store";

const THUMB_W = 140;
const cache = new Map<string, string>(); // "đường dẫn#trang" → ảnh, để cuộn qua lại không vẽ lại

function Thumb({ path, index, size }: { path: string; index: number; size: [number, number] }) {
  const key = `${path}#${index}`;
  const ref = useRef<HTMLButtonElement>(null);
  const [src, setSrc] = useState<string | null>(cache.get(key) ?? null);
  const current = useStore((s) => s.currentPage === index);
  const goToPage = useStore((s) => s.goToPage);
  const h = Math.round((THUMB_W * size[1]) / size[0]);

  useEffect(() => {
    const node = ref.current;
    if (!node || cache.has(key)) return;
    let cancelled = false;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      renderPage(path, index, Math.round(THUMB_W * dpr)).then((r) => {
        const url = `data:image/png;base64,${r.png_base64}`;
        cache.set(key, url);
        if (!cancelled) setSrc(url);
      }).catch(() => {});
    }, { rootMargin: "300px 0px" });
    io.observe(node);
    return () => { cancelled = true; io.disconnect(); };
  }, [key, path, index]);

  // Giữ hình thu nhỏ của trang đang đọc luôn trong tầm nhìn của panel.
  // Cuộn riêng panel (scrollIntoView sẽ làm trượt cả cửa sổ app).
  useEffect(() => {
    const el = ref.current, panel = el?.closest<HTMLElement>(".panel");
    if (!current || !el || !panel) return;
    const e = el.getBoundingClientRect(), p = panel.getBoundingClientRect();
    if (e.top < p.top + 40) panel.scrollTop += e.top - p.top - 48;
    else if (e.bottom > p.bottom) panel.scrollTop += e.bottom - p.bottom + 8;
  }, [current]);

  return (
    <button ref={ref} className="thumb" aria-current={current} aria-label={`Trang ${index + 1}`} onClick={() => goToPage(index)}>
      <span className={`thumb-img${src ? "" : " loading"}`} style={{ width: THUMB_W, height: h }}>
        {src && <img src={src} width={THUMB_W} height={h} alt="" draggable={false} />}
      </span>
      <span className="thumb-label">{index + 1}</span>
    </button>
  );
}

export function Thumbnails() {
  const { path, info } = useStore();
  if (!path || !info) return <p className="body">Chưa có tài liệu.</p>;
  return (
    <div className="thumbs">
      {info.page_sizes.map((s, i) => <Thumb key={`${path}#${i}`} path={path} index={i} size={s} />)}
    </div>
  );
}
