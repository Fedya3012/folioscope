import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useStore } from "../store";
import { registerCommands } from "../lib/shortcuts";
import { toast } from "../lib/toast";
import { useOrganizer, type InsertSource } from "../organizerStore";
import { bucketFor, cachedThumb } from "../lib/thumbs";
import { dropIndex, gapAt, intersects, type PageItem, type Rect } from "../lib/organizer";
import { CropShade, StampBadge, Thumb, tileBox } from "./PageThumb";
import { CropDialog, NumberDialog, ReplaceDialog, SplitDialog } from "./OrganizerDialogs";

const THUMB_MIN = 96;
const THUMB_MAX = 360;
const GROUP_COLORS = ["#3D63EE", "#1F9D61", "#F5B700", "#DC3B3B", "#6B5BD6", "#1F7FC4"];

type Drag = { ids: string[]; x: number; y: number; insertAt: number | null };
type Marquee = { x0: number; y0: number; x1: number; y1: number };

export function Organizer() {
  const path = useStore((s) => s.path);
  const info = useStore((s) => s.info);
  const load = useStore((s) => s.load);
  const setMode = useStore((s) => s.setMode);
  const o = useOrganizer();
  const { items, selected, thumb, busy } = o;

  useEffect(() => { o.sync(path, info); }, [path, info]); // eslint-disable-line react-hooks/exhaustive-deps

  const scroller = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const [indicator, setIndicator] = useState<{ left: number; top: number; height: number } | null>(null);
  const [menu, setMenu] = useState(false);
  const [dialog, setDialog] = useState<"split" | "crop" | "number" | "replace" | null>(null);
  /** Khe đang được trỏ tới (hiện nút "+") và menu chèn của khe đó. */
  const [plus, setPlus] = useState<{ at: number; x: number; y: number } | null>(null);
  const [plusMenu, setPlusMenu] = useState(false);
  /** Đang kéo file từ Explorer qua lưới. */
  const [fileOver, setFileOver] = useState(false);

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

  /** Đặt vạch chèn tại vị trí `at` (trước trang `at`). */
  const placeIndicator = useCallback((at: number, rects: Rect[], origin: DOMRect) => {
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
  }, []);

  /** Tính vị trí thả và vạch chèn tại toạ độ con trỏ. */
  const aim = useCallback((x: number, y: number) => {
    const t = tileRects();
    if (!t || !dragRef.current) return;
    const at = dropIndex(t.rects, x, y);
    dragRef.current = { ...dragRef.current, x, y, insertAt: at };
    setDrag(dragRef.current);
    placeIndicator(at, t.rects, t.origin);
  }, [tileRects, placeIndicator]);

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

  // Phím tắt của Trang (Ctrl+Z / Ctrl+Y do hệ hoàn tác toàn cục lo): Delete xoá, Ctrl+A chọn hết, R xoay phải, Shift+R xoay trái, Esc bỏ chọn.
  useEffect(() => registerCommands([
    { id: "pages.selectAll", label: "Chọn tất cả trang", group: "Trang", keys: ["Mod+A"], run: () => o.selectAll() },
    { id: "pages.delete", label: "Xoá trang đã chọn", group: "Trang", keys: ["Delete", "Backspace"], run: () => o.remove() },
    { id: "pages.rotateRight", label: "Xoay phải", group: "Trang", keys: ["R"], run: () => o.rotate(90) },
    { id: "pages.rotateLeft", label: "Xoay trái", group: "Trang", keys: ["Shift+R"], run: () => o.rotate(-90) },
    { id: "pages.save", label: "Lưu thứ tự trang", group: "Trang", keys: ["Mod+S", "Mod+Shift+S"], typing: "allow", run: () => { void onSave(); } },
    { id: "pages.insertBlank", label: "Chèn trang trắng", group: "Trang", keys: ["Mod+Shift+T"], run: () => o.insertBlank() },
    { id: "pages.insertFile", label: "Chèn trang từ file…", group: "Trang", keys: ["Mod+Shift+I"], run: () => { void o.insert("file"); } },
    { id: "pages.deleteKey", label: "Xoá trang đã chọn (Ctrl+Shift+D)", group: "Trang", keys: ["Mod+Shift+D"], run: () => o.remove() },
    { id: "pages.rotateCw", label: "Xoay phải (Ctrl+Shift+=)", group: "Trang", keys: ["Mod+Shift+="], run: () => o.rotate(90) },
    { id: "pages.rotateCcw", label: "Xoay trái (Ctrl+Shift+-)", group: "Trang", keys: ["Mod+Shift+-"], run: () => o.rotate(-90) },
    { id: "pages.crop", label: "Cắt lề…", group: "Trang", keys: ["C"], run: () => setDialog("crop") },
    { id: "pages.clearSelection", label: "Bỏ chọn", group: "Trang", keys: ["Escape"], run: () => { o.clearSelection(); return false; } },
  ]), [o]);

  // Kéo file từ Explorer vào lưới: vạch xanh chỉ chỗ chèn, thả để chèn đúng chỗ đó.
  useEffect(() => {
    const sub = getCurrentWebview().onDragDropEvent((e) => {
      const p = e.payload;
      if (p.type === "leave") { setFileOver(false); setIndicator(null); return; }
      const t = tileRects();
      const ratio = window.devicePixelRatio || 1;
      const at = t ? dropIndex(t.rects, p.position.x / ratio, p.position.y / ratio) : useOrganizer.getState().items.length;
      if (p.type === "drop") {
        setFileOver(false);
        setIndicator(null);
        void useOrganizer.getState().insertFiles(p.paths, at);
      } else {
        setFileOver(true);
        if (t) placeIndicator(at, t.rects, t.origin);
      }
    });
    return () => { void sub.then((un) => un()).catch(() => {}); };
  }, [tileRects, placeIndicator]);

  // Ctrl+V: dán ảnh từ clipboard thành trang mới (ngay sau trang đang chọn).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      const img = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith("image/"));
      if (!img) return;
      e.preventDefault();
      void useOrganizer.getState().insertClipboardImage(img);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  /** Nút "+" hiện khi con trỏ tới gần khe giữa hai trang. */
  const onGridMove = (e: React.PointerEvent) => {
    if (dragRef.current || plusMenu || e.buttons) return;
    const t = tileRects();
    if (!t) return;
    const rel = t.rects.map((r) => ({ left: r.left - t.origin.left, top: r.top - t.origin.top, right: r.right - t.origin.left, bottom: r.bottom - t.origin.top }));
    setPlus(gapAt(rel, e.clientX - t.origin.left, e.clientY - t.origin.top));
  };

  const onSave = async () => {
    const out = await o.save();
    if (!out) return;
    o.reset();
    await load(out);
    const st = useStore.getState();
    o.sync(st.path, st.info);
    if (st.error) toast.error(st.error); else toast.success(`Đã lưu ${out}`);
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
              <InsertMenu onDone={() => setMenu(false)} />
            </>
          )}
        </div>
        <button className="btn ghost" onClick={() => o.rotate(-90)} disabled={!n || busy} title="Xoay trái (Shift+R)" aria-label="Xoay trái">⟲</button>
        <button className="btn ghost" onClick={() => o.rotate(90)} disabled={!n || busy} title="Xoay phải (R)" aria-label="Xoay phải">⟳</button>
        <button className="btn ghost" onClick={o.remove} disabled={!n || busy} title="Xoá (Delete)">Xoá</button>
        <span className="org-sep" />
        <button className="btn ghost" onClick={() => void o.extract()} disabled={!n || busy}>Trích xuất…</button>
        <button className="btn ghost" onClick={() => setDialog("split")} disabled={busy}>Tách file…</button>
        <button className="btn ghost" onClick={() => setDialog("replace")} disabled={!n || busy} title="Thay các trang đã chọn bằng trang của file khác">Thay thế…</button>
        <button className="btn ghost" onClick={o.reverse} disabled={busy} title={n > 1 ? "Đảo thứ tự các trang đã chọn" : "Đảo thứ tự cả tài liệu"}>Đảo thứ tự</button>
        <button className="btn ghost" onClick={() => setDialog("crop")} disabled={busy} title={n ? "Cắt lề các trang đã chọn" : "Cắt lề cả tài liệu"}>Cắt lề…</button>
        <button className="btn ghost" onClick={() => setDialog("number")} disabled={busy} title={n ? "Đánh số các trang đã chọn" : "Đánh số cả tài liệu"}>Đánh số…</button>
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

      <div className={`org-scroll${fileOver ? " file-over" : ""}`} ref={scroller} onPointerDown={onBackgroundDown}>
        <div className="org-grid" ref={grid} role="listbox" aria-multiselectable="true" aria-label="Các trang"
          onPointerMove={onGridMove} onPointerLeave={() => { if (!plusMenu) setPlus(null); }}>
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
                  <CropShade item={p} bw={bw} />
                  <StampBadge item={p} bw={bw} />
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
          {plus && !drag && (
            <div className="oplus" style={{ left: plus.x, top: plus.y }} onPointerDown={(e) => e.stopPropagation()}>
              <button aria-label="Chèn trang tại đây" aria-haspopup="menu" aria-expanded={plusMenu} title="Chèn trang tại đây"
                onClick={() => setPlusMenu(!plusMenu)} disabled={busy}>+</button>
              {plusMenu && (
                <>
                  <div className="org-backdrop" onPointerDown={(e) => e.stopPropagation()} onClick={() => { setPlusMenu(false); setPlus(null); }} />
                  <InsertMenu at={plus.at} onDone={() => { setPlusMenu(false); setPlus(null); }} />
                </>
              )}
            </div>
          )}
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


      {fileOver && <div className="org-dropnote" aria-hidden="true">Thả file vào chỗ có vạch xanh để chèn (PDF, ảnh, Word, Excel, PowerPoint)</div>}
      {dialog === "split" && <SplitDialog total={items.length} onClose={() => setDialog(null)} />}
      {dialog === "crop" && <CropDialog onClose={() => setDialog(null)} />}
      {dialog === "number" && <NumberDialog onClose={() => setDialog(null)} />}
      {dialog === "replace" && <ReplaceDialog onClose={() => setDialog(null)} />}
    </div>
  );
}

/** Các cách chèn trang; `at` là vị trí khe đã bấm (không có thì chèn sau trang đang chọn). */
function InsertMenu({ at, onDone }: { at?: number; onDone: () => void }) {
  const insert = useOrganizer((s) => s.insert);
  const entries: [InsertSource, string][] = [
    ["blank", "Trang trắng"], ["file", "Từ file khác…"], ["image", "Từ ảnh…"], ["clipboard", "Từ clipboard"],
  ];
  return (
    <div className="org-popover" role="menu">
      {entries.map(([kind, label]) => (
        <button key={kind} role="menuitem" onClick={() => { onDone(); void insert(kind, at); }}>{label}</button>
      ))}
      <button role="menuitem" disabled title="Chưa làm: cần nối với máy quét">Từ máy quét (chưa có)</button>
    </div>
  );
}
