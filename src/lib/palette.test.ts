import { afterEach, describe, expect, it, vi } from "vitest";
import { conflictsFor, resetAllKeys, sanitizeKeymap, setKeys } from "./keymap";
import { fuzzyScore, searchCommands } from "./palette";
import { comboFromEvent, dispatchKey, registerCommands, setKeyOverrides, type KeyLike } from "./shortcuts";
import { DEFAULT_SETTINGS, sanitizeSettings } from "./settings";

const key = (k: string, o: Partial<KeyLike> = {}): KeyLike => ({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, preventDefault: vi.fn(), ...o });

describe("tìm lệnh mờ", () => {
  const items = [
    { id: "a", label: "Cài đặt", group: "Ứng dụng", keys: [] },
    { id: "b", label: "Chế độ Trang", group: "Chế độ", keys: [] },
    { id: "c", label: "Phóng to", group: "Xem", keys: [] },
  ];
  it("không cần gõ dấu tiếng Việt", () => expect(searchCommands(items, "cai dat")[0].id).toBe("a"));
  it("khớp chữ cái rời theo thứ tự", () => expect(searchCommands(items, "pt").map((c) => c.id)).toContain("c"));
  it("không khớp thì loại", () => expect(searchCommands(items, "zzz")).toEqual([]));
  it("truy vấn rỗng giữ thứ tự gốc", () => expect(searchCommands(items, "  ")).toEqual(items));
  it("khớp liền nhau điểm cao hơn rời rạc", () => expect(fuzzyScore("tra", "trang")!).toBeGreaterThan(fuzzyScore("tra", "t r a")!));
});

describe("phím tuỳ chỉnh", () => {
  afterEach(() => setKeyOverrides({}));
  it("phím mới thay phím cũ", () => {
    const run = vi.fn();
    const off = registerCommands([{ id: "t.cmd", label: "T", group: "T", keys: ["Mod+K"], typing: "allow", run }]);
    setKeys("t.cmd", ["Mod+J"]);
    expect(dispatchKey(key("k", { ctrlKey: true }))).toBe(false);
    expect(dispatchKey(key("j", { ctrlKey: true }))).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    resetAllKeys();
    expect(dispatchKey(key("k", { ctrlKey: true }))).toBe(true);
    off();
  });
  it("báo trùng với lệnh khác", () => {
    const off = registerCommands([
      { id: "t.a", label: "Lệnh A", group: "T", keys: ["Mod+K"], run: () => {} },
      { id: "t.b", label: "Lệnh B", group: "T", keys: ["Mod+L"], run: () => {} },
    ]);
    expect(conflictsFor("t.b", "Mod+K")).toEqual(["Lệnh A"]);
    off();
  });
  it("ghi phím từ sự kiện", () => {
    expect(comboFromEvent(key("p", { ctrlKey: true, shiftKey: true }))).toBe("Mod+Shift+P");
    expect(comboFromEvent(key("Control", { ctrlKey: true }))).toBeNull();
  });
  it("dữ liệu keymap hỏng thì bỏ qua", () => {
    expect(sanitizeKeymap({ a: ["Mod+K"], b: "x", c: [1] })).toEqual({ a: ["Mod+K"] });
    expect(sanitizeKeymap(null)).toEqual({});
  });
});

describe("cài đặt mới", () => {
  it("giá trị lạ rơi về mặc định", () => {
    const s = sanitizeSettings({ unit: "km", ocrLang: "x", aiEnabled: "yes", ocrDeskew: false });
    expect(s.unit).toBe(DEFAULT_SETTINGS.unit);
    expect(s.ocrLang).toBe(DEFAULT_SETTINGS.ocrLang);
    expect(s.aiEnabled).toBe(false);
    expect(s.ocrDeskew).toBe(false);
  });
});
