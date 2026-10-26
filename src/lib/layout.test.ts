import { describe, expect, it } from "vitest";
import { LEFT, RIGHT, resolvePanelWidth, stepZoom } from "./layout";

describe("resolvePanelWidth", () => {
  it("giữ trong khoảng cho phép", () => {
    expect(resolvePanelWidth(900, LEFT)).toEqual({ open: true, width: 420 });
    expect(resolvePanelWidth(210, LEFT)).toEqual({ open: true, width: 210 });
    expect(resolvePanelWidth(170, RIGHT)).toEqual({ open: true, width: 280 });
  });
  it("tự thu gọn khi kéo dưới 160px", () => {
    expect(resolvePanelWidth(120, LEFT).open).toBe(false);
  });
});

describe("stepZoom", () => {
  it("nhảy đúng bậc", () => {
    expect(stepZoom(1, 1)).toBe(1.25);
    expect(stepZoom(1, -1)).toBe(0.75);
    expect(stepZoom(1.1, 1)).toBe(1.25);
  });
  it("không vượt giới hạn", () => {
    expect(stepZoom(4, 1)).toBe(4);
    expect(stepZoom(0.25, -1)).toBe(0.25);
  });
});
