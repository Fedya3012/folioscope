import { SEARCH_INPUT_ID } from "./components/SearchPanel";
import { registerCommands, type Command } from "./lib/shortcuts";
import { cycleTab } from "./lib/tabs";
import { redo, registerUndoScope, undo } from "./lib/undo";
import { useEdit } from "./edit/store";
import { usePalette } from "./lib/paletteStore";
import { useAnnot } from "./annotations/store";
import { useOrganizer } from "./organizerStore";
import { useStore, type Mode } from "./store";
import { savePath } from "./annotations/save";
import { saveEdits } from "./edit/save";
import { toast } from "./lib/toast";

export const GOTO_INPUT_ID = "folioscope-goto-page";

const st = () => useStore.getState();
const MODE_KEYS: [string, Mode][] = [["1", "view"], ["2", "annotate"], ["3", "edit"], ["4", "pages"], ["5", "tools"]];

/** Lệnh toàn app. `openFile` do App cung cấp (mở hộp thoại chọn file). Trả hàm gỡ đăng ký. */
export function registerAppCommands(openFile: () => void): () => void {
  const hasDoc = () => !!st().info;
  const lastPage = () => st().info!.page_count - 1;
  const go = (i: number) => st().goToPage(Math.max(0, Math.min(lastPage(), i)));
  const single = () => st().viewMode === "single";

  const cycle = (dir: 1 | -1) => { const p = cycleTab(st().tabs, st().path, dir); if (p) st().activateTab(p); };

  // Lưu theo chế độ đang mở. Trang tự lo trong Organizer; Xem không có gì để lưu.
  const save = (asCopy: boolean): void | false => {
    const s = st();
    if (!s.path) return false;
    if (s.mode === "annotate") {
      const a = useAnnot.getState();
      if (!a.items.length) { toast.info("Chưa có ghi chú nào để lưu"); return; }
      void savePath(s.path, a.items).then((out) => { if (out) useAnnot.setState({ dirty: false }); }).catch((e) => toast.error(String(e)));
    } else if (s.mode === "edit") {
      void saveEdits(s.path, asCopy ? "copy" : "overwrite");
    } else return false;
  };
  const toggleFullscreen = () => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen(); };
  const inView = () => hasDoc() && st().mode === "view";

  const cmds: Command[] = [
    { id: "file.save", label: "Lưu", group: "Tệp", keys: ["Mod+S"], typing: "allow", run: () => save(false) },
    { id: "file.saveAs", label: "Lưu thành bản sao…", group: "Tệp", keys: ["Mod+Shift+S"], typing: "allow", run: () => save(true) },
    { id: "view.fullscreen", label: "Toàn màn hình", group: "Xem", keys: ["Mod+L", "F11"], typing: "allow", run: toggleFullscreen },
    { id: "nav.goto", label: "Đi tới trang…", group: "Điều hướng", keys: ["Mod+Shift+N"], typing: "allow", when: hasDoc, run: () => { const el = document.getElementById(GOTO_INPUT_ID) as HTMLInputElement | null; el?.focus(); el?.select(); } },
    { id: "tool.hand", label: "Công cụ Bàn tay", group: "Xem", keys: ["H"], when: inView, run: () => st().setTool("hand") },
    { id: "tool.select", label: "Công cụ Chọn chữ", group: "Xem", keys: ["V"], when: inView, run: () => st().setTool("select") },
    { id: "search.next", label: "Kết quả tìm tiếp theo", group: "Tìm kiếm", keys: ["F3", "Mod+G"], typing: "allow", when: () => st().search.hits.length > 0, run: () => st().stepHit(1) },
    { id: "search.prev", label: "Kết quả tìm trước đó", group: "Tìm kiếm", keys: ["Shift+F3", "Mod+Shift+G"], typing: "allow", when: () => st().search.hits.length > 0, run: () => st().stepHit(-1) },
    { id: "file.open", label: "Mở file…", group: "Tệp", keys: ["Mod+O"], typing: "allow", run: openFile },
    { id: "convert.open", label: "Chuyển đổi file…", group: "Tệp", keys: [], typing: "allow", run: () => { window.dispatchEvent(new CustomEvent("folioscope:convert", { detail: "to_pdf" })); } },
    { id: "ocr.open", label: "OCR: nhận dạng chữ…", group: "Tệp", keys: [], typing: "allow", run: () => { window.dispatchEvent(new CustomEvent("folioscope:convert", { detail: "ocr" })); } },
    { id: "compare.open", label: "So sánh hai bản PDF…", group: "Tệp", keys: [], typing: "allow", run: () => { window.dispatchEvent(new CustomEvent("folioscope:compare")); } },
    { id: "ai.toggle", label: "Bật/tắt Trợ lý AI", group: "Ứng dụng", keys: ["Mod+Shift+A"], typing: "allow", when: hasDoc, run: () => { window.dispatchEvent(new CustomEvent("folioscope:ai")); } },
    { id: "tab.close", label: "Đóng tab", group: "Tệp", keys: ["Mod+W"], typing: "allow", when: () => !!st().path, run: () => st().closeTab(st().path!) },
    { id: "tab.next", label: "Tab sau", group: "Tệp", keys: ["Mod+Tab"], typing: "allow", when: () => st().tabs.length > 1, run: () => cycle(1) },
    { id: "tab.prev", label: "Tab trước", group: "Tệp", keys: ["Mod+Shift+Tab"], typing: "allow", when: () => st().tabs.length > 1, run: () => cycle(-1) },
    { id: "settings.open", label: "Cài đặt", group: "Ứng dụng", keys: ["Mod+,", "Mod+K"], typing: "allow", run: () => st().setSettingsOpen(true) },
    { id: "palette.open", label: "Bảng lệnh", group: "Ứng dụng", keys: ["Mod+Shift+P"], typing: "allow", run: () => usePalette.getState().setOpen(true) },
    { id: "theme.toggle", label: "Đổi chủ đề sáng/tối", group: "Giao diện", keys: [], typing: "allow", run: () => st().toggleTheme() },
    { id: "panel.left", label: "Ẩn/hiện bảng trái", group: "Giao diện", keys: ["Mod+\\", "F4"], typing: "allow", run: () => st().togglePanel("left") },
    { id: "panel.right", label: "Ẩn/hiện bảng phải", group: "Giao diện", keys: ["Mod+Shift+\\"], typing: "allow", run: () => st().togglePanel("right") },
    { id: "view.zoomIn", label: "Phóng to", group: "Xem", keys: ["Mod+=", "Mod++"], typing: "allow", run: (e) => (e.shiftKey && st().mode === "pages" ? false : st().zoomBy(1)) },
    { id: "view.zoomOut", label: "Thu nhỏ", group: "Xem", keys: ["Mod+-"], typing: "allow", run: () => st().zoomBy(-1) },
    { id: "view.fitPage", label: "Vừa trang", group: "Xem", keys: ["Mod+0"], typing: "allow", run: () => st().setFit("page") },
    { id: "view.actual", label: "Cỡ thật 100%", group: "Xem", keys: ["Mod+1"], typing: "allow", run: () => st().setZoom(1) },
    { id: "view.fitWidth", label: "Vừa bề rộng", group: "Xem", keys: ["Mod+2"], typing: "allow", run: () => st().setFit("width") },
    {
      id: "search.focus", label: "Tìm trong tài liệu", group: "Tìm kiếm", keys: ["Mod+F"], typing: "allow",
      run: () => {
        const s = st();
        if (!s.leftOpen || s.leftTab !== "search") useStore.setState({ leftOpen: true, leftTab: "search" });
        else document.getElementById(SEARCH_INPUT_ID)?.focus();
      },
    },
    { id: "search.clear", label: "Xoá kết quả tìm kiếm", group: "Tìm kiếm", keys: ["Escape"], when: () => st().search.hits.length > 0, run: () => { st().runSearch("", st().search.matchCase); return false; } },
    { id: "edit.undo", label: "Hoàn tác", group: "Chỉnh sửa", keys: ["Mod+Z"], run: () => (undo() ? undefined : false) },
    { id: "edit.redo", label: "Làm lại", group: "Chỉnh sửa", keys: ["Mod+Shift+Z", "Mod+Y"], run: () => (redo() ? undefined : false) },
    { id: "nav.next", label: "Trang sau", group: "Điều hướng", keys: ["PageDown"], when: hasDoc, run: () => go(st().currentPage + 1) },
    { id: "nav.prev", label: "Trang trước", group: "Điều hướng", keys: ["PageUp"], when: hasDoc, run: () => go(st().currentPage - 1) },
    { id: "nav.nextArrow", label: "Trang sau (chế độ từng trang)", group: "Điều hướng", keys: ["ArrowRight"], when: () => hasDoc() && single(), run: () => go(st().currentPage + 1) },
    { id: "nav.prevArrow", label: "Trang trước (chế độ từng trang)", group: "Điều hướng", keys: ["ArrowLeft"], when: () => hasDoc() && single(), run: () => go(st().currentPage - 1) },
    { id: "nav.first", label: "Trang đầu", group: "Điều hướng", keys: ["Home"], when: hasDoc, run: () => go(0) },
    { id: "nav.last", label: "Trang cuối", group: "Điều hướng", keys: ["End"], when: hasDoc, run: () => go(lastPage()) },
    { id: "mode.pages", label: "Chế độ Trang", group: "Chế độ", keys: [], when: hasDoc, run: () => st().setMode("pages") },
    ...MODE_KEYS.map(([k, m]): Command => ({
      id: `mode.${m}`, label: `Chuyển sang chế độ ${m}`, group: "Chế độ", keys: [k], when: hasDoc, run: () => st().setMode(m),
    })),
  ];

  const off = registerCommands(cmds);

  // Giữ Space = Bàn tay tạm thời (chỉ ở chế độ Xem, và không khi đang gõ chữ).
  let prevTool: "select" | "hand" | null = null;
  const typingNow = (t: EventTarget | null) => !!(t as Element | null)?.closest?.("input, textarea, select, button, [contenteditable=true], [role=dialog]");
  const onDown = (e: KeyboardEvent) => {
    if (e.code !== "Space" || e.repeat || e.ctrlKey || e.metaKey || e.altKey || typingNow(e.target) || !inView()) return;
    e.preventDefault();
    if (prevTool === null) { prevTool = st().tool; st().setTool("hand"); }
  };
  const onUp = (e: KeyboardEvent) => {
    if (e.code !== "Space" || prevTool === null) return;
    st().setTool(prevTool);
    prevTool = null;
  };
  window.addEventListener("keydown", onDown);
  window.addEventListener("keyup", onUp);
  // Ba tính năng đã có lịch sử riêng tham gia hoàn tác toàn cục theo chế độ đang mở.
  const offOrg = registerUndoScope({
    id: "organizer", active: () => st().mode === "pages",
    canUndo: () => useOrganizer.getState().history.past.length > 0, canRedo: () => useOrganizer.getState().history.future.length > 0,
    undo: () => useOrganizer.getState().undo(), redo: () => useOrganizer.getState().redo(),
  });
  const offAnnot = registerUndoScope({
    id: "annotations", active: () => st().mode === "annotate",
    canUndo: () => useAnnot.getState().past.length > 0, canRedo: () => useAnnot.getState().future.length > 0,
    undo: () => useAnnot.getState().undo(), redo: () => useAnnot.getState().redo(),
  });
  const offEdit = registerUndoScope({
    id: "content-edit", active: () => st().mode === "edit",
    canUndo: () => useEdit.getState().past.length > 0, canRedo: () => useEdit.getState().future.length > 0,
    undo: () => useEdit.getState().undo(), redo: () => useEdit.getState().redo(),
  });
  return () => { off(); offOrg(); offAnnot(); offEdit(); window.removeEventListener("keydown", onDown); window.removeEventListener("keyup", onUp); };
}
