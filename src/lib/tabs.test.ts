import { describe, expect, it } from "vitest";
import { addTab, cycleTab, dropIndex, moveTab, parsePositions, POS_LIMIT, removeTab, savePosition, tabLabels } from "./tabs";

describe("tabs", () => {
  it("addTab chèn sau tab đang chọn và không trùng", () => {
    expect(addTab(["a", "b", "c"], "x", "a")).toEqual(["a", "x", "b", "c"]);
    expect(addTab(["a", "b"], "x", null)).toEqual(["a", "b", "x"]);
    expect(addTab(["a", "b"], "b", "a")).toEqual(["a", "b"]);
  });
  it("removeTab chọn tab bên phải, rồi bên trái", () => {
    expect(removeTab(["a", "b", "c"], "b")).toEqual({ tabs: ["a", "c"], next: "c" });
    expect(removeTab(["a", "b", "c"], "c")).toEqual({ tabs: ["a", "b"], next: "b" });
    expect(removeTab(["a"], "a")).toEqual({ tabs: [], next: null });
    expect(removeTab(["a"], "z")).toEqual({ tabs: ["a"], next: null });
  });
  it("moveTab dời và chặn biên", () => {
    expect(moveTab(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveTab(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveTab(["a", "b", "c"], 1, 99)).toEqual(["a", "c", "b"]);
    expect(moveTab(["a", "b"], 5, 0)).toEqual(["a", "b"]);
  });
  it("cycleTab đi vòng", () => {
    expect(cycleTab(["a", "b", "c"], "c", 1)).toBe("a");
    expect(cycleTab(["a", "b", "c"], "a", -1)).toBe("c");
    expect(cycleTab(["a", "b"], null, 1)).toBe("a");
    expect(cycleTab([], null, 1)).toBeNull();
  });
  it("dropIndex đếm tâm tab bên trái con trỏ", () => {
    const centers = [50, 150, 250];
    expect(dropIndex(centers, 0, 10)).toBe(0);
    expect(dropIndex(centers, 0, 200)).toBe(1);
    expect(dropIndex(centers, 0, 999)).toBe(2);
  });
  it("tabLabels phân biệt file trùng tên", () => {
    const l = tabLabels(["C:\\x\\a.pdf", "C:\\y\\a.pdf", "C:\\y\\b.pdf"]);
    expect(l["C:\\x\\a.pdf"]).toBe("a.pdf (x)");
    expect(l["C:\\y\\a.pdf"]).toBe("a.pdf (y)");
    expect(l["C:\\y\\b.pdf"]).toBe("b.pdf");
  });
  it("vị trí đọc: lọc rác và giới hạn số lượng", () => {
    expect(parsePositions({ a: { page: 3, zoom: 1.5, fit: "width", viewMode: "single", at: 1 }, b: { page: -1, zoom: 1 }, c: 5 })).toEqual({
      a: { page: 3, zoom: 1.5, fit: "width", viewMode: "single", at: 1 },
    });
    let all = {};
    for (let i = 0; i < POS_LIMIT + 5; i++) all = savePosition(all, `f${i}`, { page: 0, zoom: 1, fit: null, viewMode: "continuous", at: i });
    expect(Object.keys(all)).toHaveLength(POS_LIMIT);
    expect(all).not.toHaveProperty("f0");
    expect(all).toHaveProperty(`f${POS_LIMIT + 4}`);
  });
});
