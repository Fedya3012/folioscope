import { useEffect, useRef, useState } from "react";
import { renderPage } from "../lib/api";
import { useStore } from "../store";

const BASE_WIDTH = 800; // px ở zoom 100%

function PageView({ path, index, w, h }: { path: string; index: number; w: number; h: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    setSrc(null);
    const node = ref.current;
    if (!node) return;
    let cancelled = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        io.disconnect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        renderPage(path, index, Math.round(w * dpr))
          .then((r) => { if (!cancelled) setSrc(`data:image/png;base64,${r.png_base64}`); })
          .catch(() => { /* trang lỗi vẫn hiện khung trắng */ });
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(node);
    return () => { cancelled = true; io.disconnect(); };
  }, [path, index, w]);

  return (
    <div ref={ref} className={`page${src ? "" : " loading"}`} style={{ width: w, height: h }} data-page={index}>
      {src && <img src={src} width={w} height={h} alt={`Trang ${index + 1}`} draggable={false} />}
    </div>
  );
}

export function Viewer() {
  const { path, info, zoom } = useStore();
  if (!path || !info) return null;
  const width = Math.round(BASE_WIDTH * zoom);
  return (
    <div className="pages" aria-label="Các trang tài liệu">
      {info.page_sizes.map(([pw, ph], i) => (
        <PageView key={i} path={path} index={i} w={width} h={Math.round((width * ph) / pw)} />
      ))}
    </div>
  );
}
