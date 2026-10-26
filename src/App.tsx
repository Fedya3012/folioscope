import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Resizer } from "./components/Resizer";
import { Organizer } from "./components/Organizer";
import { Outline } from "./components/Outline";
import { SEARCH_INPUT_ID, SearchPanel } from "./components/SearchPanel";
import { Thumbnails } from "./components/Thumbnails";
import { Viewer } from "./components/Viewer";
import { CombineDialog } from "./components/CombineDialog";
import { parsePageInput } from "./lib/viewer";
import { AnnotateBar } from "./annotations/AnnotateBar";
import { AnnotationLayer } from "./annotations/AnnotationLayer";
import { pickPdf, takeLaunchFiles } from "./lib/api";
import { useOrganizer } from "./organizerStore";
import { useStore, type Mode } from "./store";

const TAB_TITLES = { thumbs: "Hình thu nhỏ", outline: "Mục lục", search: "Tìm kiếm" } as const;

const MODES: [Mode, string][] = [
  ["view", "Xem"], ["annotate", "Ghi chú"], ["edit", "Chỉnh sửa"], ["pages", "Trang"], ["tools", "Tất cả công cụ"],
];

export function App() {
  const s = useStore();
  const pagesDirty = useOrganizer((o) => o.history.past.length > 0);
  const organizing = s.mode === "pages";
  const [pageText, setPageText] = useState("");
  useEffect(() => { setPageText(s.info ? String(s.currentPage + 1) : ""); }, [s.currentPage, s.info]);

  useEffect(() => { document.documentElement.dataset.theme = s.theme; }, [s.theme]);

  // Phím tắt theo bản thiết kế: Ctrl/⌘+\ ẩn hiện panel trái, Ctrl/⌘+Shift+\ panel phải, Ctrl/⌘ +/- zoom.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod && e.key.toLowerCase() === "o" && !(e.target as HTMLElement).closest("input, textarea, [role=dialog]") && s.info) s.setMode("pages");
      if (mod && e.key === "\\") { e.preventDefault(); s.togglePanel(e.shiftKey ? "right" : "left"); }
      if (mod && (e.key === "=" || e.key === "+")) { e.preventDefault(); s.zoomBy(1); }
      if (mod && e.key === "-") { e.preventDefault(); s.zoomBy(-1); }
      if (mod && e.key === "0") { e.preventDefault(); s.setFit("page"); }
      if (mod && e.key === "1") { e.preventDefault(); s.setZoom(1); }
      if (mod && e.key === "2") { e.preventDefault(); s.setFit("width"); }
      if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault();
        if (!s.leftOpen || s.leftTab !== "search") useStore.setState({ leftOpen: true, leftTab: "search" });
        else document.getElementById(SEARCH_INPUT_ID)?.focus();
      }
      // Phím điều hướng trang chỉ khi không đang gõ vào ô nhập.
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select") || mod || e.altKey || !s.info) return;
      const last = s.info.page_count - 1;
      if (e.key === "PageDown" || (s.viewMode === "single" && e.key === "ArrowRight")) { e.preventDefault(); s.goToPage(Math.min(last, s.currentPage + 1)); }
      if (e.key === "PageUp" || (s.viewMode === "single" && e.key === "ArrowLeft")) { e.preventDefault(); s.goToPage(Math.max(0, s.currentPage - 1)); }
      if (e.key === "Home") { e.preventDefault(); s.goToPage(0); }
      if (e.key === "End") { e.preventDefault(); s.goToPage(last); }
      if (e.key === "Escape" && s.search.hits.length) s.runSearch("", s.search.matchCase);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // null = đóng; mảng = mở hộp thoại Gộp file với các file ban đầu này.
  const [combine, setCombine] = useState<string[] | null>(null);
  const closeCombine = useCallback(() => setCombine(null), []);

  // File đến từ menu chuột phải của Windows (lúc khởi động hoặc khi app đã mở sẵn).
  useEffect(() => {
    const pull = () => takeLaunchFiles().then((f) => { if (f.length) setCombine(f); }).catch(() => {});
    void pull();
    const sub = listen("launch-combine", pull);
    return () => { void sub.then((un) => un()); };
  }, []);

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
        <button className="btn secondary" onClick={() => setCombine([])}>Gộp file…</button>
        <div className="segmented" role="group" aria-label="Công cụ con trỏ">
          <button aria-pressed={s.tool === "select"} onClick={() => s.setTool("select")} title="Chọn chữ">Chọn chữ</button>
          <button aria-pressed={s.tool === "hand"} onClick={() => s.setTool("hand")} title="Kéo trang">Bàn tay</button>
        </div>
        <div className="segmented" role="group" aria-label="Kiểu hiển thị">
          <button aria-pressed={s.viewMode === "continuous"} onClick={() => s.setViewMode("continuous")}>Cuộn liên tục</button>
          <button aria-pressed={s.viewMode === "single"} onClick={() => s.setViewMode("single")}>Từng trang</button>
        </div>
        <span className="spacer" />
        <div className="segmented" role="tablist" aria-label="Chế độ">
          {MODES.map(([m, label]) => (
            <button key={m} role="tab" aria-selected={s.mode === m} onClick={() => s.setMode(m)}>{label}</button>
          ))}
        </div>
        <span className="spacer" />
        <button className="btn ghost" aria-pressed={s.rightOpen} onClick={() => s.togglePanel("right")}>Thuộc tính</button>
      </div>

      <div className="annot-slot"><AnnotateBar /></div>

      <div className="workspace">
        <nav className="rail" aria-label="Điều hướng">
          <button aria-label="Hình thu nhỏ" title="Hình thu nhỏ" aria-pressed={s.leftOpen && s.leftTab === "thumbs"} onClick={() => s.openLeftTab("thumbs")}>▤</button>
          <button aria-label="Mục lục" title="Mục lục (bookmark)" aria-pressed={s.leftOpen && s.leftTab === "outline"} onClick={() => s.openLeftTab("outline")}>☰</button>
          <button aria-label="Tìm kiếm" title="Tìm kiếm (Ctrl+F)" aria-pressed={s.leftOpen && s.leftTab === "search"} onClick={() => s.openLeftTab("search")}>⌕</button>
        </nav>
        {s.leftOpen && !organizing && (
          <>
            <aside className="panel left" style={{ width: s.leftWidth }} aria-label={TAB_TITLES[s.leftTab]}>
              <h2>{TAB_TITLES[s.leftTab]}</h2>
              {s.leftTab === "thumbs" && <Thumbnails />}
              {s.leftTab === "outline" && <Outline />}
              {s.leftTab === "search" && <SearchPanel />}
            </aside>
            <Resizer side="left" onDrag={(w) => s.dragPanel("left", w)} />
          </>
        )}

        <main className="canvas">
          {organizing ? <Organizer /> : s.info ? <><Viewer /><AnnotationLayer /></> : (
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
        <button className="btn ghost" aria-label="Trang trước" disabled={!s.info || s.currentPage === 0} onClick={() => s.goToPage(s.currentPage - 1)}>‹</button>
        <input
          className="pageinput" aria-label="Số trang" inputMode="numeric" value={pageText} disabled={!s.info}
          onChange={(e) => setPageText(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={() => setPageText(s.info ? String(s.currentPage + 1) : "")}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || !s.info) return;
            const i = parsePageInput(pageText, s.info.page_count);
            if (i != null) s.goToPage(i);
            (e.target as HTMLInputElement).blur();
          }}
        />
        <span>/ {s.info ? s.info.page_count : "—"}</span>
        <button className="btn ghost" aria-label="Trang sau" disabled={!s.info || s.currentPage >= s.info.page_count - 1} onClick={() => s.goToPage(s.currentPage + 1)}>›</button>
        {pagesDirty && <span>Có thay đổi trang chưa lưu</span>}
        <span className="spacer" />
        <button className="btn ghost" onClick={() => s.setFit("width")} aria-pressed={s.fit === "width"}>Vừa bề rộng</button>
        <button className="btn ghost" onClick={() => s.setFit("page")} aria-pressed={s.fit === "page"}>Vừa trang</button>
        <button className="btn ghost" onClick={() => s.zoomBy(-1)} aria-label="Thu nhỏ">−</button>
        <span className="zoomlabel">{Math.round(s.zoom * 100)}%</span>
        <button className="btn ghost" onClick={() => s.zoomBy(1)} aria-label="Phóng to">+</button>
      </footer>
      {combine && <CombineDialog initial={combine} onClose={closeCombine} onOpenResult={(p) => void s.load(p)} />}
    </div>
  );
}
