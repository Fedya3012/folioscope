import { describe, expect, it } from "vitest";
import {
  checkCrop, chunkByBytes, gapAt, estimatePageBytes, clearNumbers, croppedSize, cropItems, groupsByBookmarks, numberItems, numberLabel,
  parseSingleRange, replaceItems, rotateCrop,
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

describe("cắt lề", () => {
  const c = { l: 10, t: 20, r: 30, b: 40 };
  it("đặt và bỏ lề cho trang đã chọn", () => {
    const cropped = cropItems(mk(3), set("p2"), c);
    expect(cropped[1].crop).toEqual(c);
    expect(cropped[0].crop).toBeUndefined();
    expect(croppedSize(cropped[1])).toEqual([555, 782]);
    expect(cropItems(cropped, set("p2"), null)[1].crop).toBeUndefined();
    expect(cropItems(cropped, set("p2"), { l: 0, t: 0, r: 0, b: 0 })[1].crop).toBeUndefined();
  });
  it("xoay trang thì lề đi theo các cạnh", () => {
    // xoay phải: cạnh trái thành cạnh trên, cạnh trên thành cạnh phải...
    expect(rotateCrop(c, 90)).toEqual({ l: 40, t: 10, r: 20, b: 30 });
    expect(rotateCrop(c, 360)).toEqual(c);
    expect(rotateCrop(rotateCrop(c, 90), -90)).toEqual(c);
    const r = rotateItems(cropItems(mk(1), set("p1"), c), set("p1"), 90);
    expect(r[0].crop).toEqual({ l: 40, t: 10, r: 20, b: 30 });
  });
  it("không cho cắt hết trang hoặc nhập số âm", () => {
    expect(checkCrop(mk(1), set("p1"), c)).toBeNull();
    expect(checkCrop(mk(1), set("p1"), { l: 300, t: 0, r: 300, b: 0 })).toMatch(/quá lớn/);
    expect(checkCrop(mk(1), set("p1"), { l: -1, t: 0, r: 0, b: 0 })).toMatch(/không âm/);
    expect(checkCrop(mk(1), set("p1"), { l: Number.NaN, t: 0, r: 0, b: 0 })).toMatch(/không âm/);
  });
});

describe("đánh số trang", () => {
  const spec = { format: "n" as const, start: 1, pos: "bc" as const, size: 10, marginMm: 10 };
  it("đánh số cả tài liệu khi không chọn trang nào", () => {
    const out = numberItems(mk(3), set(), { ...spec, start: 5, format: "n-tren-tong" });
    expect(out.map((p) => p.stamp?.text)).toEqual(["5 / 7", "6 / 7", "7 / 7"]);
    expect(out[0].stamp?.margin).toBeCloseTo(28.35, 1);
  });
  it("chỉ đánh số trang đã chọn, theo thứ tự hiện tại", () => {
    const out = numberItems(mk(4), set("p4", "p2"), { ...spec, format: "trang-n" });
    expect(out.map((p) => p.stamp?.text)).toEqual([undefined, "Trang 1", undefined, "Trang 2"]);
  });
  it("gỡ số trang", () => {
    const numbered = numberItems(mk(3), set(), spec);
    expect(clearNumbers(numbered, set("p1"))[0].stamp).toBeUndefined();
    expect(clearNumbers(numbered, set("p1"))[1].stamp).toBeDefined();
    expect(clearNumbers(numbered, set()).every((p) => !p.stamp)).toBe(true);
  });
  it("định dạng nhãn", () => {
    expect([numberLabel("n", 3, 9), numberLabel("trang-n", 3, 9), numberLabel("n-tren-tong", 3, 9)]).toEqual(["3", "Trang 3", "3 / 9"]);
  });
});

describe("thay trang, tách theo dấu trang và dung lượng", () => {
  it("thay trang đặt trang mới đúng chỗ trang đầu bị thay", () => {
    const added = [{ ...mk(1)[0], id: "n1" }, { ...mk(1)[0], id: "n2" }];
    expect(ids(replaceItems(mk(5), set("p2", "p3"), added))).toBe("p1,n1,n2,p4,p5");
    expect(ids(replaceItems(mk(5), set("p5"), added.slice(0, 1)))).toBe("p1,p2,p3,p4,n1");
    expect(ids(replaceItems(mk(3), set("zz"), added))).toBe("p1,p2,p3");
  });
  it("đọc khoảng trang nguồn", () => {
    expect(parseSingleRange("2-4", 10)).toEqual([1, 2, 3]);
    expect(parseSingleRange("", 3)).toEqual([0, 1, 2]);
    expect(() => parseSingleRange("9", 3)).toThrow();
  });
  it("tách theo dấu trang: mỗi dấu trang mở một nhóm, trang đầu luôn mở nhóm", () => {
    expect(groupsByBookmarks(mk(7), "a.pdf", new Set([0, 3, 5]))).toEqual([[0, 1, 2], [3, 4], [5, 6]]);
    expect(groupsByBookmarks(mk(4), "a.pdf", new Set([2]))).toEqual([[0, 1], [2, 3]]);
    // trang từ file khác không bị coi là đích dấu trang của file gốc
    const mixed = [...mk(2), { ...mk(1)[0], id: "x", source: "b.pdf", index: 0 }];
    expect(groupsByBookmarks(mixed, "a.pdf", new Set([0]))).toEqual([[0, 1, 2]]);
  });
  it("tách theo dung lượng: gom trang tới khi vượt giới hạn, tối thiểu một trang mỗi file", () => {
    const mb = 1_000_000;
    expect(chunkByBytes([1, 1, 1, 1, 1, 1, 1, 1, 1, 1].map((n) => n * mb), 3 * mb)).toEqual([[0, 1, 2], [3, 4, 5], [6, 7, 8], [9]]);
    // trang nặng nằm riêng, kể cả khi tự nó vượt giới hạn
    expect(chunkByBytes([1 * mb, 5 * mb, 1 * mb], 2 * mb)).toEqual([[0], [1], [2]]);
    expect(chunkByBytes([], mb)).toEqual([]);
    expect(() => chunkByBytes([1], 0)).toThrow();
  });
  it("ước lượng dung lượng trang", () => {
    const [p] = mk(1);
    expect(estimatePageBytes(p, { bytes: 1000, pages: 10 })).toBe(100);
    expect(estimatePageBytes({ ...p, source: null }, undefined)).toBe(1024);
  });
});

describe("khe giữa các trang (nút +)", () => {
  // hai hàng, mỗi hàng 2 ô rộng 100, cách nhau 24; hàng 2 cách hàng 1 32
  const r = (left: number, top: number): Rect => ({ left, top, right: left + 100, bottom: top + 130 });
  const rects = [r(32, 32), r(156, 32), r(32, 194), r(156, 194)];
  it("chỉ hiện khi con trỏ gần khe, trả đúng vị trí chèn", () => {
    expect(gapAt(rects, 144, 90)).toEqual({ at: 1, x: 144, y: 97 }); // giữa ô 1 và ô 2
    expect(gapAt(rects, 150, 90)?.at).toBe(1);
    expect(gapAt(rects, 80, 90)).toBeNull(); // giữa thân trang thì không
  });
  it("khe đầu hàng và sau trang cuối", () => {
    expect(gapAt(rects, 20, 250)).toEqual({ at: 2, x: 20, y: 259 }); // đầu hàng 2
    expect(gapAt(rects, 268, 250)?.at).toBe(4); // sau trang cuối
    expect(gapAt(rects, 20, 90)?.at).toBe(0);
  });
  it("ngoài khoảng cao của hàng thì không có khe; danh sách rỗng", () => {
    expect(gapAt(rects, 144, 170)).toBeNull();
    expect(gapAt([], 10, 10)).toBeNull();
  });
});
