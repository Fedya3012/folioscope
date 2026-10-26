/** Logic thuần của các tab tài liệu (danh sách theo thứ tự mở; Home luôn ghim đầu và không nằm trong danh sách này). */

export const baseName = (path: string) => path.split(/[\\/]/).pop() || path;

/** Thêm tab ngay sau tab đang chọn (như trình duyệt); đã có thì giữ nguyên. */
export function addTab(tabs: string[], path: string, after: string | null): string[] {
  if (tabs.includes(path)) return tabs;
  const at = after ? tabs.indexOf(after) : -1;
  return at < 0 ? [...tabs, path] : [...tabs.slice(0, at + 1), path, ...tabs.slice(at + 1)];
}

/** Bỏ tab; trả danh sách mới và tab nên chuyển tới nếu tab bị bỏ đang chọn (ưu tiên bên phải, rồi bên trái). */
export function removeTab(tabs: string[], path: string): { tabs: string[]; next: string | null } {
  const i = tabs.indexOf(path);
  if (i < 0) return { tabs, next: null };
  const rest = tabs.filter((p) => p !== path);
  return { tabs: rest, next: rest[Math.min(i, rest.length - 1)] ?? null };
}

/** Dời tab `from` tới vị trí `to` (tính trong danh sách sau khi nhấc tab ra). */
export function moveTab(tabs: string[], from: number, to: number): string[] {
  if (from < 0 || from >= tabs.length) return tabs;
  const t = Math.max(0, Math.min(tabs.length - 1, to));
  if (t === from) return tabs;
  const next = tabs.slice();
  const [item] = next.splice(from, 1);
  next.splice(t, 0, item);
  return next;
}

/** Chuyển vòng quanh các tab (Ctrl+Tab). */
export function cycleTab(tabs: string[], current: string | null, dir: 1 | -1): string | null {
  if (!tabs.length) return null;
  const i = current ? tabs.indexOf(current) : -1;
  if (i < 0) return tabs[dir === 1 ? 0 : tabs.length - 1];
  return tabs[(i + dir + tabs.length) % tabs.length];
}

/** Vị trí chèn khi kéo: đếm số tab có tâm nằm bên trái con trỏ (bỏ qua chính tab đang kéo). */
export function dropIndex(centers: number[], dragging: number, x: number): number {
  let n = 0;
  centers.forEach((c, i) => { if (i !== dragging && c < x) n++; });
  return n;
}

/** Tên hiển thị của các tab; hai file trùng tên thì thêm thư mục chứa để phân biệt. */
export function tabLabels(tabs: string[]): Record<string, string> {
  const count = new Map<string, number>();
  tabs.forEach((p) => count.set(baseName(p), (count.get(baseName(p)) ?? 0) + 1));
  const out: Record<string, string> = {};
  for (const p of tabs) {
    const n = baseName(p);
    if ((count.get(n) ?? 0) < 2) { out[p] = n; continue; }
    const parts = p.split(/[\\/]/);
    out[p] = parts.length > 1 ? `${n} (${parts[parts.length - 2]})` : n;
  }
  return out;
}

/** Vị trí đọc lần cuối của từng file (mục 1.29). */
export type ReadPos = { page: number; zoom: number; fit: "width" | "page" | null; viewMode: "continuous" | "single"; at: number };
export const POS_LIMIT = 200;

export function parsePositions(raw: unknown): Record<string, ReadPos> {
  const out: Record<string, ReadPos> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [path, v] of Object.entries(raw as Record<string, unknown>)) {
    const p = v as Partial<ReadPos> | null;
    if (!p || typeof p.page !== "number" || typeof p.zoom !== "number" || !(p.page >= 0) || !(p.zoom > 0)) continue;
    out[path] = {
      page: Math.floor(p.page), zoom: p.zoom,
      fit: p.fit === "width" || p.fit === "page" ? p.fit : null,
      viewMode: p.viewMode === "single" ? "single" : "continuous",
      at: typeof p.at === "number" ? p.at : 0,
    };
  }
  return out;
}

/** Ghi vị trí của một file; giữ tối đa POS_LIMIT file, bỏ các file lâu nhất. */
export function savePosition(all: Record<string, ReadPos>, path: string, pos: ReadPos): Record<string, ReadPos> {
  const next = { ...all, [path]: pos };
  const keys = Object.keys(next);
  if (keys.length <= POS_LIMIT) return next;
  keys.sort((a, b) => next[a].at - next[b].at).slice(0, keys.length - POS_LIMIT).forEach((k) => delete next[k]);
  return next;
}
