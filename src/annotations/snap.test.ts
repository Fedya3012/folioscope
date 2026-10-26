import { describe, expect, it } from "vitest";
import type { TextRun } from "../lib/api";
import { snapToLines, unionRect } from "./snap";

// Hai dòng chữ, mỗi dòng hai đoạn.
const runs: TextRun[] = [
  { text: "Xin chào", rect: [0.1, 0.1, 0.2, 0.02] },
  { text: "các bạn", rect: [0.32, 0.1, 0.2, 0.02] },
  { text: "dòng hai", rect: [0.1, 0.14, 0.4, 0.02] },
];

describe("snapToLines", () => {
  it("trang không có chữ thì trả rỗng", () => {
    expect(snapToLines([], { x: 0, y: 0 }, { x: 1, y: 1 })).toEqual([]);
  });
  it("kéo trong một dòng chỉ lấy đoạn được kéo, đúng cao dòng", () => {
    const r = snapToLines(runs, { x: 0.15, y: 0.11 }, { x: 0.25, y: 0.5 - 0.39 });
    expect(r).toHaveLength(1);
    expect(r[0].y).toBeCloseTo(0.1);
    expect(r[0].h).toBeCloseTo(0.02);
    expect(r[0].x).toBeCloseTo(0.15);
    expect(r[0].x + r[0].w).toBeCloseTo(0.25);
  });
  it("kéo qua hai dòng cho ra hai hình chữ nhật, dòng đầu đến hết dòng, dòng cuối từ đầu dòng", () => {
    const r = snapToLines(runs, { x: 0.4, y: 0.11 }, { x: 0.3, y: 0.15 });
    expect(r).toHaveLength(2);
    expect(r[0].x).toBeCloseTo(0.4);
    expect(r[0].x + r[0].w).toBeCloseTo(0.52);
    expect(r[1].x).toBeCloseTo(0.1);
    expect(r[1].x + r[1].w).toBeCloseTo(0.3);
  });
  it("kéo ngược cho cùng kết quả như kéo xuôi", () => {
    const fwd = snapToLines(runs, { x: 0.4, y: 0.11 }, { x: 0.3, y: 0.15 });
    const back = snapToLines(runs, { x: 0.3, y: 0.15 }, { x: 0.4, y: 0.11 });
    expect(back).toEqual(fwd);
  });
  it("hai đoạn cùng dòng được gộp thành một hình", () => {
    const r = snapToLines(runs, { x: 0.1, y: 0.11 }, { x: 0.52, y: 0.11 });
    expect(r).toHaveLength(1);
    expect(r[0].w).toBeCloseTo(0.42);
  });
  it("unionRect bao hết các dòng", () => {
    const u = unionRect([{ x: 0.1, y: 0.1, w: 0.4, h: 0.02 }, { x: 0.1, y: 0.14, w: 0.2, h: 0.02 }]);
    expect(u).toMatchObject({ x: 0.1, y: 0.1 });
    expect(u.h).toBeCloseTo(0.06);
  });
});
