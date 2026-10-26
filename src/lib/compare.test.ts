import { describe, expect, it } from "vitest";
import { changedPages, diffDocuments, diffPage, diffPixels, diffWords, nextChanged } from "./compare";

const join = (segs: { kind: string; text: string }[], kind: string) => segs.filter((s) => s.kind === kind).map((s) => s.text.trim()).join("|");

describe("diffWords", () => {
  it("giống nhau thì không có thay đổi", () => {
    expect(diffPage("Xin chào các bạn", "Xin  chào\ncác bạn").changed).toBe(false);
  });
  it("tìm từ bị đổi, thêm, xoá", () => {
    const d = diffWords("giá là 100 đồng một cái", "giá là 120 đồng");
    expect(join(d, "del")).toBe("100|một cái");
    expect(join(d, "add")).toBe("120");
    expect(d.map((s) => s.text).filter((_, i) => d[i].kind !== "add").join("")).toBe("giá là 100 đồng một cái");
  });
  it("ghép lại ra đúng bản mới", () => {
    const a = "một hai ba bốn năm", b = "một ba bốn sáu năm";
    const d = diffWords(a, b);
    expect(d.filter((s) => s.kind !== "del").map((s) => s.text).join("")).toBe(b);
    expect(d.filter((s) => s.kind !== "add").map((s) => s.text).join("")).toBe(a);
  });
  it("đếm số từ thêm và xoá", () => {
    const p = diffPage("a b c", "a x y c");
    expect(p.added).toBe(2);
    expect(p.removed).toBe(1);
  });
  it("bản rỗng", () => {
    expect(diffPage("", "abc def").added).toBe(2);
    expect(diffPage("abc", "").removed).toBe(1);
  });
});

describe("diffDocuments", () => {
  it("trang thừa tính là thay đổi", () => {
    const d = diffDocuments(["a", "b"], ["a", "b", "c"]);
    expect(d).toHaveLength(3);
    expect(changedPages(d)).toEqual([2]);
  });
});

describe("nextChanged", () => {
  it("đi tới/lui và vòng lại", () => {
    expect(nextChanged([2, 5, 9], 2, 1)).toBe(5);
    expect(nextChanged([2, 5, 9], 9, 1)).toBe(2);
    expect(nextChanged([2, 5, 9], 5, -1)).toBe(2);
    expect(nextChanged([2, 5, 9], 2, -1)).toBe(9);
    expect(nextChanged([], 0, 1)).toBeNull();
  });
});

describe("diffPixels", () => {
  it("chỉ tô điểm khác nhiều", () => {
    const a = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 100, 100, 100, 255]);
    const b = new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 255, 110, 110, 110, 255]);
    const { overlay, ratio } = diffPixels(a, b);
    expect(ratio).toBeCloseTo(1 / 3);
    expect(overlay[7]).toBe(170);
    expect(overlay[3]).toBe(0);
    expect(overlay[11]).toBe(0);
  });
});
