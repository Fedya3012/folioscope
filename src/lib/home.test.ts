import { describe, expect, it } from "vitest";
import { addRecent, routeDrop, formatBytes, parseRecent, relativeTime, removeRecent, sortRecent, togglePin, type RecentFile } from "./recent";
import { DEFAULT_SETTINGS, greeting, initialZoom, resolveTheme, sanitizeSettings } from "./settings";

const f = (path: string, openedAt: number, extra: Partial<RecentFile> = {}): RecentFile =>
  ({ path, name: path.split("/").pop()!, openedAt, size: null, pages: null, pinned: false, ...extra });

describe("recent", () => {
  it("đưa file vừa mở lên đầu và không trùng", () => {
    const list = addRecent([f("/a.pdf", 1), f("/b.pdf", 2)], { path: "/a.pdf", openedAt: 9, size: 5, pages: 3 }, 20);
    expect(list.map((x) => x.path)).toEqual(["/a.pdf", "/b.pdf"]);
    expect(list[0]).toMatchObject({ openedAt: 9, size: 5, pages: 3 });
  });
  it("giữ ghim cũ và giữ size cũ khi lần mở mới không biết size", () => {
    const list = addRecent([f("/a.pdf", 1, { pinned: true, size: 7 })], { path: "/a.pdf", openedAt: 2, size: null, pages: null }, 20);
    expect(list[0]).toMatchObject({ pinned: true, size: 7 });
  });
  it("cắt theo giới hạn nhưng không bỏ file đã ghim", () => {
    const list = addRecent([f("/old.pdf", 1, { pinned: true }), f("/x.pdf", 2)], { path: "/new.pdf", openedAt: 3, size: null, pages: null }, 1);
    expect(list.map((x) => x.path)).toEqual(["/new.pdf", "/old.pdf"]);
  });
  it("ghim, bỏ, sắp xếp", () => {
    let list = [f("/b.pdf", 1, { size: 10 }), f("/a.pdf", 2, { size: 99 })];
    list = togglePin(list, "/b.pdf");
    expect(list[0].pinned).toBe(true);
    expect(sortRecent(list, "name").map((x) => x.path)).toEqual(["/a.pdf", "/b.pdf"]);
    expect(sortRecent(list, "size")[0].path).toBe("/a.pdf");
    expect(sortRecent(list, "openedAt")[0].path).toBe("/a.pdf");
    expect(removeRecent(list, "/a.pdf")).toHaveLength(1);
  });
  it("đọc dữ liệu hỏng mà không văng lỗi", () => {
    expect(parseRecent("x")).toEqual([]);
    expect(parseRecent([null, { path: 3 }, { path: "C:\\x\\y.pdf", openedAt: 5 }])).toEqual([
      { path: "C:\\x\\y.pdf", name: "y.pdf", openedAt: 5, size: null, pages: null, pinned: false },
    ]);
  });
  it("thời gian tương đối và dung lượng", () => {
    const now = 1_000_000_000;
    expect(relativeTime(now - 30_000, now)).toBe("vừa xong");
    expect(relativeTime(now - 2 * 3600_000, now)).toBe("2 giờ trước");
    expect(relativeTime(now - 3 * 86400_000, now)).toBe("3 ngày trước");
    expect(formatBytes(4_400_000)).toBe("4,2 MB");
    expect(formatBytes(null)).toBe("—");
  });
});

describe("settings", () => {
  it("giá trị lạ rơi về mặc định", () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings({ theme: "neon", uiSize: 99, accent: "rose", recentLimit: 50 }))
      .toMatchObject({ theme: "system", uiSize: 13, accent: "rose", recentLimit: 50 });
  });
  it("chủ đề theo hệ thống", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
  });
  it("zoom mặc định", () => {
    expect(initialZoom("actual")).toEqual({ zoom: 1, fit: null });
    expect(initialZoom("page")).toEqual({ fit: "page" });
  });
  it("lời chào theo giờ", () => {
    expect(greeting(8)).toBe("Chào buổi sáng");
    expect(greeting(15)).toBe("Chào buổi chiều");
    expect(greeting(20)).toBe("Chào buổi tối");
  });
});

describe("thả file", () => {
  it("một PDF thì mở, còn lại thì gộp", () => {
    expect(routeDrop([])).toBeNull();
    expect(routeDrop(["C:\\a\\B.PDF"])).toEqual({ open: "C:\\a\\B.PDF" });
    expect(routeDrop(["a.docx"])).toEqual({ combine: ["a.docx"] });
    expect(routeDrop(["a.pdf", "b.pdf"])).toEqual({ combine: ["a.pdf", "b.pdf"] });
  });
});
