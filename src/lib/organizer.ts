// Logic thuần của Page Organizer: không đụng giao diện hay Tauri nên test được.

/** Một trang trong danh sách đang sắp xếp. */
export interface PageItem {
  id: string;
  /** File nguồn; null là trang trắng. */
  source: string | null;
  /** Số thứ tự trang trong file nguồn, từ 0. */
  index: number;
  /** Góc xoay thêm so với bản gốc: 0, 90, 180 hoặc 270. */
  rot: number;
  /** Kích thước gốc theo điểm PDF, đã tính xoay sẵn có của file. */
  w: number;
  h: number;
}

export interface Rect { left: number; top: number; right: number; bottom: number }

const norm = (deg: number) => ((deg % 360) + 360) % 360;

/** Kích thước hiển thị sau khi xoay thêm. */
export function displaySize(p: PageItem): [number, number] {
  return norm(p.rot) % 180 === 0 ? [p.w, p.h] : [p.h, p.w];
}

export function rotateItems(items: PageItem[], ids: ReadonlySet<string>, delta: number): PageItem[] {
  return items.map((p) => (ids.has(p.id) ? { ...p, rot: norm(p.rot + delta) } : p));
}

export function removeItems(items: PageItem[], ids: ReadonlySet<string>): PageItem[] {
  return items.filter((p) => !ids.has(p.id));
}

export function insertItems(items: PageItem[], at: number, added: PageItem[]): PageItem[] {
  const i = Math.max(0, Math.min(at, items.length));
  return [...items.slice(0, i), ...added, ...items.slice(i)];
}

/**
 * Chuyển các trang đã chọn tới vị trí `at` (tính trên danh sách trước khi chuyển:
 * 0 là trước trang đầu, length là sau trang cuối). Thứ tự tương đối của các trang chọn được giữ.
 */
export function moveItems(items: PageItem[], ids: ReadonlySet<string>, at: number): PageItem[] {
  const moving = items.filter((p) => ids.has(p.id));
  if (moving.length === 0) return items;
  const clamped = Math.max(0, Math.min(at, items.length));
  const before = items.slice(0, clamped).filter((p) => !ids.has(p.id)).length;
  const rest = items.filter((p) => !ids.has(p.id));
  return [...rest.slice(0, before), ...moving, ...rest.slice(before)];
}

/** Đảo thứ tự: nếu chọn từ 2 trang trở lên thì chỉ đảo trong các ô đã chọn, ngược lại đảo cả tài liệu. */
export function reverseItems(items: PageItem[], ids: ReadonlySet<string>): PageItem[] {
  if (ids.size < 2) return [...items].reverse();
  const picked = items.filter((p) => ids.has(p.id)).reverse();
  let k = 0;
  return items.map((p) => (ids.has(p.id) ? picked[k++] : p));
}

/** Chọn dải từ `fromId` tới `toId` theo thứ tự hiện tại. */
export function rangeIds(items: PageItem[], fromId: string, toId: string): string[] {
  const a = items.findIndex((p) => p.id === fromId);
  const b = items.findIndex((p) => p.id === toId);
  if (a < 0 || b < 0) return [];
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return items.slice(lo, hi + 1).map((p) => p.id);
}

/**
 * Vị trí chèn khi kéo thả, từ toạ độ con trỏ và hình chữ nhật các ô theo đúng thứ tự.
 * Chọn ô gần con trỏ nhất (ưu tiên cùng hàng), rồi chèn trước hay sau ô đó tuỳ nửa trái/phải.
 */
export function dropIndex(rects: Rect[], x: number, y: number): number {
  if (rects.length === 0) return 0;
  let best = 0;
  let bestScore = Infinity;
  rects.forEach((r, i) => {
    const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
    const score = dy * 4 + dx;
    if (score < bestScore) { bestScore = score; best = i; }
  });
  const r = rects[best];
  return x > (r.left + r.right) / 2 ? best + 1 : best;
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/**
 * Đọc khoảng trang kiểu "1-3, 5, 7-9" (đánh số từ 1) thành các nhóm chỉ số từ 0.
 * Mỗi mục cách nhau bằng dấu phẩy là một nhóm (một file khi tách).
 */
export function parseRanges(text: string, total: number): number[][] {
  const parts = text.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) throw new Error("Hãy nhập khoảng trang, ví dụ 1-3, 5, 7-9.");
  return parts.map((part) => {
    const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);
    if (!m) throw new Error(`Không hiểu "${part}". Dùng dạng 5 hoặc 3-7.`);
    const from = Number(m[1]);
    const to = m[2] === undefined ? from : Number(m[2]);
    if (from < 1 || to < from) throw new Error(`Khoảng "${part}" không hợp lệ.`);
    if (to > total) throw new Error(`Khoảng "${part}" vượt quá ${total} trang.`);
    return Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i);
  });
}

/** Chia đều: mỗi nhóm `size` trang, nhóm cuối có thể ít hơn. */
export function chunkEvery(size: number, total: number): number[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error("Số trang mỗi file phải là số nguyên từ 1 trở lên.");
  const groups: number[][] = [];
  for (let i = 0; i < total; i += size) {
    groups.push(Array.from({ length: Math.min(size, total - i) }, (_, k) => i + k));
  }
  return groups;
}

/** Tên file con khi tách, đệm số 0 để xếp đúng thứ tự: baocao_phan-01.pdf */
export function partName(base: string, n: number, parts: number): string {
  const width = Math.max(2, String(parts).length);
  return `${base}_phan-${String(n).padStart(width, "0")}.pdf`;
}

export function splitFileName(path: string): { dir: string; sep: string; base: string } {
  const sep = path.includes("\\") ? "\\" : "/";
  const cut = path.lastIndexOf(sep);
  const file = path.slice(cut + 1);
  return { dir: cut < 0 ? "" : path.slice(0, cut), sep, base: file.replace(/\.pdf$/i, "") };
}

/** Lịch sử hoàn tác/làm lại cho một danh sách. */
export interface History<T> { past: T[][]; future: T[][] }

export const MAX_HISTORY = 100;

export function pushHistory<T>(h: History<T>, current: T[]): History<T> {
  return { past: [...h.past, current].slice(-MAX_HISTORY), future: [] };
}

export function undoHistory<T>(h: History<T>, current: T[]): { history: History<T>; items: T[] } | null {
  const prev = h.past[h.past.length - 1];
  if (!prev) return null;
  return { items: prev, history: { past: h.past.slice(0, -1), future: [current, ...h.future] } };
}

export function redoHistory<T>(h: History<T>, current: T[]): { history: History<T>; items: T[] } | null {
  const next = h.future[0];
  if (!next) return null;
  return { items: next, history: { past: [...h.past, current], future: h.future.slice(1) } };
}
