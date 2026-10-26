import { describe, expect, it } from "vitest";
import type { FileProbe } from "./api";
import { appendUnique, applyProbe, blocked, formatBytes, makeItem, moveItem, sanitizeFileName, suggestOutput } from "./combine";

const probe = (path: string, over: Partial<FileProbe> = {}): FileProbe => ({
  path, name: path.split(/[\\/]/).pop()!, kind: "pdf", size: 1, pages: 1, error: null, needs_password: false, ...over,
});

describe("moveItem", () => {
  it("dời lên và xuống", () => {
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveItem(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
  });
  it("kẹp vị trí đích vào khoảng hợp lệ và bỏ qua vị trí sai", () => {
    expect(moveItem(["a", "b"], 0, 9)).toEqual(["b", "a"]);
    expect(moveItem(["a", "b"], 5, 0)).toEqual(["a", "b"]);
  });
});

describe("appendUnique", () => {
  it("không thêm file trùng đường dẫn, kể cả trùng ngay trong lô mới", () => {
    const list = [makeItem(probe("C:\\x\\a.pdf"))];
    const out = appendUnique(list, [probe("C:\\x\\a.pdf"), probe("C:\\x\\b.pdf"), probe("C:\\x\\b.pdf")]);
    expect(out.map((i) => i.name)).toEqual(["a.pdf", "b.pdf"]);
  });
  it("dấu trang mặc định là tên file bỏ đuôi", () => {
    expect(makeItem(probe("/d/Hợp đồng.v2.docx")).title).toBe("Hợp đồng.v2");
  });
});

describe("suggestOutput", () => {
  it("đặt cạnh file đầu tiên, giữ kiểu dấu gạch của hệ điều hành", () => {
    expect(suggestOutput([makeItem(probe("C:\\Tài liệu\\a.docx"))])).toBe("C:\\Tài liệu\\a (gộp).pdf");
    expect(suggestOutput([makeItem(probe("/home/u/a.pdf"))])).toBe("/home/u/a (gộp).pdf");
    expect(suggestOutput([])).toBe("Tài liệu gộp.pdf");
  });
});

describe("sanitizeFileName", () => {
  it("bỏ ký tự cấm và luôn có đuôi .pdf một lần", () => {
    expect(sanitizeFileName('Báo cáo: Q1/Q2?.pdf')).toBe("Báo cáo Q1Q2.pdf");
    expect(sanitizeFileName("kết quả.PDF")).toBe("kết quả.pdf");
    expect(sanitizeFileName("  . ")).toBe("Tài liệu gộp.pdf");
  });
});

describe("formatBytes", () => {
  it("chọn đơn vị phù hợp", () => {
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("mật khẩu trong hàng", () => {
  it("nhập đúng mật khẩu thì hàng hết lỗi, giữ vị trí, tên dấu trang và nhớ mật khẩu", () => {
    const locked = probe("/x/khoa.pdf", { pages: null, error: "file có mật khẩu, hãy nhập mật khẩu", needs_password: true });
    let list = appendUnique([], [probe("/x/a.pdf"), locked, probe("/x/c.pdf")]);
    expect(blocked(list)).toHaveLength(1);
    list[1] = { ...list[1], title: "Tên tự đặt" };
    list = applyProbe(list, list[1].id, probe("/x/khoa.pdf", { pages: 7 }), "bimat");
    expect(blocked(list)).toHaveLength(0);
    expect(list.map((i) => i.name)).toEqual(["a.pdf", "khoa.pdf", "c.pdf"]);
    expect(list[1]).toMatchObject({ pages: 7, title: "Tên tự đặt", password: "bimat", needs_password: false });
  });
  it("nhập sai thì hàng vẫn báo lỗi để nhập lại", () => {
    const list = appendUnique([], [probe("/x/khoa.pdf", { pages: null, error: "mật khẩu không đúng", needs_password: true })]);
    const again = applyProbe(list, list[0].id, probe("/x/khoa.pdf", { pages: null, error: "mật khẩu không đúng", needs_password: true }), "sai");
    expect(blocked(again)).toHaveLength(1);
    expect(again[0].needs_password).toBe(true);
  });
});
