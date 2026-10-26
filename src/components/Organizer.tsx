import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { useOrganizer } from "../organizerStore";
import { bucketFor, cachedThumb, requestThumb } from "../lib/thumbs";
import { displaySize, dropIndex, intersects, type PageItem, type Rect } from "../lib/organizer";

const THUMB_MIN = 96;
const THUMB_MAX = 360;
const GROUP_COLORS = ["#3D63EE", "#1F9D61", "#F5B700", "#DC3B3B", "#6B5BD6", "#1F7FC4"];

/** Khung hiển thị của một ô: luôn rộng bằng cỡ thumbnail, trang ngang thì thấp hơn. */
function tileBox(p: PageItem, thumb: number): [number, number] {
  const [dw, dh] = displaySize(p);
  const scale = Math.min(thumb / dw, (thumb * 1.33) / dh);
  return [Math.round(dw * scale), Math.round(dh * scale)];
}

function Thumb({ item, bw, bh }: { item: PageItem; bw: number; bh: number }) {
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

type Drag = { ids: string[]; x: number; y: number; insertAt: number | null };
type Marquee = { x0: number; y0: number; x1: number; y1: number };

export function Organizer() {
  const path = useStore((s) => s.path);
  const info = useStore((s) => s.info);
  const load = useStore((s) => s.load);
  const setMode = useStore((s) => s.setMode);
  const o = useOrganizer();
  const { items, selected, thumb, busy, toast } = o;

  useEffect(() => { o.sync(path, info); }, [path, info]); // eslint-disable-line react-hooks/exhaustive-deps

  const scroller = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const [indicator, setIndicator] = useState<{ left: number; top: number; height: number } | null>(null);
  const [menu, setMenu] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);

  const dirty = o.history.past.length > 0;
  const groupOf = useMemo(() => {
    const order = [...new Set(items.map((p) => p.source))];
    return order.length > 1 ? (p: PageItem) => GROUP_COLORS[order.indexOf(p.source) % GROUP_COLORS.length] : null;
  }, [items]);

  const tileRects = useCallback((): { rects: Rect[]; origin: DOMRect } | null => {
    const g = grid.current;
    if (!g) return null;
    const tiles = g.querySelectorAll<HTMLElement>("[data-tile]");
    const rects = Array.from(tiles, (t) => t.querySelector<HTMLElement>(".obox")!.getBoundingClientRect());
    return { rects, origin: g.getBoundingClientRect() };
  }, []);

  /** Tính vị trí thả và vạch chèn tại toạ độ con trỏ. */
  const aim = useCallback((x: number, y: number) => {
    const t = tileRects();
    if (!t || !dragRef.current) return;
    const at = dropIndex(t.rects, x, y);
    dragRef.current = { ...dragRef.current, x, y, insertAt: at };
    setDrag(dragRef.current);
    const { rects, origin } = t;
    if (rects.length === 0) { setIndicator(null); return; }
    const prev = rects[at - 1];
    const next = rects[at];
    // đầu hàng mới: vạch nằm sau ô cuối hàng trước thay vì trước ô đầu hàng sau
    const atRowEnd = prev && (!next || next.top >= prev.bottom - 2);
    const r = atRowEnd ? prev : next;
    setIndicator({
      left: (atRowEnd ? r.right + 10 : r.left - 10) - origin.left - 1.5,
      top: r.top - origin.top,
      height: r.bottom - r.top,
    });
  }, [tileRects]);

  // Cuộn lưới khi kéo sát mép trên/dưới, càng sát càng nhanh.
  useEffect(() => {
    if (!drag) return;
    const timer = window.setInterval(() => {
      const s = scroller.current, d = dragRef.current;
      if (!s || !d) return;
      const r = s.getBoundingClientRect();
      const zone = 64;
      let dy = 0;
      if (d.y < r.top + zone) dy = -Math.ceil(((r.top + zone - d.y) / zone) * 24);
      else if (d.y > r.bottom - zone) dy = Math.ceil(((d.y - (r.bottom - zone)) / zone) * 24);
      if (dy) { s.scrollTop += dy; aim(d.x, d.y); }
    }, 24);
    return () => window.clearInterval(timer);
  }, [!!drag, aim]); // eslint-disable-line react-hooks/exhaustive-deps

  const onTileDown = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0 || busy) return;
    const mod = { toggle: e.ctrlKey || e.metaKey, range: e.shiftKey };
    const wasSelected = useOrganizer.getState().selected.has(id);
    const keepSelection = wasSelected && !mod.toggle && !mod.range;
    if (!keepSelection) o.click(id, mod);
    const sx = e.clientX, sy = e.clientY;
    let dragging = false;

    const move = (ev: PointerEvent) => {
      if (!dragging) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
        dragging = true;
        const sel = useOrganizer.getState().selected;
        const ids = sel.has(id) ? useOrganizer.getState().items.filter((p) => sel.has(p.id)).map((p) => p.id) : [id];
        dragRef.current = { ids, x: ev.clientX, y: ev.clientY, insertAt: null };
      }
      aim(ev.clientX, ev.clientY);
    };
    const finish = (drop: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", key);
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      setIndicator(null);
      if (dragging && drop && d && d.insertAt !== null) o.moveSelected(d.insertAt, new Set(d.ids));
      else if (!dragging && keepSelection) o.click(id, { toggle: false, range: false });
    };
    const up = () => finish(true);
    const key = (ev: KeyboardEvent) => { if (ev.key === "Escape") finish(false); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("keydown", key);
  };

  const onBackgroundDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("[data-tile]")) return;
    const g = grid.current;
    if (!g) return;
    const additive = e.ctrlKey || e.metaKey || e.shiftKey;
    const base = additive ? new Set(useOrganizer.getState().selected) : new Set<string>();
    if (!additive) o.clearSelection();
    const origin = g.getBoundingClientRect();
    const x0 = e.clientX - origin.left, y0 = e.clientY - origin.top;
    let moved = false;

    const move = (ev: PointerEvent) => {
      const now = g.getBoundingClientRect();
      const x1 = ev.clientX - now.left, y1 = ev.clientY - now.top;
      if (!moved && Math.hypot(x1 - x0, y1 - y0) < 4) return;
      moved = true;
      const box: Rect = { left: Math.min(x0, x1), top: Math.min(y0, y1), right: Math.max(x0, x1), bottom: Math.max(y0, y1) };
      setMarquee({ x0: box.left, y0: box.top, x1: box.right, y1: box.bottom });
      const hit = new Set(base);
      g.querySelectorAll<HTMLElement>("[data-tile]").forEach((t) => {
        const r = t.querySelector<HTMLElement>(".obox")!.getBoundingClientRect();
        const rel: Rect = { left: r.left - now.left, top: r.top - now.top, right: r.right - now.left, bottom: r.bottom - now.top };
        if (intersects(box, rel)) hit.add(t.dataset.id!);
      });
      o.setSelection(hit);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setMarquee(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Ctrl + cuộn chuột đổi cỡ thumbnail (cần listener không thụ động để chặn zoom của trình duyệt).
  useEffect(() => {
    const s = scroller.current;
    if (!s) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const t = useOrganizer.getState().thumb;
      o.setThumb(Math.max(THUMB_MIN, Math.min(THUMB_MAX, t + (e.deltaY < 0 ? 12 : -12))));
    };
    s.addEventListener("wheel", onWheel, { passive: false });
    return () => s.removeEventListener("wheel", onWheel);
  }, [items.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // Phím tắt: Delete xoá, Ctrl+A chọn hết, Ctrl+Z / Ctrl+Y hoàn tác, R xoay phải, Shift+R xoay trái, Esc bỏ chọn.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, [role=dialog]")) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "a") { e.preventDefault(); o.selectAll(); }
      else if (mod && k === "z") { e.preventDefault(); e.shiftKey ? o.redo() : o.undo(); }
      else if (mod && k === "y") { e.preventDefault(); o.redo(); }
      else if (!mod && (e.key === "Delete" || e.key === "Backspace")) { e.preventDefault(); o.remove(); }
      else if (!mod && k === "r") { e.preventDefault(); o.rotate(e.shiftKey ? -90 : 90); }
      else if (e.key === "Escape") o.clearSelection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [o]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => o.dismissToast(), toast.kind === "error" ? 9000 : 6000);
    return () => window.clearTimeout(t);
  }, [toast]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSave = async () => {
    const out = await o.save();
    if (!out) return;
    o.reset();
    await load(out);
    const st = useStore.getState();
    o.sync(st.path, st.info);
    useOrganizer.setState({ toast: { kind: st.error ? "error" : "info", text: st.error ?? `Đã lưu ${out}` } });
  };

  if (!path || !info) {
    return (
      <div className="empty">
        <h1>Chưa có tài liệu để sắp xếp</h1>
        <p>Mở một file PDF rồi chuyển sang chế độ Trang.</p>
      </div>
    );
  }

  const n = selected.size;
  const dragged = drag ? new Set(drag.ids) : null;
  const first = drag ? items.find((p) => p.id === drag.ids[0]) : null;
  const ghostSrc = first && first.source !== null
    ? cachedThumb(first.source, first.index, bucketFor(Math.round(thumb * 2))) ?? cachedThumb(first.source, first.index, bucketFor(thumb))
    : undefined;

  return (
    <div className="org">
      <div className="org-toolbar" role="toolbar" aria-label="Công cụ sắp xếp trang">
        <div className="org-menu">
          <button className="btn ghost" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} disabled={busy}>Chèn ▾</button>
          {menu && (
            <>
              <div className="org-backdrop" onClick={() => setMenu(false)} />
              <div className="org-popover" role="menu">
                <button role="menuitem" onClick={() => { setMenu(false); o.insertBlank(); }}>Trang trắng</button>
                <button role="menuitem" onClick={() => { setMenu(false); void o.insertFromFile(); }}>Từ file khác…</button>
              </div>
            </>
          )}
        </div>
        <button className="btn ghost" onClick={() => o.rotate(-90)} disabled={!n || busy} title="Xoay trái (Shift+R)">⟲ Xoay trái</button>
        <button className="btn ghost" onClick={() => o.rotate(90)} disabled={!n || busy} title="Xoay phải (R)">⟳ Xoay phải</button>
        <button className="btn ghost" onClick={o.remove} disabled={!n || busy} title="Xoá (Delete)">Xoá</button>
        <span className="org-sep" />
        <button className="btn ghost" onClick={() => void o.extract()} disabled={!n || busy}>Trích xuất…</button>
        <button className="btn ghost" onClick={() => setSplitOpen(true)} disabled={busy}>Tách file…</button>
        <button className="btn ghost" onClick={o.reverse} disabled={busy} title={n > 1 ? "Đảo thứ tự các trang đã chọn" : "Đảo thứ tự cả tài liệu"}>Đảo thứ tự</button>
        <span className="org-sep" />
        <button className="btn ghost" onClick={o.undo} disabled={!o.history.past.length || busy} title="Hoàn tác (Ctrl+Z)">↶</button>
        <button className="btn ghost" onClick={o.redo} disabled={!o.history.future.length || busy} title="Làm lại (Ctrl+Y)">↷</button>
        <span className="spacer" />
        <span className="org-count">Đã chọn {n} / {items.length} trang{dirty ? " · chưa lưu" : ""}</span>
        <input
          type="range" className="org-zoom" min={THUMB_MIN} max={THUMB_MAX} value={thumb}
          aria-label="Cỡ hình thu nhỏ" onChange={(e) => o.setThumb(Number(e.target.value))}
        />
        <button className="btn secondary" onClick={() => void onSave()} disabled={!dirty || busy}>{busy ? "Đang ghi…" : "Lưu thành…"}</button>
        <button className="btn primary" onClick={() => setMode("view")}>Xong</button>
      </div>

      <div className="org-scroll" ref={scroller} onPointerDown={onBackgroundDown}>
        <div className="org-grid" ref={grid} role="listbox" aria-multiselectable="true" aria-label="Các trang">
          {items.map((p, i) => {
            const [bw, bh] = tileBox(p, thumb);
            const isSel = selected.has(p.id);
            const color = groupOf?.(p);
            return (
              <div
                key={p.id} data-tile data-id={p.id} role="option" aria-selected={isSel}
                className={`otile${isSel ? " sel" : ""}${dragged?.has(p.id) ? " lifted" : ""}`}
                style={{ width: bw }}
                onPointerDown={(e) => onTileDown(e, p.id)}
              >
                <div className="obox" style={{ width: bw, height: bh }}>
                  <Thumb item={p} bw={bw} bh={bh} />
                  {color && <i className="ogroup" style={{ background: color }} />}
                  <input
                    type="checkbox" className="ocheck" checked={isSel} aria-label={`Chọn trang ${i + 1}`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onChange={() => o.click(p.id, { toggle: true, range: false })}
                  />
                  <div className="oactions" onPointerDown={(e) => e.stopPropagation()}>
                    <button aria-label="Xoay trái" onClick={() => { o.setSelection([p.id]); o.rotate(-90); }}>⟲</button>
                    <button aria-label="Xoay phải" onClick={() => { o.setSelection([p.id]); o.rotate(90); }}>⟳</button>
                    <button aria-label="Xoá trang" onClick={() => { o.setSelection([p.id]); o.remove(); }}>✕</button>
                  </div>
                </div>
                <span className="onum">{i + 1}</span>
              </div>
            );
          })}
          {indicator && <div className="oline" style={indicator} />}
          {marquee && (
            <div className="omarquee" style={{
              left: marquee.x0, top: marquee.y0, width: marquee.x1 - marquee.x0, height: marquee.y1 - marquee.y0,
            }} />
          )}
        </div>
      </div>

      {drag && (
        <div className="oghost" style={{ left: drag.x, top: drag.y, width: Math.min(thumb, 140) }}>
          <div className="oghost-card">{ghostSrc && <img src={ghostSrc} alt="" draggable={false} />}</div>
          {drag.ids.length > 1 && <span className="oghost-badge">{drag.ids.length}</span>}
        </div>
      )}

      {toast && (
        <div className={`otoast ${toast.kind}`} role="status">
          <span>{toast.text}</span>
          {toast.undo && <button onClick={() => o.undo()}>Hoàn tác</button>}
          <button aria-label="Đóng" onClick={o.dismissToast}>✕</button>
        </div>
      )}

      {splitOpen && <SplitDialog total={items.length} onClose={() => setSplitOpen(false)} />}
    </div>
  );
}

function SplitDialog({ total, onClose }: { total: number; onClose: () => void }) {
  const split = useOrganizer((s) => s.split);
  const busy = useOrganizer((s) => s.busy);
  const [mode, setMode] = useState<"every" | "ranges">("every");
  const [every, setEvery] = useState("10");
  const [ranges, setRanges] = useState("");

  const submit = async () => {
    if (await split(mode, mode === "every" ? every : ranges)) onClose();
  };

  return (
    <div className="modal-scrim" onPointerDown={onClose}>
      <div className="modal" role="dialog" aria-label="Tách file" onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); if (e.key === "Enter") void submit(); }}>
        <h2>Tách file</h2>
        <p className="muted">Tách {total} trang hiện tại (theo thứ tự đang sắp xếp) thành nhiều file, rồi chọn thư mục để lưu.</p>
        <label className="radio">
          <input type="radio" checked={mode === "every"} onChange={() => setMode("every")} />
          Mỗi file
          <input className="inp" type="number" min={1} value={every} disabled={mode !== "every"}
            onChange={(e) => setEvery(e.target.value)} aria-label="Số trang mỗi file" autoFocus />
          trang
        </label>
        <label className="radio">
          <input type="radio" checked={mode === "ranges"} onChange={() => setMode("ranges")} />
          Theo khoảng trang
        </label>
        <input className="inp wide" placeholder="Ví dụ: 1-3, 5, 7-9 (mỗi mục là một file)" value={ranges}
          disabled={mode !== "ranges"} onChange={(e) => setRanges(e.target.value)} aria-label="Khoảng trang" />
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>Huỷ</button>
          <button className="btn primary" onClick={() => void submit()} disabled={busy}>{busy ? "Đang tách…" : "Chọn thư mục và tách"}</button>
        </div>
      </div>
    </div>
  );
}
