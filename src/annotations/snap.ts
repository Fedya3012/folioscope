import type { TextRun } from "../lib/api";
import type { Pt, Rect } from "./types";

type Placed = { r: Rect; line: number };

const toRect = (t: TextRun["rect"]): Rect => ({ x: t[0], y: t[1], w: t[2], h: t[3] });

/** Xếp các đoạn chữ theo thứ tự đọc (trên xuống, trái sang phải) và gán số dòng. */
function placeRuns(runs: TextRun[]): Placed[] {
  const rs = runs.map((t) => toRect(t.rect)).sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2));
  const lines: { cy: number; h: number; items: Rect[] }[] = [];
  for (const r of rs) {
    const cy = r.y + r.h / 2;
    const last = lines[lines.length - 1];
    if (last && Math.abs(cy - last.cy) < 0.6 * Math.min(last.h, r.h)) {
      last.items.push(r);
      last.h = Math.max(last.h, r.h);
    } else lines.push({ cy, h: r.h, items: [r] });
  }
  return lines.flatMap((l, i) => l.items.sort((a, b) => a.x - b.x).map((r) => ({ r, line: i })));
}

const dist = (r: Rect, p: Pt) =>
  Math.hypot(Math.max(r.x - p.x, 0, p.x - (r.x + r.w)), Math.max(r.y - p.y, 0, p.y - (r.y + r.h)));

const nearest = (ps: Placed[], p: Pt) => ps.reduce((best, c, i) => (dist(c.r, p) < dist(ps[best].r, p) ? i : best), 0);

const clampX = (r: Rect, x: number) => Math.min(r.x + r.w, Math.max(r.x, x));

/**
 * Từ hai điểm kéo chuột trả về các hình chữ nhật bám đúng từng dòng chữ thật.
 * Dòng đầu bắt đầu ở điểm bấm, dòng cuối kết thúc ở điểm thả (nội suy đều trong đoạn chữ).
 * Trang không có lớp chữ (ảnh quét) thì trả mảng rỗng để nơi gọi dùng hình chữ nhật tự do.
 */
export function snapToLines(runs: TextRun[], from: Pt, to: Pt): Rect[] {
  const ps = placeRuns(runs);
  if (!ps.length) return [];
  let i = nearest(ps, from), j = nearest(ps, to);
  let a = from, b = to;
  if (i > j || (i === j && from.x > to.x)) { [i, j] = [j, i]; [a, b] = [b, a]; }

  const byLine = new Map<number, Rect>();
  for (let k = i; k <= j; k++) {
    const r = ps[k].r;
    const x0 = k === i ? clampX(r, a.x) : r.x;
    const x1 = k === j ? clampX(r, b.x) : r.x + r.w;
    if (x1 - x0 < 0.001) continue;
    const cur = byLine.get(ps[k].line);
    if (!cur) { byLine.set(ps[k].line, { x: x0, y: r.y, w: x1 - x0, h: r.h }); continue; }
    const left = Math.min(cur.x, x0), right = Math.max(cur.x + cur.w, x1);
    const top = Math.min(cur.y, r.y), bottom = Math.max(cur.y + cur.h, r.y + r.h);
    byLine.set(ps[k].line, { x: left, y: top, w: right - left, h: bottom - top });
  }
  return [...byLine.values()];
}

export function unionRect(rs: Rect[]): Rect {
  const x = Math.min(...rs.map((r) => r.x)), y = Math.min(...rs.map((r) => r.y));
  return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y };
}
