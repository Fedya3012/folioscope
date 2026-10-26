import { describe, expect, it } from "vitest";
import { buildContext, buildPrompt, redactSensitive, splitCitations } from "./ai";

describe("redactSensitive", () => {
  it("che email, thẻ, CCCD, CMND", () => {
    expect(redactSensitive("liên hệ a.b@mail.com")).toBe("liên hệ [email]");
    expect(redactSensitive("thẻ 4111 1111 1111 1111 hết hạn")).toBe("thẻ [số thẻ] hết hạn");
    expect(redactSensitive("CCCD 012345678901.")).toBe("CCCD [số CCCD].");
    expect(redactSensitive("CMND 123456789")).toBe("CMND [số CMND]");
  });
  it("giữ nguyên số thường", () => {
    expect(redactSensitive("Năm 2026, giá 1.250.000 đồng, 15 trang")).toBe("Năm 2026, giá 1.250.000 đồng, 15 trang");
  });
});

describe("buildContext", () => {
  const pages = ["một", "hai", "ba"];
  it("đánh dấu số trang", () => {
    const c = buildContext(pages, 0, 1, false);
    expect(c.text).toBe("[Trang 1]\nmột\n\n[Trang 2]\nhai");
    expect(c.truncated).toBe(false);
  });
  it("cắt khi quá dài", () => {
    const c = buildContext(pages, 0, 2, false, 30);
    expect(c.truncated).toBe(true);
    expect(c.lastPage).toBe(1);
  });
  it("che dữ liệu khi được yêu cầu", () => {
    expect(buildContext(["mail a@b.vn"], 0, 0, true).text).toContain("[email]");
  });
});

describe("splitCitations", () => {
  it("tách nguồn trang hợp lệ", () => {
    const p = splitCitations("Giá tăng [tr. 3] và [tr. 2-4], sai [tr. 99].", 10);
    expect(p.filter((x) => "page" in x).map((x) => (x as { page: number }).page)).toEqual([2, 1]);
    expect(p.map((x) => ("text" in x ? x.text : "")).join("")).toBe("Giá tăng  và , sai [tr. 99].");
  });
});

describe("buildPrompt", () => {
  it("nhét câu hỏi sau tài liệu", () => {
    const p = buildPrompt("ask", "[Trang 1]\nx", { question: "Ai viết?" });
    expect(p.user).toContain("<tai_lieu>");
    expect(p.user.endsWith("Câu hỏi: Ai viết?")).toBe(true);
  });
});
