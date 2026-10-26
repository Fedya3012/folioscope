import { describe, expect, it } from "vitest";
import { bounds, rectFrom, resizeTo, simplify, toPdfRect, translate } from "./geometry";
import type { Annotation } from "./types";

const base: Annotation = { id: "a", page: 0, kind: "rect", color: "#000", strokeWidth: 2 };

describe("geometry", () => {
  it("rectFrom chấp nhận kéo ngược", () => {
    expect(rectFrom({ x: 0.5, y: 0.6 }, { x: 0.2, y: 0.1 })).toEqual({ x: 0.2, y: 0.1, w: 0.3, h: 0.5 });
  });
  it("translate giữ đối tượng trong trang", () => {
    const a = translate({ ...base, rect: { x: 0.8, y: 0.8, w: 0.1, h: 0.1 } }, 0.5, 0.5);
    expect(a.rect!.x + a.rect!.w).toBeCloseTo(1);
    expect(a.rect!.y + a.rect!.h).toBeCloseTo(1);
  });
  it("translate dời điểm của nét vẽ", () => {
    const a = translate({ ...base, kind: "ink", points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }] }, 0.1, 0);
    expect(a.points![0].x).toBeCloseTo(0.2);
    expect(bounds(a).w).toBeCloseTo(0.1);
  });
  it("resizeTo có kích thước tối thiểu", () => {
    const a = resizeTo({ ...base, rect: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 } }, { x: 0.1, y: 0.1 });
    expect(a.rect!.w).toBe(0.01);
  });
  it("simplify giữ điểm đầu và cuối", () => {
    const pts = Array.from({ length: 50 }, (_, i) => ({ x: i * 0.0001, y: 0 }));
    const s = simplify(pts);
    expect(s[0]).toBe(pts[0]);
    expect(s[s.length - 1]).toBe(pts[49]);
    expect(s.length).toBeLessThan(pts.length);
  });
  it("toPdfRect lật trục Y sang gốc dưới trái", () => {
    expect(toPdfRect({ x: 0, y: 0, w: 0.5, h: 0.25 }, 600, 800)).toEqual([0, 600, 300, 800]);
  });
});
