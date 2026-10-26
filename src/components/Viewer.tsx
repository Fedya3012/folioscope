import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getTextRuns, renderPage, type NormRect, type TextRun } from "../lib/api";
import { PAGE_GAP, PAGE_PAD, fitPageZoom, fitWidthZoom, pageAtScroll, pageHeightPx, pageOffsets, pageWidthPx, wheelZoom } from "../lib/viewer";
import { useStore } from "../store";

/** Giới hạn bề rộng ảnh vẽ để zoom rất lớn không ngốn bộ nhớ; ảnh được CSS kéo giãn tiếp. */
const MAX_RENDER_WIDTH = 4096;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

const pct = (v: number) => `${v * 100}%`;
const rectStyle = ([l, t, w, h]: NormRect) => ({ left: pct(l), top: pct(t), width: pct(w), height: pct(h) });

/** Lớp chữ trong suốt đặt đúng chỗ chữ thật, để trình duyệt chọn và sao chép được. */
function TextLayer({ path, index, w, h }: { path: string; index: number; w: number; h: number }) {
  const [runs, setRuns] = useState<TextRun[]>([]);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    getTextRuns(path, index).then((r) => { if (!cancelled) setRuns(r); }).catch(() => {});
    return () => { cancelled = true; };
  }, [path, index]);

  // Co giãn từng đoạn chữ ngang cho vừa đúng bề rộng thật trên trang.
  useLayoutEffect(() => {
    root.current?.querySelectorAll<HTMLSpanElement>("span").forEach((el, i) => {
      el.style.transform = "none";
      const natural = el.scrollWidth;
      const target = runs[i].rect[2] * w;
      if (natural > 0) el.style.transform = `scaleX(${target / natural})`;
    });
  }, [runs, w, h]);

  return (
    <div ref={root} className="textlayer">
      {runs.map((r, i) => (
        <span key={i} style={{ left: pct(r.rect[0]), top: pct(r.rect[1]), fontSize: Math.max(1, r.rect[3] * h), lineHeight: `${r.rect[3] * h}px` }}>{r.text}</span>
      ))}
    </div>
  );
}

function PageView({ path, index, w, h }: { path: string; index: number; w: number; h: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  const tool = useStore((s) => s.tool);
  const hits = useStore((s) => s.search.hits);
  const active = useStore((s) => s.search.active);
  // Chờ zoom ổn định rồi mới vẽ lại, tránh vẽ hàng chục lần khi lăn chuột.
  const renderW = useDebounced(w, 150);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { rootMargin: "800px 0px" });
    io.observe(node);
    return () => io.disconnect();
  }, []);

  useEffect(() => { setSrc(null); }, [path, index]);

  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderPage(path, index, Math.min(MAX_RENDER_WIDTH, Math.round(renderW * dpr)))
      .then((r) => { if (!cancelled) setSrc(`data:image/png;base64,${r.png_base64}`); })
      .catch(() => { /* trang lỗi vẫn hiện khung trắng */ });
    return () => { cancelled = true; };
  }, [near, path, index, renderW]);

  const pageHits = useMemo(
    () => hits.map((hit, i) => ({ hit, i })).filter(({ hit }) => hit.page === index),
    [hits, index],
  );

  return (
    <div ref={ref} className={`page${src ? "" : " loading"}`} style={{ width: w, height: h }} data-page={index}>
      {src && <img src={src} width={w} height={h} alt={`Trang ${index + 1}`} draggable={false} />}
      {pageHits.map(({ hit, i }) => hit.rects.map((r, k) => (
        <div key={`${i}-${k}`} className={`hit${i === active ? " active" : ""}`} style={rectStyle(r)} />
      )))}
      {near && src && tool === "select" && <TextLayer path={path} index={index} w={w} h={h} />}
    </div>
  );
}

export function Viewer() {
  const { path, info, zoom, fit, viewMode, currentPage, nav, tool, pageTheme } = useStore();
  const scroller = useRef<HTMLDivElement>(null);
  const sizes = info?.page_sizes ?? [];
  const { tops, total } = useMemo(() => pageOffsets(sizes, zoom), [sizes, zoom]);
  const lastScroll = useRef(0); // tỉ lệ cuộn trước khi zoom đổi, để giữ nguyên chỗ đang đọc

  // Tự tính lại zoom khi đang ở chế độ "vừa bề rộng/vừa trang" và cửa sổ đổi cỡ.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !fit || !sizes.length) return;
    const apply = () => {
      const z = fit === "width" ? fitWidthZoom(el.clientWidth, sizes) : fitPageZoom(el.clientWidth, el.clientHeight, sizes[useStore.getState().currentPage] ?? sizes[0]);
      if (Math.abs(z - useStore.getState().zoom) > 1e-4) useStore.getState().setZoom(z, fit);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit, sizes, viewMode, currentPage]);

  // Giữ vị trí đọc tương đối khi zoom đổi (chế độ cuộn liên tục).
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && viewMode === "continuous") el.scrollTop = lastScroll.current * el.scrollHeight;
  }, [zoom, viewMode]);

  // Ctrl + lăn chuột để zoom (phải là listener không-thụ-động mới chặn được zoom của trình duyệt).
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      useStore.getState().setZoom(wheelZoom(useStore.getState().zoom, e.deltaY));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Cuộn tới trang/vị trí được yêu cầu (bấm hình thu nhỏ, mục lục, kết quả tìm, nhập số trang…).
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !info || nav.nonce === 0) return;
    if (viewMode === "single") { el.scrollTop = 0; return; }
    const ph = pageHeightPx(sizes[nav.page]?.[1] ?? 0, zoom);
    const offset = nav.y == null ? 0 : Math.max(0, nav.y * ph - el.clientHeight / 3);
    el.scrollTop = (tops[nav.page] ?? 0) - (nav.y == null ? PAGE_PAD / 2 : 0) + offset;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav.nonce]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el || viewMode !== "continuous") return;
    lastScroll.current = el.scrollTop / Math.max(1, el.scrollHeight);
    const page = pageAtScroll(tops, el.scrollTop, el.clientHeight);
    if (page !== useStore.getState().currentPage) useStore.getState().setPage(page);
  };

  // Công cụ bàn tay: kéo để cuộn/di chuyển trang. Nút giữa chuột luôn kéo được.
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    const el = scroller.current;
    if (!el || !(tool === "hand" || e.button === 1)) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const el = scroller.current, d = drag.current;
    if (!el || !d) return;
    el.scrollLeft = d.left - (e.clientX - d.x);
    el.scrollTop = d.top - (e.clientY - d.y);
  };
  const endDrag = () => { drag.current = null; };

  if (!path || !info) return null;
  const pageEl = (i: number) => (
    <PageView key={i} path={path} index={i} w={pageWidthPx(sizes[i][0], zoom)} h={pageHeightPx(sizes[i][1], zoom)} />
  );

  return (
    <div
      ref={scroller}
      className={`viewer ${tool} paper-${pageTheme}`}
      onScroll={onScroll}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      aria-label="Các trang tài liệu"
    >
      {viewMode === "continuous" ? (
        <div className="pages" style={{ minHeight: total, gap: PAGE_GAP, padding: PAGE_PAD }}>
          {sizes.map((_, i) => pageEl(i))}
        </div>
      ) : (
        <div className="pages single" style={{ padding: PAGE_PAD }}>{pageEl(currentPage)}</div>
      )}
    </div>
  );
}
