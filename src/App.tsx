import { useEffect, useRef } from "react";
import { Resizer } from "./components/Resizer";
import { Organizer } from "./components/Organizer";
import { Viewer } from "./components/Viewer";
import { pickPdf } from "./lib/api";
import { useOrganizer } from "./organizerStore";
import { useStore, type Mode } from "./store";

const MODES: [Mode, string][] = [
  ["view", "Xem"], ["annotate", "Ghi chú"], ["edit", "Chỉnh sửa"], ["pages", "Trang"], ["tools", "Tất cả công cụ"],
];

export function App() {
  const s = useStore();
  const pagesDirty = useOrganizer((o) => o.history.past.length > 0);
  const organizing = s.mode === "pages";
  const canvas = useRef<HTMLDivElement>(null);

  useEffect(() => { document.documentElement.dataset.theme = s.theme; }, [s.theme]);

  // Phím tắt theo bản thiết kế: Ctrl/⌘+\ ẩn hiện panel trái, Ctrl/⌘+Shift+\ panel phải, Ctrl/⌘ +/- zoom.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod && e.key.toLowerCase() === "o" && !(e.target as HTMLElement).closest("input, textarea, [role=dialog]") && s.info) s.setMode("pages");
      if (mod && e.key === "\\") { e.preventDefault(); s.togglePanel(e.shiftKey ? "right" : "left"); }
      if (mod && (e.key === "=" || e.key === "+")) { e.preventDefault(); s.zoomBy(1); }
      if (mod && e.key === "-") { e.preventDefault(); s.zoomBy(-1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const open = async () => { const p = await pickPdf(); if (p) await s.load(p); };
  const fileName = s.path?.split(/[\\/]/).pop();

  return (
    <div className="shell">
      <header className="titlebar">
        <strong>Folioscope</strong>
        {fileName && <span className="tab">{fileName}</span>}
        <span className="spacer" />
        <button className="btn ghost icon" aria-label="Đổi giao diện sáng/tối" onClick={s.toggleTheme}>{s.theme === "dark" ? "☀" : "☾"}</button>
      </header>

      <div className="toolbar" role="toolbar" aria-label="Công cụ chính">
        <button className="btn secondary" onClick={open}>Mở file…</button>
        <span className="spacer" />
        <div className="segmented" role="tablist" aria-label="Chế độ">
          {MODES.map(([m, label]) => (
            <button key={m} role="tab" aria-selected={s.mode === m} onClick={() => s.setMode(m)}>{label}</button>
          ))}
        </div>
        <span className="spacer" />
        <button className="btn ghost" aria-pressed={s.rightOpen} onClick={() => s.togglePanel("right")}>Thuộc tính</button>
      </div>

      <div className="workspace">
        <nav className="rail" aria-label="Điều hướng">
          <button aria-label="Hình thu nhỏ" aria-pressed={s.leftOpen} onClick={() => s.togglePanel("left")}>▤</button>
        </nav>
        {s.leftOpen && !organizing && (
          <>
            <aside className="panel left" style={{ width: s.leftWidth }} aria-label="Hình thu nhỏ">
              <h2>Hình thu nhỏ</h2>
              <div className="thumbs">
                {s.info?.page_sizes.slice(0, 200).map((_, i) => (
                  <button key={i} aria-current={s.currentPage === i} onClick={() => { s.setPage(i); canvas.current?.querySelector(`[data-page="${i}"]`)?.scrollIntoView(); }}>
                    Trang {i + 1}
                  </button>
                ))}
                {!s.info && <p className="body">Chưa có tài liệu.</p>}
              </div>
            </aside>
            <Resizer side="left" onDrag={(w) => s.dragPanel("left", w)} />
          </>
        )}

        <main className="canvas" ref={canvas}>
          {organizing ? <Organizer /> : s.info ? <Viewer /> : (
            <div className="empty">
              <h1>Mở file PDF đầu tiên của bạn</h1>
              <p>{s.error ?? "Chọn một file để xem. Kéo thả sẽ có ở bản sau."}</p>
              <div><button className="btn primary" onClick={open}>Chọn file…</button></div>
            </div>
          )}
        </main>

        {s.rightOpen && !organizing && (
          <>
            <Resizer side="right" onDrag={(w) => s.dragPanel("right", w)} />
            <aside className="panel right" style={{ width: s.rightWidth }} aria-label="Thuộc tính">
              <h2>Thuộc tính</h2>
              <div className="body">Chọn một đối tượng để xem thuộc tính.</div>
            </aside>
          </>
        )}
      </div>

      <footer className="statusbar">
        <span>{s.info ? `${s.currentPage + 1} / ${s.info.page_count}` : "—"}</span>
        {pagesDirty && <span>Có thay đổi trang chưa lưu</span>}
        <span className="spacer" />
        <button className="btn ghost" onClick={() => s.zoomBy(-1)} aria-label="Thu nhỏ">−</button>
        <span>{Math.round(s.zoom * 100)}%</span>
        <button className="btn ghost" onClick={() => s.zoomBy(1)} aria-label="Phóng to">+</button>
      </footer>
    </div>
  );
}
