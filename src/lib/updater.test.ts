import { describe, expect, it } from "vitest";
import { explainUpdateError } from "./updater";

describe("explainUpdateError", () => {
  it("nhận ra chưa có bản phát hành", () => {
    expect(explainUpdateError("Could not fetch a valid release JSON from the remote")).toMatch(/Chưa có bản phát hành/);
    expect(explainUpdateError("status code 404")).toMatch(/Chưa có bản phát hành/);
  });
  it("nhận ra lỗi mạng", () => {
    expect(explainUpdateError("error sending request for url")).toMatch(/mạng/);
  });
  it("giữ nguyên lỗi lạ để dễ báo lại", () => {
    expect(explainUpdateError("boom")).toContain("boom");
  });
});
