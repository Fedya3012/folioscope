import { describe, expect, it } from "vitest";
import type { FileProbe } from "./api";
import { appendUnique, formatBytes, makeItem, moveItem, sanitizeFileName, suggestOutput } from "./combine";

const probe = (path: string, over: Partial<FileProbe> = {}): FileProbe => ({
  path, name: path.split(/[\\/]/).pop()!, kind: "pdf", size: 1, pages: 1, error: null, ...over,
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
