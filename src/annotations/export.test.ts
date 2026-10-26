import { describe, expect, it } from "vitest";
import { threadText, toSaveItems } from "./export";
import type { Annotation } from "./types";

const base = { id: "a", page: 2, color: "#FFD60A", strokeWidth: 2 } as const;

describe("toSaveItems", () => {
  it("đánh dấu nhiều dòng thành mỗi dòng một chú thích", () => {
    const a: Annotation = { ...base, kind: "highlight", rect: { x: 0, y: 0, w: 1, h: 1 }, rects: [{ x: 0.1, y: 0.1, w: 0.5, h: 0.02 }, { x: 0.1, y: 0.14, w: 0.3, h: 0.02 }] };
    const out = toSaveItems([a]);
    expect(out.map((i) => i.kind)).toEqual(["highlight", "highlight"]);
    expect(out[1].rect).toEqual(a.rects![1]);
  });
  it("đánh dấu khung tự do (trang ảnh quét) vẫn lưu một chú thích", () => {
    expect(toSaveItems([{ ...base, kind: "underline", rect: { x: 0, y: 0, w: 0.2, h: 0.02 } }])).toHaveLength(1);
  });
  it("bình luận gộp cả chuỗi trả lời và trạng thái", () => {
    const a: Annotation = { ...base, kind: "note", rect: { x: 0.1, y: 0.1, w: 0, h: 0 }, text: "Kiểm tra số liệu", status: "resolved", replies: [{ id: "r", author: "Lan", at: 0, text: "Đã sửa" }] };
    const t = threadText(a);
    expect(t).toContain("[Đã giải quyết] Kiểm tra số liệu");
    expect(t).toContain("↳ Lan");
    expect(toSaveItems([a])[0].text).toBe(t);
  });
  it("tem thành khung và chữ", () => {
    const out = toSaveItems([{ ...base, kind: "stamp", stamp: "ĐÃ DUYỆT", rect: { x: 0.1, y: 0.1, w: 0.26, h: 0.07 } }]);
    expect(out.map((i) => i.kind)).toEqual(["rect", "text"]);
    expect(out[1].text).toBe("ĐÃ DUYỆT");
  });
  it("đo diện tích khép kín đa giác và kèm nhãn số đo", () => {
    const pts = [{ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.1 }, { x: 0.4, y: 0.4 }];
    const out = toSaveItems([{ ...base, kind: "area", points: pts, label: "12 cm²" }]);
    expect(out[0].points).toHaveLength(4);
    expect(out[1]).toMatchObject({ kind: "text", text: "12 cm²" });
  });
  it("đo khoảng cách thành đường thẳng và nhãn", () => {
    const out = toSaveItems([{ ...base, kind: "distance", points: [{ x: 0.1, y: 0.5 }, { x: 0.5, y: 0.5 }], label: "5 cm" }]);
    expect(out.map((i) => i.kind)).toEqual(["line", "text"]);
  });
});
