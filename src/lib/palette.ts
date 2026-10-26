import { formatCombo, parseCombo } from "./shortcuts";

/** Bỏ dấu tiếng Việt và hạ chữ thường để "cai dat" khớp "Cài đặt". */
export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();

/** Điểm khớp mờ: chữ cái của `q` phải xuất hiện đúng thứ tự trong `text`. Cao hơn = khớp tốt hơn; null = không khớp. */
export function fuzzyScore(q: string, text: string): number | null {
  const a = fold(q).replace(/\s+/g, ""), t = fold(text);
  if (!a) return 0;
  let score = 0, ti = 0, prev = -2;
  for (const ch of a) {
    const at = t.indexOf(ch, ti);
    if (at < 0) return null;
    score += 1;
    if (at === prev + 1) score += 3; // liền nhau
    if (at === 0 || t[at - 1] === " ") score += 2; // đầu từ
    prev = at; ti = at + 1;
  }
  return score - t.length * 0.01;
}

export type PaletteItem = { id: string; label: string; group: string; keys: string[] };

/** Lọc và xếp lệnh theo truy vấn; không có truy vấn thì giữ thứ tự gốc. */
export function searchCommands<T extends PaletteItem>(items: T[], q: string): T[] {
  if (!q.trim()) return items;
  return items
    .map((c) => ({ c, s: fuzzyScore(q, `${c.label} ${c.group}`) }))
    .filter((x): x is { c: T; s: number } => x.s !== null)
    .sort((x, y) => y.s - x.s)
    .map((x) => x.c);
}

export const shortcutText = (keys: string[]) => (keys[0] ? formatCombo(parseCombo(keys[0])) : "");
