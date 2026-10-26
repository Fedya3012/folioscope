/** Hệ phím tắt dùng chung: mọi lệnh đăng ký vào một sổ cái, một bộ nghe phím duy nhất điều phối. Command Palette và bảng phím tắt sau này đọc từ `listCommands()`. */

export type Combo = { mod: boolean; shift: boolean; alt: boolean; key: string };

export type Command = {
  id: string;
  label: string;
  group: string;
  /** Ví dụ "Mod+O", "Mod+Shift+\\", "F4", "PageDown". `Mod` = Ctrl (Windows/Linux) hoặc ⌘ (macOS). */
  keys: string[];
  /** Trả `false` để báo "không xử lý", phím sẽ chuyển cho lệnh khớp tiếp theo. */
  run: (e: KeyLike) => void | false;
  when?: () => boolean;
  /** Mặc định lệnh bị chặn khi đang gõ vào ô nhập hoặc hộp thoại; "allow" cho phép (thường là tổ hợp Ctrl/⌘). */
  typing?: "allow";
};

/** Phần của KeyboardEvent mà bộ điều phối cần (để test không cần trình duyệt). */
export type KeyLike = {
  key: string; code?: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean;
  target?: unknown; preventDefault(): void;
};

const CODE_OF: Record<string, string> = { "\\": "Backslash", ",": "Comma", "=": "Equal", "-": "Minus", "/": "Slash", ".": "Period" };

export function parseCombo(spec: string): Combo {
  const parts = spec.split(/\+(?=.)/); // "Mod++" -> ["Mod", "+"]
  const key = parts.pop()!;
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  return { mod: mods.has("mod"), shift: mods.has("shift"), alt: mods.has("alt"), key: key.length === 1 ? key.toLowerCase() : key };
}

export function matches(e: KeyLike, c: Combo): boolean {
  if ((e.ctrlKey || e.metaKey) !== c.mod || e.altKey !== c.alt) return false;
  // Dấu = và + cùng một phím vật lý (+ cần Shift), nên Shift không phân biệt với chúng.
  if (c.key !== "+" && c.key !== "=" && e.shiftKey !== c.shift) return false;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  return k === c.key || (CODE_OF[c.key] !== undefined && e.code === CODE_OF[c.key]);
}

const registry = new Map<string, Command & { combos: Combo[] }>();

/** Đăng ký lệnh; trả hàm huỷ đăng ký. Đăng ký lại cùng `id` thì thay thế. */
export function registerCommands(cmds: Command[]): () => void {
  for (const c of cmds) registry.set(c.id, { ...c, combos: c.keys.map(parseCombo) });
  return () => { for (const c of cmds) if (registry.get(c.id)?.run === c.run) registry.delete(c.id); };
}

export const listCommands = (): Command[] => [...registry.values()];

/** Các cặp lệnh dùng trùng một phím (trừ khi `when` loại trừ nhau thì không thể biết ở đây, chỉ để cảnh báo trong Cài đặt). */
export function findConflicts(): { keys: string; ids: string[] }[] {
  const by = new Map<string, string[]>();
  for (const c of registry.values()) for (const k of c.keys) {
    const norm = JSON.stringify(parseCombo(k));
    by.set(norm, [...(by.get(norm) ?? []), c.id]);
  }
  return [...by.entries()].filter(([, ids]) => ids.length > 1).map(([k, ids]) => ({ keys: formatCombo(JSON.parse(k)), ids }));
}

const isTypingTarget = (t: unknown) =>
  !!t && typeof (t as Element).closest === "function" && !!(t as Element).closest("input, textarea, select, [contenteditable=true], [role=dialog]");

/** Xử lý một lần nhấn phím. Trả `true` nếu có lệnh đã chạy. */
export function dispatchKey(e: KeyLike): boolean {
  const typing = isTypingTarget(e.target);
  for (const c of registry.values()) {
    if (typing && c.typing !== "allow") continue;
    if (!c.combos.some((k) => matches(e, k))) continue;
    if (c.when && !c.when()) continue;
    if (c.run(e) === false) continue;
    e.preventDefault();
    return true;
  }
  return false;
}

/** Gắn bộ nghe phím duy nhất vào cửa sổ. */
export function installShortcuts(): () => void {
  const on = (e: KeyboardEvent) => { dispatchKey(e); };
  window.addEventListener("keydown", on);
  return () => window.removeEventListener("keydown", on);
}

/** "Ctrl+Shift+\\" hoặc "⌘⇧\\" để hiện cạnh tên lệnh. */
export function formatCombo(c: Combo, mac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform)): string {
  const key = c.key.length === 1 ? c.key.toUpperCase() : c.key;
  if (mac) return `${c.alt ? "⌥" : ""}${c.shift ? "⇧" : ""}${c.mod ? "⌘" : ""}${key}`;
  return [c.mod && "Ctrl", c.alt && "Alt", c.shift && "Shift", key].filter(Boolean).join("+");
}
