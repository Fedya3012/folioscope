import type { NormRect, ObjEdit, PageObj } from "../lib/api";

/** Các sửa đổi của một tài liệu, mỗi đối tượng một mục (khoá = trang:mã). */
export type EditMap = Record<string, ObjEdit>;
export type ByPage = Record<number, ObjEdit[]>;

export const editKey = (page: number, id: number) => `${page}:${id}`;

const near = (a: number, b: number, eps = 1e-4) => Math.abs(a - b) < eps;
const sameRect = (a: NormRect, b: NormRect) => a.every((v, i) => near(v, b[i]));

/** Mục sửa không còn khác gì đối tượng gốc thì coi như chưa sửa. */
export function isNoop(e: ObjEdit, o: PageObj): boolean {
  if (e.deleted) return false;
  if (e.rect && !sameRect(e.rect, o.rect)) return false;
  if (e.text !== undefined && e.text !== o.text) return false;
  if (e.size !== undefined && o.size != null && !near(e.size, o.size, 0.01)) return false;
  if (e.bold !== undefined && e.bold !== o.bold) return false;
  if (e.fill !== undefined && e.fill.toLowerCase() !== (o.fill ?? "none").toLowerCase()) return false;
  if (e.stroke !== undefined && e.stroke.toLowerCase() !== (o.stroke ?? "none").toLowerCase()) return false;
  if (e.strokeWidth !== undefined && !near(e.strokeWidth, o.strokeWidth ?? 0, 0.01)) return false;
  if (e.image !== undefined) return false;
  return true;
}

/** Gộp một thay đổi mới vào mục sửa của đối tượng; bỏ mục nếu hoá ra không đổi gì. Trả bản đồ mới (không sửa bản cũ). */
export function patchEdit(edits: EditMap, o: PageObj, page: number, patch: Partial<ObjEdit>): EditMap {
  const key = editKey(page, o.id);
  const next: ObjEdit = { ...edits[key], page, id: o.id, ...patch };
  if (isNoop(next, o) && !(key in edits)) return edits;
  const out = { ...edits };
  if (isNoop(next, o)) delete out[key];
  else out[key] = next;
  return out;
}

export function removeEdit(edits: EditMap, page: number, id: number): EditMap {
  const out = { ...edits };
  delete out[editKey(page, id)];
  return out;
}

export const countEdits = (edits: EditMap) => Object.keys(edits).length;

/** Gom theo trang; trang không đổi thì giữ nguyên mảng cũ để React không vẽ lại trang đó. */
export function groupByPage(edits: EditMap, prev: ByPage): ByPage {
  const fresh: Record<number, ObjEdit[]> = {};
  for (const e of Object.values(edits)) (fresh[e.page] ??= []).push(e);
  const out: ByPage = {};
  for (const [p, list] of Object.entries(fresh)) {
    const old = prev[Number(p)];
    out[Number(p)] = old && old.length === list.length && old.every((e, i) => e === list[i]) ? old : list;
  }
  return out;
}

/** Khung đang hiển thị: kết quả đo sau khi vẽ lại > khung đích đã kéo > khung gốc. */
export function displayRect(o: PageObj, e: ObjEdit | undefined, measured: NormRect | undefined): NormRect {
  return measured ?? e?.rect ?? o.rect;
}

export const inside = (r: NormRect, x: number, y: number) => x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3];

/** Đối tượng nhỏ nhất chứa điểm (để bấm vào chữ nằm trên nền hình chữ nhật thì chọn chữ). Đối tượng đã xoá bị bỏ qua. */
export function hitTest(objs: PageObj[], edits: EditMap, page: number, rects: Record<string, NormRect>, x: number, y: number): PageObj | null {
  let best: PageObj | null = null, bestArea = Infinity;
  for (const o of objs) {
    const key = editKey(page, o.id);
    const e = edits[key];
    if (e?.deleted) continue;
    const r = displayRect(o, e, rects[key]);
    if (!inside(r, x, y)) continue;
    const area = r[2] * r[3];
    if (area <= bestArea) { best = o; bestArea = area; }
  }
  return best;
}

/** Dời khung theo (dx, dy) nhưng giữ nguyên trong trang. */
export function moveRect(r: NormRect, dx: number, dy: number): NormRect {
  const x = Math.min(Math.max(r[0] + dx, 0), Math.max(0, 1 - r[2]));
  const y = Math.min(Math.max(r[1] + dy, 0), Math.max(0, 1 - r[3]));
  return [x, y, r[2], r[3]];
}

/** Kéo góc dưới phải tới (x, y); không nhỏ hơn `min` và không vượt trang. */
export function resizeRect(r: NormRect, x: number, y: number, min = 0.01): NormRect {
  const w = Math.min(Math.max(x - r[0], min), 1 - r[0]);
  const h = Math.min(Math.max(y - r[1], min), 1 - r[1]);
  return [r[0], r[1], w, h];
}

/** Chuỗi gửi cho ô chọn màu: chỉ nhận "#RRGGBB". */
export const asHex = (c: string | null | undefined, fallback = "#000000") => (c && /^#[0-9a-f]{6}$/i.test(c) ? c : fallback);
