import { describe, expect, it } from "vitest";
import { dirOf, kindOf, needsOcr, needsOffice, splitByTarget, summarize, targetInfo, TARGETS } from "./convert";

describe("kindOf", () => {
  it("phân loại theo đuôi, không phân biệt hoa thường", () => {
    expect(kindOf("C:\\a\\Bao cao.PDF")).toBe("pdf");
    expect(kindOf("/x/anh.JPeG")).toBe("image");
    expect(kindOf("a.docx")).toBe("office");
    expect(kindOf("a.zip")).toBe("other");
    expect(kindOf("khongduoi")).toBe("other");
  });
});

describe("splitByTarget", () => {
  const files = ["a.pdf", "b.docx", "c.png", "d.zip"];
  it("PDF sang Word chỉ nhận PDF", () => {
    expect(splitByTarget("docx", false, files)).toEqual({ ok: ["a.pdf"], rejected: ["b.docx", "c.png", "d.zip"] });
  });
  it("Sang PDF nhận Office và ảnh; chỉ nhận PDF khi bật PDF/A", () => {
    expect(splitByTarget("to_pdf", false, files).ok).toEqual(["b.docx", "c.png"]);
    expect(splitByTarget("to_pdf", true, files).ok).toEqual(["a.pdf", "b.docx", "c.png"]);
  });
  it("OCR nhận ảnh và PDF", () => {
    expect(splitByTarget("ocr", false, files)).toEqual({ ok: ["a.pdf", "c.png"], rejected: ["b.docx", "d.zip"] });
  });
});

describe("cần cài thêm gì", () => {
  it("LibreOffice cho Word/PowerPoint, Office sang PDF và PDF/A", () => {
    expect(needsOffice("docx", false, ["a.pdf"])).toBe(true);
    expect(needsOffice("pptx", false, ["a.pdf"])).toBe(true);
    expect(needsOffice("to_pdf", false, ["a.docx"])).toBe(true);
    expect(needsOffice("to_pdf", false, ["a.png"])).toBe(false);
    expect(needsOffice("to_pdf", true, ["a.png"])).toBe(true);
    expect(needsOffice("xlsx", false, ["a.pdf"])).toBe(false);
    expect(needsOffice("png", false, ["a.pdf"])).toBe(false);
  });
  it("Tesseract chỉ cho OCR", () => {
    expect(needsOcr("ocr")).toBe(true);
    expect(needsOcr("txt")).toBe(false);
  });
});

describe("khác", () => {
  it("mỗi kiểu có thông tin riêng", () => {
    expect(new Set(TARGETS.map((t) => t.id)).size).toBe(TARGETS.length);
    expect(targetInfo("xlsx").label).toContain("Excel");
  });
  it("lấy thư mục của file ở cả hai kiểu dấu gạch", () => {
    expect(dirOf("C:\\Tai lieu\\a.pdf")).toBe("C:\\Tai lieu");
    expect(dirOf("/home/a/b.pdf")).toBe("/home/a");
    expect(dirOf("a.pdf")).toBe("");
  });
  it("tóm tắt kết quả", () => {
    expect(summarize([
      { input: "a", outputs: ["a.docx"], error: null },
      { input: "b", outputs: [], error: "lỗi" },
    ])).toEqual({ done: 1, failed: 1, outputs: ["a.docx"] });
  });
});
