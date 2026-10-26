import { describe, expect, it } from "vitest";
import { areaIn, formatArea, formatLength, labelFor, lengthIn, polyAreaPts, polyLengthPts } from "./measure";
import type { Annotation } from "./types";

const A4 = [595, 842] as const;

describe("đo đạc", () => {
  it("1 inch = 72 điểm", () => {
    expect(lengthIn(72, { unit: "in", ratio: 1 })).toBeCloseTo(1);
    expect(lengthIn(72, { unit: "mm", ratio: 1 })).toBeCloseTo(25.4);
  });
  it("tỉ lệ 1:100 nhân chiều dài với 100 và diện tích với 10000", () => {
    expect(lengthIn(72, { unit: "m", ratio: 100 })).toBeCloseTo(2.54);
    expect(areaIn(72 * 72, { unit: "in", ratio: 10 })).toBeCloseTo(100);
  });
  it("chu vi và diện tích hình chữ nhật nửa trang", () => {
    const sq = [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 0.5 }, { x: 0, y: 0.5 }];
    expect(polyLengthPts(sq, true, ...A4)).toBeCloseTo(595 + 842);
    expect(polyLengthPts(sq, false, ...A4)).toBeCloseTo(595 + 842 * 0.5);
    expect(polyAreaPts(sq, ...A4)).toBeCloseTo(0.25 * 595 * 842);
  });
  it("định dạng dùng dấu phẩy thập phân", () => {
    expect(formatLength(72, { unit: "in", ratio: 1.5 })).toBe("1,5 in");
    expect(formatArea(72 * 72, { unit: "in", ratio: 1 })).toBe("1 in²");
  });
  it("labelFor theo loại", () => {
    const a = { id: "x", page: 0, color: "", strokeWidth: 1, kind: "distance", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] } as Annotation;
    expect(labelFor(a, 72, 100, { unit: "in", ratio: 1 })).toBe("1 in");
  });
});
