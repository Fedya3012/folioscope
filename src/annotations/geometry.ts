import type { Annotation, Pt, Rect } from "./types";

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Hình chữ nhật từ hai điểm kéo, bất kể kéo theo hướng nào. */
export function rectFrom(a: Pt, b: Pt): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

export function bounds(a: Annotation): Rect {
  if (a.points?.length) {
    const xs = a.points.map((p) => p.x), ys = a.points.map((p) => p.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  return a.rect ?? { x: 0, y: 0, w: 0, h: 0 };
}

/** Dời cả đối tượng, giữ nó nằm trong trang. */
export function translate(a: Annotation, dx: number, dy: number): Annotation {
  const b = bounds(a);
  dx = Math.min(Math.max(dx, -b.x), 1 - (b.x + b.w));
  dy = Math.min(Math.max(dy, -b.y), 1 - (b.y + b.h));
  return {
    ...a,
    rect: a.rect && { ...a.rect, x: a.rect.x + dx, y: a.rect.y + dy },
    points: a.points?.map((p) => ({ x: p.x + dx, y: p.y + dy })),
    rects: a.rects?.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy })),
  };
}

/** Kéo góc dưới phải; kích thước tối thiểu để không biến mất. */
export function resizeTo(a: Annotation, p: Pt, min = 0.01): Annotation {
  if (!a.rect) return a;
  return { ...a, rect: { ...a.rect, w: Math.max(min, clamp01(p.x) - a.rect.x), h: Math.max(min, clamp01(p.y) - a.rect.y) } };
}

/** Bỏ bớt điểm vẽ tay gần nhau để file nhẹ. */
export function simplify(points: Pt[], minDist = 0.002): Pt[] {
  if (points.length < 3) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const l = out[out.length - 1];
    if (Math.hypot(points[i].x - l.x, points[i].y - l.y) >= minDist) out.push(points[i]);
  }
  out.push(points[points.length - 1]);
  return out;
}

/** Toạ độ PDF dùng gốc dưới trái, đơn vị điểm; đổi từ tỉ lệ trang. */
export function toPdfRect(r: Rect, pageW: number, pageH: number): [number, number, number, number] {
  return [r.x * pageW, (1 - r.y - r.h) * pageH, (r.x + r.w) * pageW, (1 - r.y) * pageH];
}
