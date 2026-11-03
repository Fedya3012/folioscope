import type { Annotation, Kind, Rect } from "./types";

type RunRect = [number, number, number, number];

/** Hộp bao của nhiều hình chữ nhật chuẩn hoá. */
function union(rs: Rect[]): Rect {
  const x = Math.min(...rs.map((r) => r.x)), y = Math.min(...rs.map((r) => r.y));
  return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y };
}

/**
 * Biến các đoạn chữ đang chọn (cùng một trang) thành ghi chú tô/gạch bám dòng.
 * Các đoạn cùng dòng được gộp thành một hình chữ nhật. Trả null nếu không có đoạn nào.
 */
export function markupFromRuns(runs: RunRect[], page: number, kind: Extract<Kind, "highlight" | "underline" | "strikeout">, color: string, strokeWidth = 2): Omit<Annotation, "id"> | null {
  const rects = runs.filter((r) => r[2] > 0 && r[3] > 0).map(([x, y, w, h]) => ({ x, y, w, h }));
  if (!rects.length) return null;
  const lines: Rect[] = [];
  for (const r of [...rects].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const last = lines[lines.length - 1];
    const sameLine = last && Math.abs(last.y + last.h / 2 - (r.y + r.h / 2)) < Math.min(last.h, r.h) * 0.5;
    if (sameLine) { const u = union([last, r]); Object.assign(last, u); } else lines.push({ ...r });
  }
  return { page, kind, color, strokeWidth, rect: union(lines), rects: lines };
}

/** Các đoạn chữ (theo trang) mà vùng chọn hiện tại chạm tới. Đọc từ thuộc tính data của lớp chữ. */
export function selectedRuns(sel: Selection | null): Map<number, RunRect[]> {
  const out = new Map<number, RunRect[]>();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return out;
  const range = sel.getRangeAt(0);
  const root = range.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
  root?.closest(".viewer")?.querySelectorAll<HTMLElement>(".textlayer span[data-rect]").forEach((el) => {
    if (!range.intersectsNode(el)) return;
    const page = Number(el.closest<HTMLElement>(".page")?.dataset.page);
    if (!Number.isFinite(page)) return;
    out.set(page, [...(out.get(page) ?? []), JSON.parse(el.dataset.rect!) as RunRect]);
  });
  return out;
}
