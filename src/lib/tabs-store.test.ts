import { beforeEach, describe, expect, it, vi } from "vitest";

const infoOf = (n: number) => ({ page_count: n, page_sizes: Array.from({ length: n }, () => [600, 800] as [number, number]) });
const PAGES: Record<string, number> = { "/a.pdf": 10, "/b.pdf": 5, "/c.pdf": 3 };

vi.mock("./api", () => ({
  openDocument: vi.fn(async (p: string) => infoOf(PAGES[p])),
  getOutline: vi.fn(async () => []),
  probeFiles: vi.fn(async () => []),
  searchText: vi.fn(async () => ({ hits: [], truncated: false })),
}));

import { useAnnot } from "../annotations/store";
import { useEdit } from "../edit/store";
import { isDirty, useStore } from "../store";

const st = () => useStore.getState();
const note = () => useAnnot.getState().add({ id: "n1", type: "rect", page: 0, rect: { x: 0, y: 0, w: .1, h: .1 }, color: "#f00", strokeWidth: 2 } as never);

beforeEach(async () => {
  for (const p of [...st().tabs]) { useAnnot.getState().reset(); st().closeTab(p); }
  useStore.setState({ closePrompt: null });
});

describe("nhiều tab", () => {
  it("mở nhiều file thành nhiều tab và mở lại file đã mở thì chỉ chuyển tab", async () => {
    await st().load("/a.pdf"); await st().load("/b.pdf"); await st().load("/a.pdf");
    expect(st().tabs).toEqual(["/a.pdf", "/b.pdf"]);
    expect(st().path).toBe("/a.pdf");
  });

  it("chuyển tab giữ trang đang đọc, ghi chú và chế độ của từng tài liệu", async () => {
    await st().load("/a.pdf");
    st().goToPage(4); st().setMode("annotate"); note();
    await st().load("/b.pdf");
    expect(st().currentPage).toBe(0);
    expect(useAnnot.getState().items).toHaveLength(0);
    st().activateTab("/a.pdf");
    expect(st().currentPage).toBe(4);
    expect(st().mode).toBe("annotate");
    expect(useAnnot.getState().items).toHaveLength(1);
    expect(useAnnot.getState().dirty).toBe(true);
  });

  it("đóng tab đang chọn chuyển sang tab bên phải; hết tab thì về Home", async () => {
    await st().load("/a.pdf"); await st().load("/b.pdf"); await st().load("/c.pdf");
    st().activateTab("/b.pdf");
    st().closeTab("/b.pdf");
    expect(st().path).toBe("/c.pdf");
    st().closeTab("/c.pdf");
    expect(st().path).toBe("/a.pdf");
    st().closeTab("/a.pdf");
    expect(st().tabs).toEqual([]);
    expect(st().path).toBeNull();
    expect(st().view).toBe("home");
  });

  it("tab còn thay đổi chưa lưu phải được xác nhận mới đóng", async () => {
    await st().load("/a.pdf"); note();
    st().closeTab("/a.pdf");
    expect(st().closePrompt).toEqual(["/a.pdf"]);
    expect(st().tabs).toEqual(["/a.pdf"]);
    st().cancelClose();
    expect(st().tabs).toEqual(["/a.pdf"]);
    st().closeTab("/a.pdf"); st().confirmClose();
    expect(st().tabs).toEqual([]);
  });

  it("tab nền cũng báo chưa lưu; đóng các tab khác giữ lại đúng tab được chọn", async () => {
    await st().load("/a.pdf"); note();
    await st().load("/b.pdf"); await st().load("/c.pdf");
    expect(st().tabDirty["/a.pdf"]).toBe(true);
    st().closeOtherTabs("/c.pdf");
    expect(st().closePrompt).toEqual(["/a.pdf", "/b.pdf"]);
    st().confirmClose();
    expect(st().tabs).toEqual(["/c.pdf"]);
    expect(st().path).toBe("/c.pdf");
  });

  it("đóng các tab khác từ một tab không phải tab đang chọn thì chuyển sang tab đó", async () => {
    await st().load("/a.pdf"); await st().load("/b.pdf");
    st().closeOtherTabs("/a.pdf");
    expect(st().tabs).toEqual(["/a.pdf"]);
    expect(st().path).toBe("/a.pdf");
  });

  it("đổi thứ tự tab", async () => {
    await st().load("/a.pdf"); await st().load("/b.pdf"); await st().load("/c.pdf");
    st().reorderTab(2, 0);
    expect(st().tabs).toEqual(["/c.pdf", "/a.pdf", "/b.pdf"]);
  });

  it("mở lại file đã đóng thì quay về trang đã đọc", async () => {
    await st().load("/a.pdf"); st().goToPage(6);
    st().closeTab("/a.pdf");
    await st().load("/a.pdf");
    expect(st().currentPage).toBe(6);
  });

  it("sửa nội dung của từng tab được giữ riêng và tính vào 'chưa lưu'", async () => {
    const obj = { id: 3, kind: "text", rect: [0.1, 0.1, 0.3, 0.03], text: "Hello", size: 18, font: null, bold: false, italic: false, fill: null, stroke: null, strokeWidth: null } as never;
    await st().load("/a.pdf");
    useEdit.getState().apply(0, obj, { text: "Xin chào" });
    await st().load("/b.pdf");
    expect(useEdit.getState().edits).toEqual({});
    expect(isDirty("/a.pdf")).toBe(true);
    expect(isDirty("/b.pdf")).toBe(false);
    st().activateTab("/a.pdf");
    expect(useEdit.getState().edits["0:3"]).toMatchObject({ text: "Xin chào" });
    expect(useEdit.getState().byPage[0]).toHaveLength(1);
    useEdit.getState().reset();
  });
});
