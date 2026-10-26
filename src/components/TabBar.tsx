import { useEffect, useRef, useState } from "react";
import { useAnnot } from "../annotations/store";
import { useOrganizer } from "../organizerStore";
import { isDirty, useStore } from "../store";
import { baseName, dropIndex, tabLabels } from "../lib/tabs";
import { Icon } from "./Icon";

type Drag = { from: number; to: number; x: number };

/** Thanh tab trên cùng: Home ghim đầu, rồi mỗi tài liệu một tab (kéo để đổi chỗ, chuột giữa hoặc × để đóng, chuột phải để xem thêm). */
export function TabBar({ onOpen }: { onOpen: () => void }) {
  const { tabs, path, view, info, setView, activateTab, closeTab, closeOtherTabs, reorderTab } = useStore();
  // Đăng ký để vẽ lại chấm "chưa lưu" khi thay đổi ghi chú hoặc trang của tab đang chọn.
  useAnnot((a) => a.dirty);
  useOrganizer((o) => o.history.past.length);
  const onHome = view === "home" || !info;
  const labels = tabLabels(tabs);
  const [menu, setMenu] = useState<{ path: string; x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const refs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", esc); };
  }, [menu]);

  // Kéo bằng con trỏ (HTML5 drag bị cửa sổ Tauri chiếm trên Windows nên không dùng được).
  const startDrag = (e: React.PointerEvent, from: number) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest(".tab-close")) return;
    const x0 = e.clientX;
    let moved = false, to = from;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - x0) < 6) return;
      moved = true;
      const centers = refs.current.slice(0, tabs.length).map((el) => { const r = el!.getBoundingClientRect(); return r.left + r.width / 2; });
      to = dropIndex(centers, from, ev.clientX);
      setDrag({ from, to, x: ev.clientX - x0 });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      if (moved) { if (to !== from) reorderTab(from, to); }
      else activateTab(tabs[from]);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className="tabs" role="tablist" aria-label="Tài liệu">
      <button role="tab" className="tab home-tab" aria-selected={onHome} aria-label="Home" title="Home" onClick={() => setView("home")}><Icon name="home" /></button>
      {tabs.map((p, i) => {
        const selected = !onHome && p === path;
        const dirty = isDirty(p);
        const shift = drag && drag.from !== i
          ? (drag.from < i && drag.to >= i ? "left" : drag.from > i && drag.to <= i ? "right" : "") : "";
        return (
          <div
            key={p} ref={(el) => { refs.current[i] = el; }} role="tab" tabIndex={0}
            className={`tab doc-tab${drag?.from === i ? " dragging" : ""}${shift ? ` shift-${shift}` : ""}`}
            aria-selected={selected} title={dirty ? `${p} (chưa lưu)` : p}
            style={drag?.from === i ? { transform: `translateX(${drag.x}px)` } : undefined}
            onPointerDown={(e) => startDrag(e, i)}
            onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(p); } }}
            onContextMenu={(e) => { e.preventDefault(); setMenu({ path: p, x: e.clientX, y: e.clientY }); }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activateTab(p); }
              else if (e.key === "Delete") closeTab(p);
              else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && e.altKey) { e.preventDefault(); reorderTab(i, i + (e.key === "ArrowLeft" ? -1 : 1)); }
            }}
          >
            <span className="tab-name">{labels[p]}</span>
            {dirty && <span className="tab-dot" role="img" aria-label="Chưa lưu" />}
            <button className="tab-close" tabIndex={-1} aria-label={`Đóng ${baseName(p)}`} title="Đóng tab (Ctrl+W)" onClick={() => closeTab(p)}><Icon name="close" size={12} /></button>
          </div>
        );
      })}
      <button className="btn ghost icon tab-add" aria-label="Mở file trong tab mới (Ctrl+O)" title="Mở file trong tab mới (Ctrl+O)" onClick={onOpen}><Icon name="plus" /></button>

      {menu && (
        <div className="ctx-menu" role="menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(e) => e.stopPropagation()}>
          <button role="menuitem" onClick={() => { setMenu(null); closeTab(menu.path); }}>Đóng tab</button>
          <button role="menuitem" disabled={tabs.length < 2} onClick={() => { setMenu(null); closeOtherTabs(menu.path); }}>Đóng các tab khác</button>
        </div>
      )}
    </div>
  );
}

/** Hỏi lại trước khi đóng tab còn thay đổi chưa lưu. */
export function ConfirmClose() {
  const { closePrompt, confirmClose, cancelClose } = useStore();
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (closePrompt) ref.current?.focus(); }, [closePrompt]);
  if (!closePrompt) return null;
  const dirty = closePrompt.filter(isDirty);
  const names = dirty.map(baseName);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) cancelClose(); }}>
      <div className="modal narrow" role="alertdialog" aria-modal="true" aria-labelledby="cc-title" onKeyDown={(e) => { if (e.key === "Escape") cancelClose(); }}>
        <header><h2 id="cc-title">Đóng mà chưa lưu?</h2></header>
        <div className="modal-body">
          <p>{dirty.length === 1 ? `“${names[0]}” còn thay đổi chưa lưu.` : `${dirty.length} tài liệu còn thay đổi chưa lưu: ${names.join(", ")}.`} Đóng bây giờ thì các thay đổi này sẽ mất.</p>
          <div className="actions">
            <button ref={ref} className="btn secondary" onClick={cancelClose}>Quay lại</button>
            <button className="btn danger" onClick={confirmClose}>Đóng, không lưu</button>
          </div>
        </div>
      </div>
    </div>
  );
}
