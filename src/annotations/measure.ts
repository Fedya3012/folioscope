import type { Annotation, Pt } from "./types";

export type Unit = "mm" | "cm" | "m" | "in" | "pt";
export const UNITS: Unit[] = ["mm", "cm", "m", "in", "pt"];
/** `ratio`: 1 đơn vị đo trên giấy ứng với bao nhiêu đơn vị thật (bản vẽ tỉ lệ 1:100 thì ratio = 100). */
export interface MeasureScale { unit: Unit; ratio: number }
export const DEFAULT_SCALE: MeasureScale = { unit: "cm", ratio: 1 };

/** Số điểm PDF (1/72 inch) trong một đơn vị. */
const PT_PER: Record<Unit, number> = { mm: 72 / 25.4, cm: 72 / 2.54, m: 72 / 0.0254, in: 72, pt: 1 };

const toPts = (p: Pt, pw: number, ph: number) => ({ x: p.x * pw, y: p.y * ph });

export function distancePts(a: Pt, b: Pt, pw: number, ph: number): number {
  const p = toPts(a, pw, ph), q = toPts(b, pw, ph);
  return Math.hypot(p.x - q.x, p.y - q.y);
}

export function polyLengthPts(points: Pt[], closed: boolean, pw: number, ph: number): number {
  let sum = 0;
  for (let i = 1; i < points.length; i++) sum += distancePts(points[i - 1], points[i], pw, ph);
  if (closed && points.length > 2) sum += distancePts(points[points.length - 1], points[0], pw, ph);
  return sum;
}

/** Diện tích đa giác (công thức dây giày), đơn vị điểm vuông. */
export function polyAreaPts(points: Pt[], pw: number, ph: number): number {
  if (points.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const p = toPts(points[i], pw, ph), q = toPts(points[(i + 1) % points.length], pw, ph);
    s += p.x * q.y - q.x * p.y;
  }
  return Math.abs(s) / 2;
}

export const lengthIn = (pts: number, s: MeasureScale) => (pts / PT_PER[s.unit]) * s.ratio;
export const areaIn = (pts2: number, s: MeasureScale) => (pts2 / PT_PER[s.unit] ** 2) * s.ratio ** 2;

/** Định dạng kiểu Việt: dấu phẩy thập phân, tối đa 2 số lẻ. */
export function formatValue(v: number, suffix: string): string {
  const t = (Math.round(v * 100) / 100).toString().replace(".", ",");
  return `${t} ${suffix}`;
}

export const formatLength = (pts: number, s: MeasureScale) => formatValue(lengthIn(pts, s), s.unit);
export const formatArea = (pts2: number, s: MeasureScale) => formatValue(areaIn(pts2, s), `${s.unit}²`);

export function centroid(points: Pt[]): Pt {
  const n = points.length || 1;
  return { x: points.reduce((a, p) => a + p.x, 0) / n, y: points.reduce((a, p) => a + p.y, 0) / n };
}

/** Nhãn số đo của một chú thích đo, theo kích thước trang (điểm) và tỉ lệ hiện hành. */
export function labelFor(a: Annotation, pw: number, ph: number, s: MeasureScale): string {
  const pts = a.points ?? [];
  if (a.kind === "area") return formatArea(polyAreaPts(pts, pw, ph), s);
  if (a.kind === "perimeter") return formatLength(polyLengthPts(pts, true, pw, ph), s);
  return formatLength(polyLengthPts(pts, false, pw, ph), s);
}
