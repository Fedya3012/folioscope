export type RecentFile = { path: string; name: string; openedAt: number; size: number | null; pages: number | null; pinned: boolean };
export type RecentSort = "openedAt" | "name" | "size";

export const fileNameOf = (path: string) => path.split(/[\\/]/).pop() || path;
export const folderOf = (path: string) => {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i > 0 ? path.slice(0, i) : "";
};

/** Đưa file lên đầu danh sách; giữ trạng thái ghim cũ. File ghim không bao giờ bị cắt bởi giới hạn. */
export function addRecent(list: RecentFile[], entry: Omit<RecentFile, "pinned" | "name">, limit: number): RecentFile[] {
  const old = list.find((f) => f.path === entry.path);
  const next: RecentFile = {
    ...entry, name: fileNameOf(entry.path), pinned: old?.pinned ?? false,
    size: entry.size ?? old?.size ?? null, pages: entry.pages ?? old?.pages ?? null,
  };
  return trimRecent([next, ...list.filter((f) => f.path !== entry.path)], limit);
}

export function trimRecent(list: RecentFile[], limit: number): RecentFile[] {
  let unpinned = 0;
  return list.filter((f) => f.pinned || ++unpinned <= limit);
}

export const togglePin = (list: RecentFile[], path: string) =>
  list.map((f) => (f.path === path ? { ...f, pinned: !f.pinned } : f));

export const removeRecent = (list: RecentFile[], path: string) => list.filter((f) => f.path !== path);

export function sortRecent(list: RecentFile[], by: RecentSort): RecentFile[] {
  const cmp: Record<RecentSort, (a: RecentFile, b: RecentFile) => number> = {
    openedAt: (a, b) => b.openedAt - a.openedAt,
    name: (a, b) => a.name.localeCompare(b.name, "vi"),
    size: (a, b) => (b.size ?? -1) - (a.size ?? -1),
  };
  return [...list].sort(cmp[by]);
}

/** Đọc danh sách đã lưu, bỏ mục hỏng. */
export function parseRecent(raw: unknown): RecentFile[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r): RecentFile[] => {
    if (!r || typeof r.path !== "string" || !r.path) return [];
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    return [{
      path: r.path, name: fileNameOf(r.path), openedAt: num(r.openedAt) ?? 0,
      size: num(r.size), pages: num(r.pages), pinned: r.pinned === true,
    }];
  });
}

/** "Mở 2 giờ trước" kiểu tiếng Việt. */
export function relativeTime(then: number, now: number): string {
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 60) return "vừa xong";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} phút trước`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} giờ trước`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} ngày trước`;
  const mo = Math.floor(d / 30);
  return mo < 12 ? `${mo} tháng trước` : `${Math.floor(mo / 12)} năm trước`;
}

export function formatBytes(n: number | null): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 1 : 0).replace(".", ",")} ${units[i]}`;
}

/** Thả file vào cửa sổ: đúng 1 PDF thì mở xem; còn lại (nhiều file, hoặc Word/ảnh…) đưa vào Gộp file. */
export function routeDrop(paths: string[]): { open: string } | { combine: string[] } | null {
  if (!paths.length) return null;
  if (paths.length === 1 && /\.pdf$/i.test(paths[0])) return { open: paths[0] };
  return { combine: paths };
}
