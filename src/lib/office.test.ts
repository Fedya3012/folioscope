import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  officeStatus: vi.fn(), officeInstallSupported: vi.fn(), officeInstall: vi.fn(), officeInstallCancel: vi.fn(),
}));
vi.mock("./api", () => api);
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import { cancelInstall, dismissOffice, ensureOffice, formatMb, installStageLabel, startInstall, useOffice } from "./office";

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.resetAllMocks();
  dismissOffice();
  api.officeInstallSupported.mockResolvedValue(true);
});

describe("ensureOffice", () => {
  it("đã có LibreOffice thì không hỏi gì", async () => {
    api.officeStatus.mockResolvedValue("C:\\lo\\soffice.exe");
    await expect(ensureOffice()).resolves.toBe(true);
    expect(useOffice.getState().phase).toBeNull();
  });

  it("chưa có thì hỏi; từ chối trả false", async () => {
    api.officeStatus.mockResolvedValue(null);
    const p = ensureOffice();
    await flush();
    expect(useOffice.getState()).toMatchObject({ phase: "ask", supported: true });
    dismissOffice();
    await expect(p).resolves.toBe(false);
    expect(useOffice.getState().phase).toBeNull();
  });

  it("nhiều nơi cùng hỏi chỉ mở một hộp thoại và cùng nhận kết quả", async () => {
    api.officeStatus.mockResolvedValue(null);
    api.officeInstall.mockResolvedValue("C:\\lo\\soffice.exe");
    const a = ensureOffice(), b = ensureOffice();
    await flush();
    void startInstall();
    await expect(Promise.all([a, b])).resolves.toEqual([true, true]);
  });

  it("cài xong thì đóng hộp và trả true", async () => {
    api.officeStatus.mockResolvedValue(null);
    api.officeInstall.mockResolvedValue("C:\\lo\\soffice.exe");
    const p = ensureOffice();
    await flush();
    await startInstall();
    await expect(p).resolves.toBe(true);
    expect(useOffice.getState().phase).toBeNull();
  });

  it("cài lỗi thì hiện lỗi để thử lại, đóng thì trả false", async () => {
    api.officeStatus.mockResolvedValue(null);
    api.officeInstall.mockRejectedValue("lỗi mạng: hết thời gian");
    const p = ensureOffice();
    await flush();
    await startInstall();
    expect(useOffice.getState()).toMatchObject({ phase: "error", error: "lỗi mạng: hết thời gian" });
    dismissOffice();
    await expect(p).resolves.toBe(false);
  });

  it("huỷ giữa chừng: báo huỷ cho Rust, rồi đóng khi lệnh cài trả 'đã huỷ'", async () => {
    api.officeStatus.mockResolvedValue(null);
    api.officeInstall.mockRejectedValue("đã huỷ");
    api.officeInstallCancel.mockResolvedValue(undefined);
    const p = ensureOffice();
    await flush();
    useOffice.setState({ phase: "installing" });
    cancelInstall();
    expect(api.officeInstallCancel).toHaveBeenCalled();
    await startInstall();
    await expect(p).resolves.toBe(false);
  });

  it("hệ điều hành không tự cài được thì hộp thoại chỉ hướng dẫn", async () => {
    api.officeStatus.mockResolvedValue(null);
    api.officeInstallSupported.mockResolvedValue(false);
    const p = ensureOffice();
    await flush();
    expect(useOffice.getState()).toMatchObject({ phase: "ask", supported: false });
    dismissOffice();
    await p;
  });
});

describe("nhãn tiến trình", () => {
  it("tả từng giai đoạn bằng tiếng Việt", () => {
    expect(formatMb(350 * 1024 * 1024)).toBe("350 MB");
    expect(installStageLabel({ stage: "download", percent: 50, downloaded: 175 * 1048576, total: 350 * 1048576 })).toBe("Đang tải 175 MB / 350 MB");
    expect(installStageLabel({ stage: "extract", percent: null, downloaded: 0, total: 0 })).toMatch(/Đang cài đặt/);
    expect(installStageLabel(null)).toMatch(/bắt đầu/);
  });
});
