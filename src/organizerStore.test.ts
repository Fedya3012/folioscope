import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  COMBINE_EXTENSIONS: ["pdf"],
  exportPages: vi.fn(), fileSize: vi.fn(), getOutline: vi.fn(), openDocument: vi.fn(), pickFolder: vi.fn(), pickSavePath: vi.fn(),
  preparePdf: vi.fn(), saveClipboardImage: vi.fn(),
}));
const office = vi.hoisted(() => ({ ensureOffice: vi.fn() }));
const toasts = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("./lib/api", () => api);
vi.mock("./lib/office", () => office);
vi.mock("./lib/toast", () => toasts);
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("./store", () => ({ useStore: { getState: () => ({ load: vi.fn(), setMode: vi.fn(), path: null }) } }));

import { topBookmarkPages, useOrganizer } from "./organizerStore";

const info = (n: number) => ({ page_count: n, page_sizes: Array.from({ length: n }, () => [595, 842] as [number, number]) });
const ids = () => useOrganizer.getState().items.map((p) => `${p.source?.split("/").pop() ?? "trắng"}#${p.index}`);

beforeEach(() => {
  vi.clearAllMocks();
  api.fileSize.mockResolvedValue(1_000_000);
  api.pickSavePath.mockResolvedValue("/out/ra.pdf");
  api.exportPages.mockResolvedValue(1);
  useOrganizer.getState().reset();
  api.openDocument.mockResolvedValue(info(4));
  useOrganizer.getState().sync("/docs/a.pdf", info(4));
  vi.clearAllMocks();
  api.fileSize.mockResolvedValue(1_000_000);
  api.exportPages.mockResolvedValue(1);
});

describe("chèn file", () => {
  it("chèn đúng vị trí khe, chọn các trang mới và cho hoàn tác", async () => {
    api.preparePdf.mockImplementation(async (p: string) => p);
    api.openDocument.mockResolvedValue(info(2));
    await useOrganizer.getState().insertFiles(["/docs/b.pdf"], 1);
    expect(ids()).toEqual(["a.pdf#0", "b.pdf#0", "b.pdf#1", "a.pdf#1", "a.pdf#2", "a.pdf#3"]);
    expect(useOrganizer.getState().selected.size).toBe(2);
    useOrganizer.getState().undo();
    expect(ids()).toHaveLength(4);
  });

  it("Word chưa có bộ chuyển đổi: mời cài, từ chối thì không chèn", async () => {
    api.preparePdf.mockRejectedValue("OFFICE_MISSING");
    office.ensureOffice.mockResolvedValue(false);
    await useOrganizer.getState().insertFiles(["/docs/hd.docx"]);
    expect(office.ensureOffice).toHaveBeenCalled();
    expect(ids()).toHaveLength(4);
    expect(toasts.toast.error).toHaveBeenCalledWith(expect.stringContaining("hd.docx"));
  });

  it("cài xong thì thử lại và chèn được", async () => {
    api.preparePdf.mockRejectedValueOnce("OFFICE_MISSING").mockResolvedValueOnce("/tmp/hd.pdf");
    office.ensureOffice.mockResolvedValue(true);
    api.openDocument.mockResolvedValue(info(3));
    await useOrganizer.getState().insertFiles(["/docs/hd.docx"], 4);
    expect(ids().slice(4)).toEqual(["hd.pdf#0", "hd.pdf#1", "hd.pdf#2"]);
  });

  it("file có mật khẩu bị bỏ qua kèm lời nhắc, file khác vẫn chèn", async () => {
    api.preparePdf.mockImplementation(async (p: string) => p);
    api.openDocument.mockImplementation(async (p: string) => { if (p.includes("khoa")) throw "PASSWORD_REQUIRED"; return info(1); });
    await useOrganizer.getState().insertFiles(["/docs/khoa.pdf", "/docs/ok.pdf"], 0);
    expect(ids()[0]).toBe("ok.pdf#0");
    expect(toasts.toast.error).toHaveBeenCalledWith(expect.stringContaining("mật khẩu"));
  });
});

describe("thay thế, cắt lề, đánh số", () => {
  it("thay các trang đã chọn bằng khoảng trang của file khác", async () => {
    api.preparePdf.mockImplementation(async (p: string) => p);
    api.openDocument.mockResolvedValue(info(5));
    useOrganizer.getState().setSelection([useOrganizer.getState().items[1].id, useOrganizer.getState().items[2].id]);
    expect(await useOrganizer.getState().replaceFromFile("/docs/m.pdf", "2-4")).toBe(true);
    expect(ids()).toEqual(["a.pdf#0", "m.pdf#1", "m.pdf#2", "m.pdf#3", "a.pdf#3"]);
  });

  it("cắt lề: lề quá lớn bị từ chối, hợp lệ thì áp cho trang đã chọn", () => {
    const o = useOrganizer.getState();
    o.setSelection([o.items[0].id]);
    expect(o.cropSelected({ l: 400, t: 0, r: 400, b: 0 })).toBe(false);
    expect(useOrganizer.getState().items[0].crop).toBeUndefined();
    expect(o.cropSelected({ l: 10, t: 10, r: 10, b: 10 })).toBe(true);
    expect(useOrganizer.getState().items[0].crop).toEqual({ l: 10, t: 10, r: 10, b: 10 });
    expect(useOrganizer.getState().items[1].crop).toBeUndefined();
  });

  it("đánh số rồi lưu: yêu cầu gửi cho Rust mang đúng cắt lề và số trang", async () => {
    const o = useOrganizer.getState();
    o.cropSelected({ l: 5, t: 0, r: 0, b: 0 });
    o.numberPages({ format: "n-tren-tong", start: 1, pos: "bc", size: 11, marginMm: 10 });
    expect(await o.save()).toBe("/out/ra.pdf");
    const refs = api.exportPages.mock.calls[0][0];
    expect(refs).toHaveLength(4);
    expect(refs[0]).toMatchObject({ crop: [5, 0, 0, 0], stamp: { text: "1 / 4", pos: "bc", size: 11 } });
    expect(refs[3].stamp.text).toBe("4 / 4");
  });
});

describe("tách file", () => {
  beforeEach(() => api.pickFolder.mockResolvedValue("/out"));

  it("theo dấu trang cấp cao nhất", async () => {
    api.getOutline.mockResolvedValue([{ title: "A", page: 0, children: [] }, { title: "B", page: 2, children: [{ title: "B1", page: 3, children: [] }] }]);
    expect(await useOrganizer.getState().split("bookmarks", "")).toBe(true);
    expect(api.exportPages).toHaveBeenCalledTimes(2);
    expect(api.exportPages.mock.calls.map((c) => c[0].length)).toEqual([2, 2]);
    expect(api.exportPages.mock.calls[0][1]).toBe("/out/a_phan-01.pdf");
  });

  it("không có dấu trang thì báo lỗi, không ghi file", async () => {
    api.getOutline.mockResolvedValue([]);
    expect(await useOrganizer.getState().split("bookmarks", "")).toBe(false);
    expect(api.exportPages).not.toHaveBeenCalled();
    expect(toasts.toast.error).toHaveBeenCalledWith(expect.stringContaining("dấu trang"));
  });

  it("theo dung lượng: file nguồn 1 MB / 4 trang, tối đa 0,5 MB → hai trang mỗi file", async () => {
    expect(await useOrganizer.getState().split("size", "0.5")).toBe(true);
    expect(api.exportPages.mock.calls.map((c) => c[0].length)).toEqual([2, 2]);
    expect(await useOrganizer.getState().split("size", "0")).toBe(false);
  });

  it("chỉ lấy dấu trang có đích hợp lệ", () => {
    expect([...topBookmarkPages([{ title: "x", page: null, children: [] }, { title: "y", page: 3, children: [] }])]).toEqual([3]);
  });
});
