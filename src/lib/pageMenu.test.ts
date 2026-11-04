import { describe, expect, it } from "vitest";
import { pageProperties, pagesLabel, paperName } from "./pageMenu";

describe("menu trang", () => {
  it("nhận ra khổ giấy phổ biến", () => {
    expect(paperName(595, 842)).toBe("A4");
    expect(paperName(842, 595)).toBe("A4");
    expect(paperName(612, 792)).toBe("Letter");
    expect(paperName(300, 300)).toBeNull();
  });
  it("nhãn số trang", () => { expect(pagesLabel(1)).toBe("trang"); expect(pagesLabel(3)).toBe("3 trang"); });
  it("mô tả thuộc tính trang", () => {
    const p = { id: "a", source: "/x/a.pdf", index: 2, rot: 90, w: 595, h: 842 };
    const m = Object.fromEntries(pageProperties(p, 3, 10));
    expect(m["Vị trí"]).toBe("3 / 10");
    expect(m["Khổ trang"]).toContain("A4");
    expect(m["Nguồn"]).toBe("a.pdf · trang 3");
    expect(pageProperties({ ...p, source: null }, 1, 1).find(([k]) => k === "Nguồn")![1]).toBe("Trang trắng");
  });
});

import { siblingPath } from "../organizerStore";
describe("đường dẫn gợi ý", () => {
  it("đặt tên cạnh file gốc", () => {
    expect(siblingPath("/a/b/sach.pdf", "_x")).toBe("/a/b/sach_x.pdf");
    expect(siblingPath("C:\\d\\sach.PDF", "_x")).toBe("C:\\d\\sach_x.pdf");
  });
});
