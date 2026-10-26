import { db } from "./db";
import { getKeyOverrides, listCommands, parseCombo, setKeyOverrides } from "./shortcuts";

const KEY = "folioscope.keymap";

/** Bộ phím "Giống Acrobat": chỉ đổi những lệnh có phím quen thuộc bên Acrobat. */
export const ACROBAT_PRESET: Record<string, string[]> = {
  "view.fitPage": ["Mod+0"], "view.fitWidth": ["Mod+2"], "view.actual": ["Mod+1"],
  "panel.left": ["F4"], "search.focus": ["Mod+F"], "edit.redo": ["Mod+Shift+Z"],
};

/** Đọc dữ liệu lưu (có thể hỏng): chỉ giữ dạng { id: [chuỗi phím] }. */
export function sanitizeKeymap(raw: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(v) && v.every((k) => typeof k === "string" && k.length > 0)) out[id] = v as string[];
  }
  return out;
}

export const loadKeymap = () => setKeyOverrides(sanitizeKeymap(db.getJson(KEY)));

function apply(next: Record<string, string[]>) {
  setKeyOverrides(next);
  db.setJson(KEY, next);
}

export const setKeys = (id: string, keys: string[]) => apply({ ...getKeyOverrides(), [id]: keys });
export const resetKeys = (id: string) => { const { [id]: _drop, ...rest } = getKeyOverrides(); apply(rest); };
export const resetAllKeys = () => apply({});
export const applyPreset = (p: Record<string, string[]>) => apply({ ...p });

const norm = (spec: string) => JSON.stringify(parseCombo(spec));

/** Các lệnh khác đang dùng cùng phím này (để cảnh báo khi người dùng gán phím). */
export function conflictsFor(id: string, spec: string): string[] {
  const n = norm(spec);
  return listCommands().filter((c) => c.id !== id && c.keys.some((k) => norm(k) === n)).map((c) => c.label);
}
