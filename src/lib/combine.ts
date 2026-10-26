// Logic thuần của hộp thoại Gộp file: tách khỏi giao diện để kiểm thử được.
import type { CombineProgress, CompressionLevel, FileProbe } from "./api";

export type Item = FileProbe & { id: number; title: string; password?: string };

let nextId = 1;
export const makeItem = (p: FileProbe): Item => ({ ...p, id: nextId++, title: stripExt(p.name) });

export const stripExt = (name: string) => name.replace(/\.[^.\\/]+$/, "");

export const dirOf = (path: string) => {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i < 0 ? "" : path.slice(0, i + 1);
};

/** Chuyển phần tử `from` tới vị trí `to` (vị trí trong danh sách kết quả). */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length) return list;
  const dest = Math.min(Math.max(to, 0), list.length - 1);
  const next = list.slice();
  const [it] = next.splice(from, 1);
  next.splice(dest, 0, it);
  return next;
}

/** Thêm file mới vào cuối, bỏ file đã có (so theo đường dẫn). */
export function appendUnique(list: Item[], probes: FileProbe[]): Item[] {
  const seen = new Set(list.map((i) => i.path));
  const fresh = probes.filter((p) => !seen.has(p.path) && seen.add(p.path)).map(makeItem);
  return [...list, ...fresh];
}

/** Cập nhật hàng `id` bằng kết quả đọc lại file sau khi nhập mật khẩu, giữ nguyên thứ tự và tên dấu trang. */
export function applyProbe(list: Item[], id: number, probe: FileProbe, password: string): Item[] {
  return list.map((i) => (i.id === id ? { ...i, ...probe, id: i.id, title: i.title, password } : i));
}

/** Hàng đang cần mật khẩu (chưa nhập hoặc nhập sai). */
export const needsPassword = (i: Item) => i.needs_password;

/** Tên gợi ý cho file kết quả: "<tên file đầu> (gộp).pdf" cạnh file đầu tiên. */
export function suggestOutput(items: Item[]): string {
  const first = items[0];
  if (!first) return "Tài liệu gộp.pdf";
  return `${dirOf(first.path)}${stripExt(first.name)} (gộp).pdf`;
}

/** Tên file hợp lệ trên Windows: bỏ ký tự cấm, luôn kết thúc bằng .pdf. */
export function sanitizeFileName(name: string): string {
  const base = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").replace(/[. ]+$/, "").trim();
  const stem = base.replace(/\.pdf$/i, "").trim();
  return `${stem || "Tài liệu gộp"}.pdf`;
}

export const needsOffice = (items: Item[]) => items.some((i) => i.kind === "office");
export const blocked = (items: Item[]) => items.filter((i) => i.error);
export const totalPages = (items: Item[]) => items.reduce((n, i) => n + (i.pages ?? 0), 0);

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const COMPRESSION_LABELS: Record<CompressionLevel, [string, string]> = {
  none: ["Không nén", "Chỉ ghép trang, nhanh nhất"],
  balanced: ["Cân bằng", "Nén dữ liệu, giữ nguyên chất lượng ảnh"],
  max: ["Nhỏ nhất", "Giảm cả độ phân giải ảnh JPEG lớn"],
};

const STAGE_LABELS: Record<CombineProgress["stage"], string> = {
  convert: "Đang chuyển đổi", merge: "Đang gộp trang", optimize: "Đang nén", write: "Đang lưu file",
};
export const progressLabel = (p: CombineProgress) =>
  p.stage === "convert" && p.file ? `${STAGE_LABELS.convert}: ${p.file} (${p.current + 1}/${p.total})` : STAGE_LABELS[p.stage];
