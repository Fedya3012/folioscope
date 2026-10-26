import { describe, expect, it } from "vitest";
import {
  chunkEvery, displaySize, dropIndex, insertItems, moveItems, parseRanges, partName, pushHistory,
  rangeIds, redoHistory, removeItems, reverseItems, rotateItems, splitFileName, undoHistory,
  type PageItem, type Rect,
} from "./organizer";

const mk = (n: number): PageItem[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, source: "a.pdf", index: i, rot: 0, w: 595, h: 842 }));
const ids = (items: PageItem[]) => items.map((p) => p.id).join(",");
const set = (...x: string[]) => new Set(x);

describe("moveItems", () => {
  it("kéo trang 4 về sau trang 2 (như hình mẫu thiết kế)", () => {
    expect(ids(moveItems(mk(6), set("p4"), 2))).toBe("p1,p2,p4,p3,p5,p6");
  });
  it("kéo nhiều trang, giữ thứ tự tương đối", () => {
    expect(ids(moveItems(mk(6), set("p2", "p5"), 6))).toBe("p1,p3,p4,p6,p2,p5");
    expect(ids(moveItems(mk(6), set("p5", "p2"), 0))).toBe("p2,p5,p1,p3,p4,p6");
  });
  it("thả ngay cạnh chính nó thì không đổi thứ tự", () => {
    expect(ids(moveItems(mk(5), set("p3"), 2))).toBe("p1,p2,p3,p4,p5");
    expect(ids(moveItems(mk(5), set("p3"), 3))).toBe("p1,p2,p3,p4,p5");
  });
  it("vị trí ngoài phạm vi được kẹp lại", () => {
    expect(ids(moveItems(mk(3), set("p1"), 99))).toBe("p2,p3,p1");
  });
});

describe("xoay, xoá, chèn, đảo", () => {
  it("xoay cộng dồn và quay vòng", () => {
    let items = rotateItems(mk(2), set("p1"), 90);
    items = rotateItems(items, set("p1"), 90);
    expect(items[0].rot).toBe(180);
    expect(rotateItems(items, set("p1"), -270)[0].rot).toBe(270);
    expect(items[1].rot).toBe(0);
  });
  it("kích thước hiển thị đổi chỗ khi xoay 90/270", () => {
    const p = { ...mk(1)[0], rot: 90 };
    expect(displaySize(p)).toEqual([842, 595]);
    expect(displaySize({ ...p, rot: 180 })).toEqual([595, 842]);
  });
  it("xoá và chèn", () => {
    expect(ids(removeItems(mk(4), set("p2", "p3")))).toBe("p1,p4");
    const extra = [{ ...mk(1)[0], id: "x1" }, { ...mk(1)[0], id: "x2" }];
    expect(ids(insertItems(mk(3), 1, extra))).toBe("p1,x1,x2,p2,p3");
    expect(ids(insertItems(mk(2), 99, extra))).toBe("p1,p2,x1,x2");
  });
  it("đảo cả tài liệu hoặc chỉ các trang đã chọn", () => {
    expect(ids(reverseItems(mk(4), set()))).toBe("p4,p3,p2,p1");
    expect(ids(reverseItems(mk(5), set("p1", "p3", "p5")))).toBe("p5,p2,p3,p4,p1");
  });
  it("chọn dải theo thứ tự hiện tại", () => {
    expect(rangeIds(mk(6), "p5", "p2")).toEqual(["p2", "p3", "p4", "p5"]);
    expect(rangeIds(mk(3), "p1", "zz")).toEqual([]);
  });
});

describe("dropIndex", () => {
  // lưới 3 cột, ô 100x100, cách nhau 20
  const grid: Rect[] = Array.from({ length: 6 }, (_, i) => {
    const left = (i % 3) * 120, top = Math.floor(i / 3) * 120;
    return { left, top, right: left + 100, bottom: top + 100 };
  });
  it("nửa trái chèn trước, nửa phải chèn sau", () => {
    expect(dropIndex(grid, 10, 50)).toBe(0);
    expect(dropIndex(grid, 90, 50)).toBe(1);
    expect(dropIndex(grid, 130, 50)).toBe(1);
  });
  it("chọn đúng hàng khi thả vào khe giữa hai hàng và ngoài mép", () => {
    expect(dropIndex(grid, 10, 170)).toBe(3);
    expect(dropIndex(grid, 500, 50)).toBe(3);
    expect(dropIndex(grid, 500, 500)).toBe(6);
    expect(dropIndex(grid, -50, -50)).toBe(0);
  });
  it("danh sách rỗng", () => {
    expect(dropIndex([], 5, 5)).toBe(0);
  });
});

describe("tách file", () => {
  it("đọc khoảng trang", () => {
    expect(parseRanges("1-3, 5 ; 7-9", 10)).toEqual([[0, 1, 2], [4], [6, 7, 8]]);
  });
  it("báo lỗi tiếng Việt rõ ràng", () => {
    expect(() => parseRanges("", 5)).toThrow(/nhập khoảng trang/);
    expect(() => parseRanges("a-b", 5)).toThrow(/Không hiểu/);
    expect(() => parseRanges("4-2", 5)).toThrow(/không hợp lệ/);
    expect(() => parseRanges("0-2", 5)).toThrow(/không hợp lệ/);
    expect(() => parseRanges("3-9", 5)).toThrow(/vượt quá 5 trang/);
  });
  it("chia đều theo số trang", () => {
    expect(chunkEvery(2, 5)).toEqual([[0, 1], [2, 3], [4]]);
    expect(() => chunkEvery(0, 5)).toThrow();
    expect(() => chunkEvery(1.5, 5)).toThrow();
  });
  it("đặt tên file con", () => {
    expect(partName("hop-dong", 3, 12)).toBe("hop-dong_phan-03.pdf");
    expect(partName("a", 1, 150)).toBe("a_phan-001.pdf");
  });
  it("tách đường dẫn Windows và Unix", () => {
    expect(splitFileName("C:\\Tai lieu\\Báo cáo.PDF")).toEqual({ dir: "C:\\Tai lieu", sep: "\\", base: "Báo cáo" });
    expect(splitFileName("/home/a/b.pdf")).toEqual({ dir: "/home/a", sep: "/", base: "b" });
  });
});

describe("lịch sử hoàn tác", () => {
  it("hoàn tác rồi làm lại", () => {
    const v1 = mk(3), v2 = removeItems(v1, set("p1"));
    let h = pushHistory({ past: [], future: [] }, v1);
    const undone = undoHistory(h, v2)!;
    expect(ids(undone.items)).toBe("p1,p2,p3");
    h = undone.history;
    const redone = redoHistory(h, undone.items)!;
    expect(ids(redone.items)).toBe("p2,p3");
    expect(redoHistory(redone.history, redone.items)).toBeNull();
  });
  it("thao tác mới xoá nhánh làm lại", () => {
    const h = pushHistory({ past: [], future: [mk(1)] }, mk(2));
    expect(h.future).toEqual([]);
  });
  it("không hoàn tác được khi chưa có gì", () => {
    expect(undoHistory({ past: [], future: [] }, mk(1))).toBeNull();
  });
});
