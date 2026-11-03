import { describe, expect, it } from "vitest";
import { clampMenu, tidyItems } from "./ctxMenu";
import { addSearch } from "./recentSearches";
import { markupFromRuns } from "../annotations/fromSelection";

describe("menu chuột phải", () => {
  it("đẩy menu vào trong khung nhìn", () => {
    expect(clampMenu(790, 590, 200, 100, 800, 600)).toEqual({ x: 596, y: 496 });
    expect(clampMenu(-5, 2, 50, 50, 800, 600)).toEqual({ x: 4, y: 4 });
  });
  it("bỏ dấu ngăn thừa", () => {
    const a = { label: "A", run() {} }, b = { label: "B", run() {} };
    expect(tidyItems([{ sep: true }, a, { sep: true }, { sep: true }, false, b, { sep: true }])).toEqual([a, { sep: true }, b]);
  });
});

describe("tìm gần đây", () => {
  it("đưa lên đầu, bỏ trùng không phân biệt hoa thường, giới hạn số lượng", () => {
    expect(addSearch(["b", "Foo", "c"], "foo")).toEqual(["foo", "b", "c"]);
    expect(addSearch([], "  ")).toEqual([]);
    expect(addSearch(["a", "b", "c"], "d", 3)).toEqual(["d", "a", "b"]);
  });
});

describe("tô/gạch từ vùng chọn", () => {
  it("gộp các đoạn cùng dòng, tách dòng khác", () => {
    const m = markupFromRuns([[0.1, 0.1, 0.1, 0.02], [0.25, 0.101, 0.1, 0.02], [0.1, 0.2, 0.2, 0.02]], 3, "highlight", "#FFD60A")!;
    expect(m.page).toBe(3);
    expect(m.rects).toHaveLength(2);
    expect(m.rects![0].w).toBeCloseTo(0.25, 5);
    expect(markupFromRuns([], 0, "underline", "#000")).toBeNull();
  });
});

import { filterAnnotations } from "../annotations/filter";
describe("lọc ghi chú", () => {
  const mk = (o: object) => ({ id: "x", page: 0, kind: "note", color: "#FFD60A", strokeWidth: 1, ...o }) as never;
  const items = [mk({ id: "1", text: "Xin chào", author: "An" }), mk({ id: "2", kind: "highlight", color: "#FF453A", author: "Bình" }), mk({ id: "3", status: "resolved", replies: [{ id: "r", author: "An", at: 0, text: "Đồng ý" }] })];
  const base = { status: "all", q: "", kind: "all", color: "all", who: "all" } as const;
  it("lọc theo từng tiêu chí", () => {
    expect(filterAnnotations(items, { ...base, kind: "highlight" }).map((a) => a.id)).toEqual(["2"]);
    expect(filterAnnotations(items, { ...base, color: "#ff453a" }).map((a) => a.id)).toEqual(["2"]);
    expect(filterAnnotations(items, { ...base, who: "An" }).map((a) => a.id)).toEqual(["1", "3"].filter((i) => i === "1"));
    expect(filterAnnotations(items, { ...base, q: "đồng" }).map((a) => a.id)).toEqual(["3"]);
    expect(filterAnnotations(items, { ...base, status: "resolved" }).map((a) => a.id)).toEqual(["2", "3"]);
  });
});
