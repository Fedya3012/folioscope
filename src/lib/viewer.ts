import { clamp } from "./layout";

/** Trang PDF tính theo điểm (1/72 inch); màn hình tính theo px (96/inch). Zoom 100% = kích thước thật. */
export const PT_TO_PX = 96 / 72;
export const PAGE_GAP = 16;
export const PAGE_PAD = 32;

export type PageSize = [number, number];
export type ViewMode = "continuous" | "single";
export type Fit = "width" | "page" | null;

export const pageWidthPx = (pw: number, zoom: number) => Math.round(pw * PT_TO_PX * zoom);
export const pageHeightPx = (ph: number, zoom: number) => Math.round(ph * PT_TO_PX * zoom);

/** Zoom vừa bề rộng khung nhìn với trang rộng nhất. */
export function fitWidthZoom(viewW: number, sizes: PageSize[]): number {
  const widest = Math.max(...sizes.map((s) => s[0]), 1);
  return Math.max(0.05, (viewW - PAGE_PAD * 2) / (widest * PT_TO_PX));
}

/** Zoom vừa cả một trang (chiều nào chật hơn thì theo chiều đó). */
export function fitPageZoom(viewW: number, viewH: number, size: PageSize): number {
  const [pw, ph] = size;
  const byW = (viewW - PAGE_PAD * 2) / (pw * PT_TO_PX);
  const byH = (viewH - PAGE_PAD * 2) / (ph * PT_TO_PX);
  return Math.max(0.05, Math.min(byW, byH));
}

/** Toạ độ đỉnh từng trang trong chế độ cuộn liên tục, và tổng chiều cao nội dung. */
export function pageOffsets(sizes: PageSize[], zoom: number): { tops: number[]; total: number } {
  const tops: number[] = [];
  let y = PAGE_PAD;
  for (const [, ph] of sizes) {
    tops.push(y);
    y += pageHeightPx(ph, zoom) + PAGE_GAP;
  }
  return { tops, total: y - PAGE_GAP + PAGE_PAD };
}

/** Trang đang ở giữa khung nhìn khi cuộn (tìm nhị phân trên `tops`). */
export function pageAtScroll(tops: number[], scrollTop: number, viewH: number): number {
  const mid = scrollTop + viewH / 2;
  let lo = 0, hi = tops.length - 1;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (tops[m] <= mid) lo = m; else hi = m - 1;
  }
  return lo;
}

/** Đọc số trang người dùng gõ (đếm từ 1) → chỉ số từ 0, hoặc null nếu không hợp lệ. */
export function parsePageInput(text: string, pageCount: number): number | null {
  const n = Number.parseInt(text.trim(), 10);
  if (!Number.isFinite(n) || pageCount < 1) return null;
  return clamp(n, 1, pageCount) - 1;
}

/** Bước tới/lui trong danh sách kết quả tìm, vòng tròn. */
export function stepIndex(current: number, count: number, dir: 1 | -1): number {
  if (count <= 0) return -1;
  if (current < 0) return dir === 1 ? 0 : count - 1;
  return (current + dir + count) % count;
}

/** Số bước zoom mỗi nấc lăn chuột khi giữ Ctrl: mượt, ~10% mỗi nấc. */
export const wheelZoom = (zoom: number, deltaY: number) => zoom * Math.exp(-deltaY * 0.0015);

// ---- Màu nền trang khi đọc ----
export type PageTheme = "normal" | "night" | "sepia";
export const PAGE_THEME_LABEL: Record<PageTheme, string> = { normal: "Giấy trắng", night: "Đọc ban đêm", sepia: "Sepia" };
const PAGE_THEME_ORDER: PageTheme[] = ["normal", "night", "sepia"];
export const isPageTheme = (v: unknown): v is PageTheme => PAGE_THEME_ORDER.includes(v as PageTheme);
export const nextPageTheme = (t: PageTheme): PageTheme => PAGE_THEME_ORDER[(PAGE_THEME_ORDER.indexOf(t) + 1) % PAGE_THEME_ORDER.length];

// ---- Chọn mức zoom ----
export const ZOOM_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

/** Giá trị của ô chọn zoom: "width", "page", một mức có sẵn (vd "1.5"), hoặc "custom" khi đang ở mức lẻ. */
export function zoomChoice(zoom: number, fit: Fit): string {
  if (fit) return fit;
  const preset = ZOOM_PRESETS.find((p) => Math.abs(p - zoom) < 0.005);
  return preset === undefined ? "custom" : String(preset);
}

// ---- Mật khẩu ----
/** Lõi Rust trả đúng hai chuỗi này khi file cần mật khẩu hoặc mật khẩu sai (xem `PdfError` trong pdf.rs). */
export function passwordFailure(err: unknown): "required" | "wrong" | null {
  const s = String(err);
  if (s.includes("WRONG_PASSWORD")) return "wrong";
  if (s.includes("PASSWORD_REQUIRED")) return "required";
  return null;
}
