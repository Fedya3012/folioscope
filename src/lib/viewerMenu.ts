import { markupFromRuns, selectedRuns } from "../annotations/fromSelection";
import { newId, useAnnot } from "../annotations/store";
import type { Kind } from "../annotations/types";
import { useStore } from "../store";
import { tidyItems, type MenuItem } from "./ctxMenu";
import { toast } from "./toast";

type Markup = Extract<Kind, "highlight" | "underline" | "strikeout">;
const MARKUP_LABEL: Record<Markup, string> = { highlight: "Tô sáng", underline: "Gạch chân", strikeout: "Gạch ngang" };
const st = () => useStore.getState();

/** Tô/gạch phần chữ đang chọn bằng màu đang dùng. Trả số trang đã đánh dấu (0 nếu chưa chọn chữ). */
export function markSelection(kind: Markup): number {
  const a = useAnnot.getState();
  let n = 0;
  for (const [page, runs] of selectedRuns(window.getSelection())) {
    const m = markupFromRuns(runs, page, kind, a.color, a.strokeWidth);
    if (m) { a.add({ ...m, id: newId() } as never); n++; }
  }
  if (n) window.getSelection()?.removeAllRanges();
  return n;
}

const useTool = (tool: Kind) => { st().setMode("annotate"); useAnnot.getState().setTool(tool); };

/** Tìm đang chọn: mở tab Tìm kiếm và chạy tìm ngay. */
export function searchFor(text: string) {
  const q = text.trim().replace(/\s+/g, " ");
  if (!q) return;
  useStore.setState({ leftOpen: true, leftTab: "search" });
  void st().runSearch(q, false, false);
}

export function speak(text: string) {
  if (typeof speechSynthesis === "undefined") { toast.info("Máy này không hỗ trợ đọc to"); return; }
  speechSynthesis.cancel();
  speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}

const copy = async (text: string, plain: boolean) => {
  try { await navigator.clipboard.writeText(plain ? text.replace(/\s*\n\s*/g, " ").replace(/\s{2,}/g, " ").trim() : text); }
  catch { toast.error("Không sao chép được"); }
};

/** Dựng menu chuột phải theo thứ nằm dưới con trỏ. */
export function buildViewerMenu(target: Element, selection: string): MenuItem[] {
  const s = st();
  const onText = selection.trim().length > 0;
  if (onText) {
    const mark = (k: Markup) => () => { if (!markSelection(k)) toast.info("Hãy chọn chữ trước"); else toast.info(`Đã ${MARKUP_LABEL[k].toLowerCase()}`); };
    return tidyItems([
      { label: "Sao chép", hint: "Ctrl+C", run: () => void copy(selection, false) },
      { label: "Sao chép dạng chữ thường (gộp dòng)", run: () => void copy(selection, true) },
      { sep: true },
      ...(["highlight", "underline", "strikeout"] as Markup[]).map((k) => ({ label: MARKUP_LABEL[k], run: mark(k) })),
      { label: "Thêm bình luận…", run: () => { if (markSelection("highlight")) { useAnnot.getState().edit(useAnnot.getState().selectedId); s.setMode("annotate"); } } },
      { sep: true },
      { label: "Tìm đoạn này", run: () => searchFor(selection) },
      { label: "Đọc to", run: () => speak(selection) },
    ]);
  }
  const pageEl = target.closest<HTMLElement>(".page");
  const page = pageEl ? Number(pageEl.dataset.page) : s.currentPage;
  return tidyItems([
    { label: "Thêm ghi chú dán (sticky note)", run: () => useTool("note") },
    { label: "Thêm hộp văn bản", run: () => useTool("text") },
    { label: "Vẽ hình / vẽ tay", run: () => useTool("ink") },
    { sep: true },
    { label: `Quản lý trang ${page + 1} (xoay, xoá, chèn, trích xuất)…`, run: () => { s.goToPage(page); s.setMode("pages"); } },
  ]);
}
