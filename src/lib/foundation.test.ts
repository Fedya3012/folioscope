import { afterEach, describe, expect, it, vi } from "vitest";
import { Kv, type KvBackend } from "./kv";
import { dispatchKey, findConflicts, formatCombo, matches, parseCombo, registerCommands, type KeyLike } from "./shortcuts";
import { MAX_TOASTS, toast, toastDuration, useToasts } from "./toast";
import { canRedo, canUndo, clearUndo, pushUndo, redo, registerUndoScope, undo } from "./undo";

const key = (k: string, o: Partial<KeyLike> = {}): KeyLike => ({
  key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, preventDefault: vi.fn(), ...o,
});

describe("Kv", () => {
  const fake = (stored: Record<string, string> = {}) => {
    const sets: [string, string][] = [];
    const b: KvBackend = { loadAll: async () => stored, set: (k, v) => { sets.push([k, v]); }, remove: () => {} };
    return { b, sets };
  };

  it("nạp dữ liệu đã lưu và đọc đồng bộ", async () => {
    const kv = new Kv(fake({ a: '{"x":1}' }).b);
    await kv.init();
    expect(kv.getJson("a")).toEqual({ x: 1 });
    expect(kv.getItem("none")).toBeNull();
  });

  it("chuyển dữ liệu bản cũ sang, nhưng không đè dữ liệu đã có", async () => {
    const { b, sets } = fake({ keep: "moi" });
    const kv = new Kv(b);
    await kv.init({ keep: "cu", old: "1" });
    expect(kv.getItem("keep")).toBe("moi");
    expect(kv.getItem("old")).toBe("1");
    expect(sets).toEqual([["old", "1"]]);
  });

  it("ghi xuống nơi lưu và chịu được lỗi ghi / JSON hỏng", async () => {
    const b: KvBackend = { loadAll: async () => { throw new Error("x"); }, set: () => Promise.reject(new Error("đầy ổ")), remove: () => {} };
    const kv = new Kv(b);
    await kv.init();
    kv.setItem("bad", "{oops");
    expect(kv.getJson("bad")).toBeNull();
    kv.setJson("ok", [1]);
    expect(kv.getJson("ok")).toEqual([1]);
    kv.removeItem("ok");
    expect(kv.getItem("ok")).toBeNull();
  });
});

describe("toast", () => {
  afterEach(() => useToasts.getState().clear());

  it("giữ tối đa 3 toast, cái cũ nhất bị đẩy ra", () => {
    for (let i = 0; i < MAX_TOASTS + 2; i++) toast.info(`t${i}`);
    expect(useToasts.getState().items.map((t) => t.text)).toEqual(["t2", "t3", "t4"]);
  });

  it("thời gian tự đóng: 4s, 6s khi có Hoàn tác, lỗi lâu hơn", () => {
    expect(toastDuration("info")).toBe(4000);
    expect(toastDuration("success", { label: "Hoàn tác", run: () => {} })).toBe(6000);
    expect(toastDuration("error")).toBeGreaterThan(6000);
  });

  it("đóng theo id", () => {
    const id = toast.success("xong");
    toast.dismiss(id);
    expect(useToasts.getState().items).toHaveLength(0);
  });
});

describe("phím tắt", () => {
  it("Mod khớp Ctrl hoặc ⌘, và không khớp khi thừa phím", () => {
    const c = parseCombo("Mod+O");
    expect(matches(key("o", { ctrlKey: true }), c)).toBe(true);
    expect(matches(key("O", { metaKey: true }), c)).toBe(true);
    expect(matches(key("o"), c)).toBe(false);
    expect(matches(key("o", { ctrlKey: true, shiftKey: true }), c)).toBe(false);
    expect(matches(key("o", { ctrlKey: true, altKey: true }), c)).toBe(false); // AltGr trên Windows
  });

  it("phím dấu: Ctrl+\\ theo mã phím kể cả khi có Shift, Ctrl++ và Ctrl+= đều phóng to", () => {
    expect(matches(key("|", { code: "Backslash", ctrlKey: true, shiftKey: true }), parseCombo("Mod+Shift+\\"))).toBe(true);
    expect(matches(key("\\", { ctrlKey: true }), parseCombo("Mod+\\"))).toBe(true);
    expect(matches(key("+", { ctrlKey: true, shiftKey: true }), parseCombo("Mod++"))).toBe(true);
    expect(matches(key("=", { ctrlKey: true }), parseCombo("Mod+="))).toBe(true);
  });

  it("điều phối: when, typing, trả false để chuyển cho lệnh sau", () => {
    const log: string[] = [];
    let ready = false;
    const off = registerCommands([
      { id: "t.first", label: "", group: "t", keys: ["F9"], when: () => ready, run: () => { log.push("first"); } },
      { id: "t.pass", label: "", group: "t", keys: ["F8"], run: () => { log.push("pass"); return false; } },
      { id: "t.second", label: "", group: "t", keys: ["F8"], run: () => { log.push("second"); } },
      { id: "t.typing", label: "", group: "t", keys: ["Mod+9"], typing: "allow", run: () => { log.push("typing"); } },
      { id: "t.block", label: "", group: "t", keys: ["F7"], run: () => { log.push("block"); } },
    ]);
    const typingTarget = { closest: () => ({}) };

    expect(dispatchKey(key("F9"))).toBe(false);
    ready = true;
    expect(dispatchKey(key("F9"))).toBe(true);

    const e = key("F8");
    expect(dispatchKey(e)).toBe(true);
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    expect(log).toEqual(["first", "pass", "second"]);

    log.length = 0;
    expect(dispatchKey(key("F7", { target: typingTarget }))).toBe(false);
    expect(dispatchKey(key("9", { ctrlKey: true, target: typingTarget }))).toBe(true);
    expect(log).toEqual(["typing"]);

    off();
    expect(dispatchKey(key("F8"))).toBe(false);
  });

  it("báo phím trùng và hiển thị theo hệ điều hành", () => {
    const off = registerCommands([
      { id: "c.a", label: "", group: "c", keys: ["Mod+Shift+K"], run: () => {} },
      { id: "c.b", label: "", group: "c", keys: ["Mod+Shift+K"], run: () => {} },
    ]);
    expect(findConflicts().find((c) => c.ids.includes("c.a"))?.ids).toEqual(["c.a", "c.b"]);
    off();
    expect(formatCombo(parseCombo("Mod+Shift+\\"), false)).toBe("Ctrl+Shift+\\");
    expect(formatCombo(parseCombo("Mod+Shift+\\"), true)).toBe("⇧⌘\\");
  });
});

describe("hoàn tác toàn cục", () => {
  afterEach(clearUndo);

  it("ngăn xếp chung: hoàn tác, làm lại, và thao tác mới xoá hàng đợi làm lại", () => {
    let n = 0;
    const step = (to: number, from: number) => ({ label: `${from}→${to}`, undo: () => { n = from; }, redo: () => { n = to; } });
    n = 1; pushUndo(step(1, 0));
    n = 2; pushUndo(step(2, 1));
    expect(canUndo()).toBe(true);
    expect(undo()).toBe(true); expect(n).toBe(1);
    expect(canRedo()).toBe(true);
    expect(redo()).toBe(true); expect(n).toBe(2);
    undo();
    pushUndo(step(9, 1));
    expect(canRedo()).toBe(false);
    clearUndo();
    expect(undo()).toBe(false);
  });

  it("phạm vi đang hoạt động nhận hoàn tác và che ngăn xếp chung", () => {
    const calls: string[] = [];
    let active = true, steps = 1;
    const off = registerUndoScope({
      id: "demo", active: () => active, canUndo: () => steps > 0, canRedo: () => false,
      undo: () => { steps--; calls.push("scope"); }, redo: () => {},
    });
    pushUndo({ label: "chung", undo: () => calls.push("stack"), redo: () => {} });
    expect(undo()).toBe(true);
    expect(undo()).toBe(false); // phạm vi hết bước, ngăn xếp chung vẫn không bị đụng
    active = false;
    expect(undo()).toBe(true);
    expect(calls).toEqual(["scope", "stack"]);
    off();
  });
});
