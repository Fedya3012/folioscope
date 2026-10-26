import { centroid } from "./measure";
import type { Annotation, Pt, Rect } from "./types";

/** Dạng mà phía Rust (`annotations::Item`) đọc được. */
export interface SaveItem {
  page: number; kind: string; color: string; strokeWidth: number;
  rect?: Rect; points?: Pt[]; text?: string;
}

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString("vi-VN");

/** Nội dung ghi chú kèm cả chuỗi trả lời (PDF chuẩn giữ một ô nội dung nên chuỗi được ghép thẳng vào đó). */
export function threadText(a: Annotation): string {
  const head = a.status === "resolved" ? "[Đã giải quyết] " : "";
  const body = `${head}${a.text ?? ""}`.trimEnd();
  const replies = (a.replies ?? []).map((r) => `↳ ${r.author} (${fmtDate(r.at)}): ${r.text}`);
  return [body, ...replies].join("\n");
}

const labelRect = (at: Pt): Rect => ({ x: Math.min(at.x, 0.84), y: Math.max(at.y - 0.035, 0), w: 0.16, h: 0.03 });

/** Đổi chú thích trong app thành danh sách phẳng mà Rust ghi được. */
export function toSaveItems(items: Annotation[]): SaveItem[] {
  const out: SaveItem[] = [];
  for (const a of items) {
    const base = { page: a.page, color: a.color, strokeWidth: a.strokeWidth };
    switch (a.kind) {
      case "highlight": case "underline": case "strikeout":
        for (const rect of a.rects?.length ? a.rects : a.rect ? [a.rect] : []) out.push({ ...base, kind: a.kind, rect });
        break;
      case "note":
        out.push({ ...base, kind: "note", rect: a.rect, text: threadText(a) });
        break;
      case "stamp":
        if (a.rect) {
          out.push({ ...base, kind: "rect", rect: a.rect, strokeWidth: 3 });
          out.push({ ...base, kind: "text", rect: a.rect, text: a.stamp ?? "" });
        }
        break;
      case "distance":
        out.push({ ...base, kind: "line", points: a.points });
        if (a.points?.length) out.push({ ...base, kind: "text", rect: labelRect(centroid(a.points)), text: a.label ?? "" });
        break;
      case "perimeter": case "area":
        if (a.points && a.points.length >= 2) {
          out.push({ ...base, kind: "ink", points: a.points.length > 2 ? [...a.points, a.points[0]] : a.points });
          out.push({ ...base, kind: "text", rect: labelRect(centroid(a.points)), text: a.label ?? "" });
        }
        break;
      default:
        out.push({ ...base, kind: a.kind, rect: a.rect, points: a.points, text: a.text });
    }
  }
  return out;
}
