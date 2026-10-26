import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PageObj } from "../lib/api";

const text: PageObj = { id: 3, kind: "text", rect: [0.1, 0.1, 0.3, 0.03], text: "Hello", size: 18, font: "Helvetica", bold: false, italic: false, fill: "#000000", stroke: null, strokeWidth: null };
const bg: PageObj = { id: 1, kind: "shape", rect: [0, 0, 1, 0.5], text: null, size: null, font: null, bold: false, italic: false, fill: "#FFFFFF", stroke: null, strokeWidth: null };
const img: PageObj = { id: 5, kind: "image", rect: [0.5, 0.5, 0.2, 0.2], text: null, size: null, font: null, bold: false, italic: false, fill: null, stroke: null, strokeWidth: null };

vi.mock("../lib/api", () => ({ listPageObjects: vi.fn(async () => [text, bg, img]) }));

import { displayRect, groupByPage, hitTest, isNoop, moveRect, patchEdit, resizeRect } from "./model";
import { useEdit } from "./store";

describe("mô hình sửa đổi", () => {
  it("chỉ giữ mục thực sự khác bản gốc", () => {
    let e = patchEdit({}, text, 0, { text: "Xin chào" });
    expect(Object.keys(e)).toEqual(["0:3"]);
    e = patchEdit(e, text, 0, { text: "Hello" });
    expect(e).toEqual({});
    expect(patchEdit({}, text, 0, { size: 18 })).toEqual({});
    expect(isNoop({ page: 0, id: 3, fill: "#000000" }, text)).toBe(true);
    expect(isNoop({ page: 0, id: 3, deleted: true }, text)).toBe(false);
    expect(isNoop({ page: 0, id: 5, image: "/a.png" }, img)).toBe(false);
  });

  it("gộp nhiều thay đổi vào cùng một mục", () => {
    let e = patchEdit({}, text, 0, { size: 24 });
    e = patchEdit(e, text, 0, { fill: "#FF0000" });
    expect(e["0:3"]).toMatchObject({ size: 24, fill: "#FF0000" });
  });

  it("bấm chọn đối tượng nhỏ nhất, bỏ qua đối tượng đã xoá", () => {
    const objs = [bg, text, img];
    expect(hitTest(objs, {}, 0, {}, 0.2, 0.11)?.id).toBe(3);
    expect(hitTest(objs, {}, 0, {}, 0.6, 0.6)?.id).toBe(5);
    expect(hitTest(objs, {}, 0, {}, 0.9, 0.9)).toBeNull();
    const deleted = patchEdit({}, text, 0, { deleted: true });
    expect(hitTest(objs, deleted, 0, {}, 0.2, 0.11)?.id).toBe(1);
  });

  it("khung hiển thị: đo sau khi vẽ > khung đích > khung gốc", () => {
    const e = { page: 0, id: 3, rect: [0.2, 0.2, 0.3, 0.03] as [number, number, number, number] };
    expect(displayRect(text, undefined, undefined)).toEqual(text.rect);
    expect(displayRect(text, e, undefined)).toEqual(e.rect);
    expect(displayRect(text, e, [0.2, 0.2, 0.5, 0.03])).toEqual([0.2, 0.2, 0.5, 0.03]);
  });

  it("kéo và đổi cỡ không ra ngoài trang", () => {
    expect(moveRect([0.5, 0.5, 0.2, 0.2], 1, 1)).toEqual([0.8, 0.8, 0.2, 0.2]);
    expect(moveRect([0.1, 0.1, 0.2, 0.2], -1, -1)).toEqual([0, 0, 0.2, 0.2]);
    expect(resizeRect([0.5, 0.5, 0.2, 0.2], 2, 2)).toEqual([0.5, 0.5, 0.5, 0.5]);
    expect(resizeRect([0.5, 0.5, 0.2, 0.2], 0.1, 0.1)).toEqual([0.5, 0.5, 0.01, 0.01]);
  });

  it("gom theo trang và giữ nguyên mảng của trang không đổi", () => {
    const a = patchEdit({}, text, 0, { size: 24 });
    const g1 = groupByPage(a, {});
    const b = patchEdit(a, img, 1, { deleted: true });
    const g2 = groupByPage(b, g1);
    expect(g2[0]).toBe(g1[0]);
    expect(g2[1]).toHaveLength(1);
  });
});

const st = () => useEdit.getState();
beforeEach(() => st().reset());

describe("kho sửa đổi và hoàn tác", () => {
  it("mỗi lần sửa là một bước hoàn tác, làm lại được, thao tác mới xoá hàng làm lại", () => {
    st().apply(0, text, { text: "A" });
    st().apply(0, text, { size: 30 });
    st().apply(0, img, { deleted: true });
    expect(Object.keys(st().edits).sort()).toEqual(["0:3", "0:5"]);
    st().undo();
    expect(st().edits["0:5"]).toBeUndefined();
    expect(st().edits["0:3"]).toMatchObject({ text: "A", size: 30 });
    st().undo();
    expect(st().edits["0:3"]).toEqual({ page: 0, id: 3, text: "A" });
    st().redo();
    expect(st().edits["0:3"]).toMatchObject({ size: 30 });
    st().apply(0, img, { rect: [0.1, 0.1, 0.2, 0.2] });
    expect(st().future).toHaveLength(0);
  });

  it("byPage đổi theo sửa đổi để trang tự vẽ lại", () => {
    st().apply(2, text, { text: "B" });
    expect(st().byPage[2]).toHaveLength(1);
    st().undo();
    expect(st().byPage[2]).toBeUndefined();
  });

  it("khôi phục bản gốc của một đối tượng và có thể hoàn tác việc đó", () => {
    st().apply(0, text, { text: "A" });
    st().revert(0, 3);
    expect(st().edits).toEqual({});
    st().undo();
    expect(st().edits["0:3"]).toBeDefined();
  });

  it("đo lại khung sau khi vẽ; sửa tiếp thì bỏ khung đo cũ", () => {
    st().apply(0, text, { text: "dài hơn" });
    st().setRects(0, [{ id: 3, rect: [0.1, 0.1, 0.4, 0.03] }]);
    expect(st().rects["0:3"]).toEqual([0.1, 0.1, 0.4, 0.03]);
    st().apply(0, text, { rect: [0.2, 0.2, 0.4, 0.03] });
    expect(st().rects["0:3"]).toBeUndefined();
  });

  it("nạp đối tượng của trang một lần", async () => {
    await st().loadObjects("/a.pdf", 0);
    expect(st().objects[0]).toHaveLength(3);
  });

  it("lưu xong thì bỏ hết sửa đổi và đòi vẽ lại", () => {
    st().apply(0, text, { text: "A" });
    const rev = st().rev;
    st().saved();
    expect(st().edits).toEqual({});
    expect(st().past).toEqual([]);
    expect(st().rev).toBe(rev + 1);
  });
});
