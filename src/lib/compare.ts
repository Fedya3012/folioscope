/** So sánh hai bản PDF: theo chữ (khác biệt từng từ) và theo hình (khác biệt từng điểm ảnh). */

export type SegKind = "eq" | "del" | "add";
export type Seg = { kind: SegKind; text: string };
export type PageDiff = { segs: Seg[]; added: number; removed: number; changed: boolean };

/** Tích số từ tối đa của hai bên để chạy LCS đầy đủ; vượt thì coi cả đoạn giữa là đã đổi. */
const LCS_LIMIT = 6_000_000;

/** Tách thành từ, giữ nguyên khoảng trắng đi kèm để ghép lại ra đúng văn bản. */
export function tokenize(text: string): string[] {
  return text.match(/\s+|[^\s]+/g) ?? [];
}

const norm = (t: string) => (/^\s+$/.test(t) ? " " : t);

/** Khác biệt theo từ giữa hai đoạn chữ. Khoảng trắng khác nhau không tính là khác biệt. */
export function diffWords(a: string, b: string): Seg[] {
  const A = tokenize(a), B = tokenize(b);
  let lo = 0;
  while (lo < A.length && lo < B.length && norm(A[lo]) === norm(B[lo])) lo++;
  let ha = A.length, hb = B.length;
  while (ha > lo && hb > lo && norm(A[ha - 1]) === norm(B[hb - 1])) { ha--; hb--; }

  const out: Seg[] = [];
  const push = (kind: SegKind, text: string) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ kind, text });
  };
  push("eq", A.slice(0, lo).join(""));

  const m = A.slice(lo, ha), n = B.slice(lo, hb);
  if (m.length * n.length > LCS_LIMIT) {
    push("del", m.join("")); push("add", n.join(""));
  } else if (m.length === 0 || n.length === 0) {
    push("del", m.join("")); push("add", n.join(""));
  } else {
    // dp[i][j] = độ dài dãy con chung dài nhất của m[i..] và n[j..]
    const w = n.length + 1;
    const dp = new Uint32Array((m.length + 1) * w);
    for (let i = m.length - 1; i >= 0; i--)
      for (let j = n.length - 1; j >= 0; j--)
        dp[i * w + j] = norm(m[i]) === norm(n[j]) ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    let i = 0, j = 0;
    while (i < m.length && j < n.length) {
      if (norm(m[i]) === norm(n[j])) { push("eq", n[j]); i++; j++; }
      else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) push("del", m[i++]);
      else push("add", n[j++]);
    }
    while (i < m.length) push("del", m[i++]);
    while (j < n.length) push("add", n[j++]);
  }
  push("eq", A.slice(ha).join(""));
  return out;
}

const countWords = (s: string) => (s.match(/[^\s]+/g) ?? []).length;

export function diffPage(a: string, b: string): PageDiff {
  const segs = diffWords(a, b);
  let added = 0, removed = 0;
  for (const s of segs) {
    if (s.kind === "add") added += countWords(s.text);
    else if (s.kind === "del") removed += countWords(s.text);
  }
  return { segs, added, removed, changed: added + removed > 0 };
}

/** So từng trang theo số thứ tự; bản ngắn hơn thì các trang thừa của bản dài là "mới" hoặc "bị xoá". */
export function diffDocuments(a: string[], b: string[]): PageDiff[] {
  const n = Math.max(a.length, b.length);
  return Array.from({ length: n }, (_, i) => diffPage(a[i] ?? "", b[i] ?? ""));
}

export const changedPages = (d: PageDiff[]) => d.flatMap((p, i) => (p.changed ? [i] : []));

/** Trang có thay đổi kế tiếp (vòng lại từ đầu), hoặc null nếu không có trang nào khác biệt. */
export function nextChanged(changed: number[], from: number, dir: 1 | -1): number | null {
  if (!changed.length) return null;
  if (dir === 1) return changed.find((p) => p > from) ?? changed[0];
  return [...changed].reverse().find((p) => p < from) ?? changed[changed.length - 1];
}

/**
 * So hai ảnh RGBA cùng cỡ. Trả về ảnh phủ (đỏ ở điểm khác) và tỉ lệ điểm khác (0..1).
 * `threshold` là chênh lệch kênh màu lớn nhất (0..255) mới coi là khác, để bỏ qua nhiễu nén ảnh.
 */
export function diffPixels(a: Uint8ClampedArray, b: Uint8ClampedArray, threshold = 48): { overlay: Uint8ClampedArray; ratio: number } {
  const len = Math.min(a.length, b.length);
  const overlay = new Uint8ClampedArray(b.length);
  let diff = 0;
  for (let i = 0; i + 3 < len; i += 4) {
    const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
    if (d > threshold) { overlay[i] = 235; overlay[i + 1] = 30; overlay[i + 2] = 60; overlay[i + 3] = 170; diff++; }
  }
  return { overlay, ratio: len ? diff / (len / 4) : 0 };
}
