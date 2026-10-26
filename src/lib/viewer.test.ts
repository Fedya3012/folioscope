import { describe, expect, it } from "vitest";
import { isPageTheme, nextPageTheme, passwordFailure, zoomChoice, fitPageZoom, fitWidthZoom, pageAtScroll, pageOffsets, pageWidthPx, parsePageInput, stepIndex, wheelZoom, PAGE_GAP, PAGE_PAD } from "./viewer";

const A4: [number, number] = [595, 842];

describe("kích thước", () => {
  it("100% là kích thước thật (A4 ≈ 794px)", () => {
    expect(pageWidthPx(595.28, 1)).toBe(794);
  });
  it("vừa bề rộng khớp khung nhìn trừ lề", () => {
    const z = fitWidthZoom(1000, [A4, [300, 400]]);
    expect(pageWidthPx(A4[0], z) + PAGE_PAD * 2).toBeCloseTo(1000, -1);
  });
  it("vừa trang chọn chiều chật hơn", () => {
    expect(fitPageZoom(2000, 600, A4)).toBeLessThan(fitWidthZoom(2000, [A4]));
  });
});

describe("pageAtScroll", () => {
  const { tops, total } = pageOffsets([A4, A4, A4], 1);
  it("đỉnh các trang cách nhau đúng chiều cao + khoảng hở", () => {
    expect(tops[0]).toBe(PAGE_PAD);
    expect(tops[1] - tops[0]).toBe(Math.round(842 * (96 / 72)) + PAGE_GAP);
    expect(total).toBeGreaterThan(tops[2]);
  });
  it("chọn trang ở giữa khung nhìn", () => {
    expect(pageAtScroll(tops, 0, 800)).toBe(0);
    expect(pageAtScroll(tops, tops[1] - 100, 800)).toBe(1);
    expect(pageAtScroll(tops, 99999, 800)).toBe(2);
  });
});

describe("parsePageInput / stepIndex / wheelZoom", () => {
  it("đổi số trang người dùng gõ", () => {
    expect(parsePageInput("5", 10)).toBe(4);
    expect(parsePageInput("99", 10)).toBe(9);
    expect(parsePageInput("0", 10)).toBe(0);
    expect(parsePageInput("abc", 10)).toBeNull();
  });
  it("đi vòng trong kết quả tìm", () => {
    expect(stepIndex(-1, 3, 1)).toBe(0);
    expect(stepIndex(-1, 3, -1)).toBe(2);
    expect(stepIndex(2, 3, 1)).toBe(0);
    expect(stepIndex(0, 3, -1)).toBe(2);
    expect(stepIndex(0, 0, 1)).toBe(-1);
  });
  it("lăn lên phóng to, lăn xuống thu nhỏ", () => {
    expect(wheelZoom(1, -100)).toBeGreaterThan(1);
    expect(wheelZoom(1, 100)).toBeLessThan(1);
  });
});

describe("màu nền trang", () => {
  it("xoay vòng trắng → đêm → sepia → trắng", () => {
    expect(nextPageTheme("normal")).toBe("night");
    expect(nextPageTheme("night")).toBe("sepia");
    expect(nextPageTheme("sepia")).toBe("normal");
  });
  it("nhận ra giá trị hợp lệ", () => {
    expect(isPageTheme("night")).toBe(true);
    expect(isPageTheme("x")).toBe(false);
    expect(isPageTheme(null)).toBe(false);
  });
});

describe("zoomChoice", () => {
  it("ưu tiên chế độ vừa", () => {
    expect(zoomChoice(1.3, "width")).toBe("width");
    expect(zoomChoice(1, "page")).toBe("page");
  });
  it("khớp mức có sẵn hoặc báo lẻ", () => {
    expect(zoomChoice(1.5, null)).toBe("1.5");
    expect(zoomChoice(1.5001, null)).toBe("1.5");
    expect(zoomChoice(1.37, null)).toBe("custom");
  });
});

describe("passwordFailure", () => {
  it("nhận ra hai lỗi mật khẩu của lõi", () => {
    expect(passwordFailure("PASSWORD_REQUIRED")).toBe("required");
    expect(passwordFailure(new Error("WRONG_PASSWORD"))).toBe("wrong");
    expect(passwordFailure("không mở được file")).toBeNull();
  });
});
