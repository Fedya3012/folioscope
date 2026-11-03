import type { Annotation } from "./types";

export type AnnotFilter = { status: "all" | "open" | "resolved"; q: string; kind: string; color: string; who: string };

/** Lọc ghi chú theo trạng thái (chỉ áp cho bình luận), loại, màu, người tạo và chữ tìm (trong nội dung, tên và các trả lời). */
export function filterAnnotations(items: Annotation[], f: AnnotFilter): Annotation[] {
  const q = f.q.trim().toLowerCase();
  return items.filter((a) =>
    (f.status === "all" || a.kind !== "note" || (a.status ?? "open") === f.status) &&
    (f.kind === "all" || a.kind === f.kind) &&
    (f.color === "all" || a.color.toLowerCase() === f.color.toLowerCase()) &&
    (f.who === "all" || (a.author ?? "Tôi") === f.who) &&
    (!q || [a.text, a.author, a.stamp, a.label, ...(a.replies ?? []).map((r) => r.text)].some((t) => t?.toLowerCase().includes(q))));
}
