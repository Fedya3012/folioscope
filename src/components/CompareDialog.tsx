import { useEffect, useMemo, useRef, useState } from "react";
import { getDocText, pickPdf, renderPage } from "../lib/api";
import { changedPages, diffDocuments, diffPixels, nextChanged, type PageDiff } from "../lib/compare";

type Mode = "text" | "image";
type Side = "a" | "b";
type Loaded = { path: string; pages: string[] };
type ImageResult = { a: string | null; b: string | null; overlay: string | null; ratio: number };

const IMG_WIDTH = 720;
const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

const loadImage = (b64: string) => new Promise<HTMLImageElement>((ok, fail) => {
  const img = new Image();
  img.onload = () => ok(img);
  img.onerror = () => fail(new Error("không đọc được ảnh trang"));
  img.src = `data:image/png;base64,${b64}`;
});

/** Dựng ảnh trang của hai bản và lớp phủ đỏ ở chỗ khác nhau. Bản thiếu trang thì để trống. */
async function compareImages(a: Loaded, b: Loaded, page: number): Promise<ImageResult> {
  const [ra, rb] = await Promise.all([
    page < a.pages.length ? renderPage(a.path, page, IMG_WIDTH) : null,
    page < b.pages.length ? renderPage(b.path, page, IMG_WIDTH) : null,
  ]);
  const [ia, ib] = await Promise.all([ra && loadImage(ra.png_base64), rb && loadImage(rb.png_base64)]);
  const h = Math.max(ia?.naturalHeight ?? 0, ib?.naturalHeight ?? 0, 1);
  const draw = (img: HTMLImageElement | null) => {
    const c = document.createElement("canvas");
    c.width = IMG_WIDTH; c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true })!;
    g.fillStyle = "#fff"; g.fillRect(0, 0, IMG_WIDTH, h);
    if (img) g.drawImage(img, 0, 0, IMG_WIDTH, img.naturalHeight);
    return { c, g };
  };
  const ca = draw(ia), cb = draw(ib);
  const { overlay, ratio } = diffPixels(ca.g.getImageData(0, 0, IMG_WIDTH, h).data, cb.g.getImageData(0, 0, IMG_WIDTH, h).data);
  const oc = document.createElement("canvas");
  oc.width = IMG_WIDTH; oc.height = h;
  oc.getContext("2d")!.putImageData(new ImageData(overlay as Uint8ClampedArray<ArrayBuffer>, IMG_WIDTH, h), 0, 0);
  return {
    a: ra && `data:image/png;base64,${ra.png_base64}`,
    b: rb && `data:image/png;base64,${rb.png_base64}`,
    overlay: oc.toDataURL(), ratio,
  };
}

function errorText(e: unknown): string {
  const t = String(e);
  if (t.includes("PASSWORD_REQUIRED") || t.includes("WRONG_PASSWORD")) return "File này có mật khẩu. Hãy mở file đó trong Folioscope và nhập mật khẩu trước, rồi so sánh lại.";
  return t;
}

export function CompareDialog({ initialA, onClose }: { initialA: string | null; onClose: () => void }) {
  const [files, setFiles] = useState<Record<Side, string | null>>({ a: initialA, b: null });
  const [docs, setDocs] = useState<Record<Side, Loaded | null>>({ a: null, b: null });
  const [mode, setMode] = useState<Mode>("text");
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [img, setImg] = useState<ImageResult | null>(null);
  const [imgBusy, setImgBusy] = useState(false);
  const [showOverlay, setShowOverlay] = useState(true);

  // Đọc chữ của hai bản mỗi khi đổi file.
  useEffect(() => {
    if (!files.a || !files.b) { setDocs({ a: null, b: null }); return; }
    let live = true;
    setBusy(true); setError(null);
    Promise.all([getDocText(files.a), getDocText(files.b)])
      .then(([a, b]) => { if (live) { setDocs({ a: { path: files.a!, pages: a }, b: { path: files.b!, pages: b } }); setPage(0); } })
      .catch((e) => { if (live) { setError(errorText(e)); setDocs({ a: null, b: null }); } })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [files.a, files.b]);

  const diffs: PageDiff[] = useMemo(() => (docs.a && docs.b ? diffDocuments(docs.a.pages, docs.b.pages) : []), [docs]);
  const changed = useMemo(() => changedPages(diffs), [diffs]);
  const total = diffs.length;
  const cur = diffs[page];

  // Chế độ "Theo hình": dựng ảnh của trang đang xem.
  useEffect(() => {
    if (mode !== "image" || !docs.a || !docs.b) return;
    let live = true;
    setImgBusy(true); setImg(null);
    compareImages(docs.a, docs.b, page)
      .then((r) => { if (live) setImg(r); })
      .catch((e) => { if (live) setError(errorText(e)); })
      .finally(() => { if (live) setImgBusy(false); });
    return () => { live = false; };
  }, [mode, docs, page]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onClose]);

  // Cuộn đồng bộ hai cột; cờ `syncing` chặn vòng lặp sự kiện cuộn.
  const refs = { a: useRef<HTMLDivElement>(null), b: useRef<HTMLDivElement>(null) };
  const syncing = useRef(false);
  const sync = (from: Side) => {
    if (syncing.current) { syncing.current = false; return; }
    const src = refs[from].current, dst = refs[from === "a" ? "b" : "a"].current;
    if (!src || !dst) return;
    syncing.current = true;
    dst.scrollTop = src.scrollTop; dst.scrollLeft = src.scrollLeft;
  };

  const pick = async (side: Side) => { const p = await pickPdf(); if (p) setFiles((f) => ({ ...f, [side]: p })); };
  const go = (i: number) => setPage(Math.max(0, Math.min(total - 1, i)));
  const jump = (dir: 1 | -1) => { const n = nextChanged(changed, page, dir); if (n != null) setPage(n); };

  const sideText = (side: Side) => {
    if (!cur) return null;
    const missing = (side === "a" ? docs.a : docs.b)!.pages.length <= page;
    if (missing) return <em className="cmp-missing">{side === "a" ? "Bản cũ không có trang này" : "Bản mới không có trang này"}</em>;
    return cur.segs.map((s, i) => {
      if (s.kind === "eq") return <span key={i}>{s.text}</span>;
      if ((side === "a") === (s.kind === "del")) return <mark key={i} className={s.kind}>{s.text}</mark>;
      return null;
    });
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal compare" role="dialog" aria-modal="true" aria-labelledby="cmp-title">
        <header>
          <h2 id="cmp-title">So sánh hai bản PDF</h2>
          <button className="btn ghost icon" aria-label="Đóng" onClick={onClose}>✕</button>
        </header>

        <div className="cmp-files">
          {(["a", "b"] as Side[]).map((side) => (
            <div key={side} className="cmp-file">
              <span className="cmp-tag">{side === "a" ? "Bản cũ" : "Bản mới"}</span>
              <span className="cmp-name" title={files[side] ?? ""}>{files[side] ? baseName(files[side]!) : "Chưa chọn file"}</span>
              <button className="btn secondary" onClick={() => void pick(side)}>{files[side] ? "Đổi…" : "Chọn file…"}</button>
            </div>
          ))}
          <button className="btn ghost" disabled={!files.a && !files.b} onClick={() => setFiles((f) => ({ a: f.b, b: f.a }))}>⇄ Đổi bên</button>
        </div>

        {error && <p role="alert" className="notice err cmp-note">{error}</p>}
        {busy && <p className="cmp-note" role="status">Đang đọc hai file…</p>}
        {!busy && !error && !(docs.a && docs.b) && <p className="cmp-note">Chọn bản cũ và bản mới của cùng một tài liệu để thấy chỗ nào đã đổi.</p>}

        {docs.a && docs.b && (
          <>
            <div className="cmp-bar">
              <div className="segmented" role="radiogroup" aria-label="Cách so sánh">
                <button role="radio" aria-checked={mode === "text"} onClick={() => setMode("text")}>Theo chữ</button>
                <button role="radio" aria-checked={mode === "image"} onClick={() => setMode("image")}>Theo hình</button>
              </div>
              <button className="btn ghost" aria-label="Trang trước" disabled={page === 0} onClick={() => go(page - 1)}>‹</button>
              <span>Trang {page + 1} / {total}</span>
              <button className="btn ghost" aria-label="Trang sau" disabled={page >= total - 1} onClick={() => go(page + 1)}>›</button>
              <button className="btn secondary" disabled={!changed.length} onClick={() => jump(-1)}>↑ Chỗ khác trước</button>
              <button className="btn secondary" disabled={!changed.length} onClick={() => jump(1)}>↓ Chỗ khác sau</button>
              {mode === "image" && (
                <label className="cmp-check"><input type="checkbox" checked={showOverlay} onChange={(e) => setShowOverlay(e.target.checked)} /> Tô đỏ chỗ khác</label>
              )}
              <span className="spacer" />
              <span className="cmp-sum" role="status">
                {changed.length ? `${changed.length} trang có thay đổi` : "Hai bản giống nhau về chữ"}
                {mode === "text" && cur?.changed ? ` · trang này: +${cur.added} từ, −${cur.removed} từ` : ""}
                {mode === "image" && img ? ` · khác ${(img.ratio * 100).toFixed(1)}% diện tích` : ""}
              </span>
            </div>

            <div className="cmp-cols">
              {(["a", "b"] as Side[]).map((side) => (
                <div key={side} className="cmp-col">
                  <div className="cmp-col-title">{side === "a" ? "Bản cũ" : "Bản mới"} · <span>{baseName(files[side]!)}</span></div>
                  <div className="cmp-scroll" ref={refs[side]} onScroll={() => sync(side)}>
                    {mode === "text" ? (
                      <div className="cmp-text">{sideText(side)}</div>
                    ) : imgBusy || !img ? (
                      <p className="cmp-note" role="status">Đang dựng ảnh trang…</p>
                    ) : img[side] ? (
                      <div className="cmp-page">
                        <img src={img[side]!} alt={`${side === "a" ? "Bản cũ" : "Bản mới"}, trang ${page + 1}`} />
                        {side === "b" && showOverlay && img.overlay && <img className="cmp-overlay" src={img.overlay} alt="" />}
                      </div>
                    ) : (
                      <em className="cmp-missing">{side === "a" ? "Bản cũ" : "Bản mới"} không có trang này</em>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <p className="cmp-legend"><mark className="del">chữ bị xoá hoặc sửa</mark> <mark className="add">chữ mới thêm hoặc sửa</mark> · hai trang cùng số thứ tự được so với nhau</p>
          </>
        )}
      </div>
    </div>
  );
}
