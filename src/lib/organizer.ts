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
  /** Cắt lề (pt) theo chiều đang hiển thị, tức đã tính cả góc xoay thêm. */
  crop?: Crop;
  /** Chữ in lên trang (số trang). */
  stamp?: Stamp;
}

export interface Crop { l: number; t: number; r: number; b: number }

/** Vị trí in số trang: dưới/trên (b/t) × trái/giữa/phải (l/c/r). */
export type StampPos = "bl" | "bc" | "br" | "tl" | "tc" | "tr";
export interface Stamp { text: string; pos: StampPos; size: number; margin: number }

export interface Rect { left: number; top: number; right: number; bottom: number }

const norm = (deg: number) => ((deg % 360) + 360) % 360;

/** Kích thước hiển thị sau khi xoay thêm. */
export function displaySize(p: PageItem): [number, number] {
  return norm(p.rot) % 180 === 0 ? [p.w, p.h] : [p.h, p.w];
}

export function rotateItems(items: PageItem[], ids: ReadonlySet<string>, delta: number): PageItem[] {
  return items.map((p) => {
    if (!ids.has(p.id)) return p;
    // lề cắt đi theo trang: xoay thì các cạnh đổi chỗ để vẫn cắt đúng phần cũ
    return { ...p, rot: norm(p.rot + delta), ...(p.crop ? { crop: rotateCrop(p.crop, delta) } : {}) };
  });
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

/** Hình chữ nhật còn lại của trang sau khi cắt, theo chiều hiển thị: [rộng, cao]. */
export function croppedSize(p: PageItem): [number, number] {
  const [w, h] = displaySize(p);
  const c = p.crop;
  return c ? [w - c.l - c.r, h - c.t - c.b] : [w, h];
}

/** Lề nhỏ nhất còn lại cho mỗi chiều: không cho cắt hết trang. */
export const MIN_CROPPED = 12;

/** Kiểm tra lề cắt có hợp lệ với mọi trang đã chọn; trả thông báo lỗi nếu không. */
export function checkCrop(items: PageItem[], ids: ReadonlySet<string>, c: Crop): string | null {
  if ([c.l, c.t, c.r, c.b].some((v) => !Number.isFinite(v) || v < 0)) return "Lề cắt phải là số không âm.";
  for (const p of items) {
    if (!ids.has(p.id)) continue;
    const [w, h] = displaySize(p);
    if (w - c.l - c.r < MIN_CROPPED || h - c.t - c.b < MIN_CROPPED) return "Vùng cắt quá lớn, không còn lại phần nào của trang.";
  }
  return null;
}

/** Đặt (hoặc bỏ, khi `crop` là null) lề cắt cho các trang đã chọn. */
export function cropItems(items: PageItem[], ids: ReadonlySet<string>, crop: Crop | null): PageItem[] {
  return items.map((p) => {
    if (!ids.has(p.id)) return p;
    const { crop: _old, ...rest } = p;
    return crop && (crop.l || crop.t || crop.r || crop.b) ? { ...rest, crop } : rest;
  });
}

/** Xoay trang thì lề cắt (tính theo chiều hiển thị) phải xoay theo để vẫn cắt đúng phần cũ. */
export function rotateCrop(c: Crop, delta: number): Crop {
  const turns = (((delta / 90) % 4) + 4) % 4;
  let out = c;
  for (let i = 0; i < turns; i++) out = { l: out.b, t: out.l, r: out.t, b: out.r }; // xoay phải 90°
  return out;
}

export const MM = 72 / 25.4;
export const mmToPt = (mm: number) => mm * MM;
export const ptToMm = (pt: number) => pt / MM;

export type NumberFormat = "n" | "trang-n" | "n-tren-tong";

export const NUMBER_FORMATS: [NumberFormat, string][] = [
  ["n", "1, 2, 3"], ["trang-n", "Trang 1, Trang 2"], ["n-tren-tong", "1 / 10, 2 / 10"],
];

export interface NumberSpec { format: NumberFormat; start: number; pos: StampPos; size: number; marginMm: number }

export function numberLabel(format: NumberFormat, n: number, last: number): string {
  if (format === "trang-n") return `Trang ${n}`;
  if (format === "n-tren-tong") return `${n} / ${last}`;
  return String(n);
}

/**
 * Đánh số các trang đã chọn (hoặc tất cả khi không chọn gì) theo thứ tự hiện tại, bắt đầu từ `start`.
 * Mỗi trang giữ nguyên chữ đã in dù sau đó đổi thứ tự (như Acrobat).
 */
export function numberItems(items: PageItem[], ids: ReadonlySet<string>, spec: NumberSpec): PageItem[] {
  const all = ids.size === 0;
  const count = items.filter((p) => all || ids.has(p.id)).length;
  const last = spec.start + count - 1;
  let n = spec.start;
  return items.map((p) => {
    if (!all && !ids.has(p.id)) return p;
    const stamp: Stamp = { text: numberLabel(spec.format, n++, last), pos: spec.pos, size: spec.size, margin: mmToPt(spec.marginMm) };
    return { ...p, stamp };
  });
}

export function clearNumbers(items: PageItem[], ids: ReadonlySet<string>): PageItem[] {
  return items.map((p) => {
    if ((ids.size && !ids.has(p.id)) || !p.stamp) return p;
    const { stamp: _s, ...rest } = p;
    return rest;
  });
}

/** Thay các trang đã chọn bằng `added`: đặt đúng chỗ trang đầu tiên bị thay. */
export function replaceItems(items: PageItem[], ids: ReadonlySet<string>, added: PageItem[]): PageItem[] {
  const at = items.findIndex((p) => ids.has(p.id));
  if (at < 0) return items;
  return insertItems(removeItems(items, ids), at, added);
}

/** Một khoảng trang "3-7" (hoặc "5") của file có `total` trang thành danh sách chỉ số từ 0. */
export function parseSingleRange(text: string, total: number): number[] {
  const groups = parseRanges(text.trim() || `1-${total}`, total);
  return groups.flat();
}

/** Nhóm trang theo dấu trang cấp cao nhất: nhóm mới bắt đầu ở mỗi trang là đích của một dấu trang. */
export function groupsByBookmarks(items: PageItem[], source: string | null, startIndexes: ReadonlySet<number>): number[][] {
  const groups: number[][] = [];
  items.forEach((p, i) => {
    const starts = i === 0 || (p.source === source && startIndexes.has(p.index));
    if (starts) groups.push([]);
    groups[groups.length - 1].push(i);
  });
  return groups;
}

/**
 * Chia theo dung lượng tối đa `maxBytes` từ dung lượng ước lượng của từng trang (đã sắp theo thứ tự).
 * Mỗi nhóm có ít nhất một trang, kể cả khi trang đó tự nó đã vượt giới hạn.
 */
export function chunkByBytes(estimates: number[], maxBytes: number): number[][] {
  if (!(maxBytes > 0)) throw new Error("Dung lượng tối đa phải lớn hơn 0.");
  const groups: number[][] = [];
  let used = 0;
  estimates.forEach((bytes, i) => {
    if (groups.length === 0 || (used + bytes > maxBytes && groups[groups.length - 1].length > 0)) {
      groups.push([]);
      used = 0;
    }
    groups[groups.length - 1].push(i);
    used += bytes;
  });
  return groups;
}

/** Dung lượng ước lượng của một trang: trang trắng gần như không đáng kể, còn lại chia đều dung lượng file nguồn. */
export function estimatePageBytes(p: PageItem, source: { bytes: number; pages: number } | undefined): number {
  if (p.source === null || !source) return 1024;
  return source.bytes / Math.max(1, source.pages);
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

/**
 * Khe giữa hai trang gần con trỏ nhất (để hiện nút "+"): trả vị trí chèn `at` và toạ độ giữa khe.
 * `rects` theo thứ tự trang. Có khe trước mỗi trang và một khe sau trang cuối.
 */
export function gapAt(rects: Rect[], x: number, y: number, reach = 14): { at: number; x: number; y: number } | null {
  const found: { at: number; x: number; y: number; d: number }[] = [];
  const consider = (at: number, gx: number, top: number, bottom: number) => {
    const d = Math.abs(x - gx);
    if (y >= top - 4 && y <= bottom + 4 && d <= reach) found.push({ at, x: gx, y: (top + bottom) / 2, d });
  };
  rects.forEach((r, i) => {
    const prev = rects[i - 1];
    // cùng hàng với ô trước thì khe nằm giữa hai ô, đầu hàng thì ngay trước ô
    const sameRow = prev && Math.abs(prev.top - r.top) < (r.bottom - r.top) / 2;
    consider(i, sameRow ? (prev.right + r.left) / 2 : r.left - 12, r.top, r.bottom);
  });
  const last = rects[rects.length - 1];
  if (last) consider(rects.length, last.right + 12, last.top, last.bottom);
  found.sort((a, b) => a.d - b.d);
  return found[0] ? { at: found[0].at, x: found[0].x, y: found[0].y } : null;
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
