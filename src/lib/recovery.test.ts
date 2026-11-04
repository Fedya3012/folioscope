import { describe, expect, it } from "vitest";
import { parseRecovery, withEntry, withoutEntry } from "./recovery";

const it1 = [{ id: "a", page: 0, kind: "note", color: "#000", strokeWidth: 1 }] as never;
describe("khôi phục sau sự cố", () => {
  it("lọc dữ liệu hỏng và bản quá 14 ngày", () => {
    const now = 1_000_000_000_000;
    const raw = { "/a.pdf": { items: it1, at: now - 1000 }, "/old.pdf": { items: it1, at: now - 15 * 24 * 3600 * 1000 }, "/bad.pdf": { items: [], at: now }, "/x": 5 };
    expect(Object.keys(parseRecovery(raw, now))).toEqual(["/a.pdf"]);
    expect(parseRecovery(null)).toEqual({});
  });
  it("thêm và bỏ bản nháp theo file", () => {
    const r = withEntry({}, "/a.pdf", it1, 5);
    expect(r["/a.pdf"].at).toBe(5);
    expect(withoutEntry(r, "/a.pdf")).toEqual({});
    expect(Object.keys(withoutEntry(r, "/zzz"))).toEqual(["/a.pdf"]);
  });
});
