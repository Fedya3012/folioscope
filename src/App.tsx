import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Resizer } from "./components/Resizer";
import { Organizer } from "./components/Organizer";
import { Outline } from "./components/Outline";
import { SearchPanel } from "./components/SearchPanel";
import { Thumbnails } from "./components/Thumbnails";
import { Viewer } from "./components/Viewer";
import { CombineDialog } from "./components/CombineDialog";
import { Home } from "./components/Home";
import { Icon } from "./components/Icon";
import { Settings } from "./components/Settings";
import { routeDrop } from "./lib/recent";
import { installShortcuts } from "./lib/shortcuts";
import { registerAppCommands } from "./appCommands";
import { Toaster } from "./components/Toaster";
import { PAGE_THEME_LABEL, nextPageTheme, parsePageInput } from "./lib/viewer";
import { PasswordDialog } from "./components/PasswordDialog";
import { OfficeInstallDialog } from "./components/OfficeInstallDialog";
import { ViewControls } from "./components/ViewControls";
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
  // Cài đặt giao diện (màu nhấn, cỡ chữ, mật độ, giảm chuyển động) đặt lên thẻ gốc để tokens.css xử lý.
  const { accent, uiSize, density, reduceMotion } = s.settings;
  useEffect(() => {
    const d = document.documentElement.dataset;
    d.accent = accent; d.size = String(uiSize); d.density = density; d.motion = reduceMotion ? "reduce" : "";
  }, [accent, uiSize, density, reduceMotion]);
  // Chủ đề "theo hệ thống" đi theo hệ điều hành ngay cả khi đang chạy.
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => s.setSystemDark(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Một bộ nghe phím duy nhất; các lệnh nằm ở appCommands.ts (và mỗi màn hình đăng ký thêm lệnh của nó).
  useEffect(() => installShortcuts(), []);
  useEffect(() => registerAppCommands(() => void openRef.current()), []);

  const openRef = useRef<() => Promise<void>>(async () => {});
  // null = đóng; mảng = mở hộp thoại Gộp file với các file ban đầu này.
  const [combine, setCombine] = useState<string[] | null>(null);
  const closeCombine = useCallback(() => setCombine(null), []);

  // File đến từ menu chuột phải của Windows (lúc khởi động hoặc khi app đã mở sẵn).
  useEffect(() => {
    const pull = () => takeLaunchFiles().then((f) => { if (f.length) setCombine(f); return f.length; }).catch(() => 0);
    // Lần đầu: nếu không có file từ menu chuột phải và người dùng chọn "File gần nhất" thì mở lại file đó.
    void pull().then((n) => {
      const { settings, recent, load } = useStore.getState();
      if (!n && settings.startup === "last" && recent[0]) void load(recent[0].path);
    });
    const sub = listen("launch-combine", () => void pull());
    return () => { void sub.then((un) => un()); };
  }, []);

  // Kéo thả file vào cửa sổ. Khi hộp thoại Gộp file đang mở thì để nó tự xử lý.
  const combineOpen = useRef(false);
  combineOpen.current = combine !== null;
  const [dragOver, setDragOver] = useState(false);
  useEffect(() => {
    const sub = getCurrentWebview().onDragDropEvent((e) => {
      const t = e.payload.type;
      // Hộp thoại Gộp file và màn hình Trang tự xử lý file thả vào (Trang chèn đúng chỗ thả).
      if (combineOpen.current || useStore.getState().mode === "pages") { setDragOver(false); return; }
      if (t === "enter" || t === "over") setDragOver(true);
      else if (t === "leave") setDragOver(false);
      else if (t === "drop") {
        setDragOver(false);
        const r = routeDrop(e.payload.paths);
        if (r && "open" in r) void useStore.getState().load(r.open);
        else if (r) setCombine(r.combine);
      }
    });
    return () => { void sub.then((un) => un()).catch(() => {}); };
  }, []);

  const open = async () => { const p = await pickPdf(); if (p) await s.load(p); };
  openRef.current = open;
  const onHome = s.view === "home" || !s.info;
  const fileName = s.path?.split(/[\\/]/).pop();

  return (
    <div className={`shell${onHome ? " on-home" : ""}`}>
      <header className="titlebar">
        <strong>Folioscope</strong>
        <div className="tabs" role="tablist" aria-label="Tài liệu" style={{ display: "contents" }}>
          <button role="tab" className="tab home-tab" aria-selected={onHome} aria-label="Home" title="Home" onClick={() => s.setView("home")}><Icon name="home" /></button>
          {fileName && <button role="tab" className="tab" aria-selected={!onHome} title={s.path ?? undefined} onClick={() => s.setView("doc")}>{fileName}</button>}
        </div>
        <span className="spacer" />
        <button className="btn ghost icon" aria-label="Cài đặt (Ctrl+,)" title="Cài đặt (Ctrl+,)" onClick={() => s.setSettingsOpen(true)}><Icon name="settings" /></button>
        <button className="btn ghost icon" aria-label="Đổi giao diện sáng/tối" onClick={s.toggleTheme}>{s.theme === "dark" ? "☀" : "☾"}</button>
      </header>

      {onHome ? (
        <Home onOpenDialog={open} onOpenPath={(p) => void s.load(p)} onCombine={setCombine} />
      ) : (<>

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
          {organizing ? <Organizer /> : s.info ? <><Viewer /><AnnotationLayer /><ViewControls /></> : (
            <div className="empty">
              <h1>Mở file PDF đầu tiên của bạn</h1>
              <p>{s.error ?? "Chọn một file để xem, hoặc kéo file PDF thả vào cửa sổ."}</p>
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
        <button className="btn ghost" title="Đổi màu nền trang" onClick={() => s.setPageTheme(nextPageTheme(s.pageTheme))}>{PAGE_THEME_LABEL[s.pageTheme]}</button>
        <button className="btn ghost" onClick={() => s.setFit("width")} aria-pressed={s.fit === "width"}>Vừa bề rộng</button>
        <button className="btn ghost" onClick={() => s.setFit("page")} aria-pressed={s.fit === "page"}>Vừa trang</button>
        <button className="btn ghost" onClick={() => s.zoomBy(-1)} aria-label="Thu nhỏ">−</button>
        <span className="zoomlabel">{Math.round(s.zoom * 100)}%</span>
        <button className="btn ghost" onClick={() => s.zoomBy(1)} aria-label="Phóng to">+</button>
      </footer>
      </>)}
      <PasswordDialog />
      <OfficeInstallDialog />
      <Toaster />
      {s.settingsOpen && <Settings />}
      {dragOver && <div className="drop-overlay" aria-hidden="true"><div>Thả file để mở<small>PDF mở để xem; nhiều file hoặc Word, ảnh sẽ vào Gộp file</small></div></div>}
      {combine && <CombineDialog initial={combine} onClose={closeCombine} onOpenResult={(p) => void s.load(p)}
        onOpenInOrganizer={(paths) => void useOrganizer.getState().openFiles(paths)} />}
    </div>
  );
}
