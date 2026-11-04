import { useCtxMenu, tidyItems, type MenuItem } from "./ctxMenu";
import type { PageItem } from "./organizer";

/** Số trang (từ 1) thành chuỗi mô tả ngắn: "3", "3, 5" hoặc "3 trang". */
export const pagesLabel = (n: number) => (n === 1 ? "trang" : `${n} trang`);

/** Kích thước trang theo điểm PDF → mm (1 pt = 25,4/72 mm). */
export const ptToMmRound = (pt: number) => Math.round((pt * 25.4) / 72);

/** Tên khổ giấy gần đúng (dung sai 2 mm), hoặc null. */
export function paperName(wPt: number, hPt: number): string | null {
  const [a, b] = [ptToMmRound(wPt), ptToMmRound(hPt)].sort((x, y) => x - y);
  const sizes: [string, number, number][] = [["A3", 297, 420], ["A4", 210, 297], ["A5", 148, 210], ["Letter", 216, 279], ["Legal", 216, 356]];
  return sizes.find(([, w, h]) => Math.abs(a - w) <= 2 && Math.abs(b - h) <= 2)?.[0] ?? null;
}

export type PageMenuActions = {
  count: number;
  busy: boolean;
  insert(kind: "blank" | "file" | "image" | "clipboard"): void;
  extract(): void;
  replace(): void;
  remove(): void;
  crop(): void;
  rotate(delta: number): void;
  number(): void;
  copy(): void;
  smaller(): void;
  larger(): void;
  properties(): void;
  transitions(): void;
  print(): void;
  embedThumbs(embed: boolean): void;
};


/** Menu chuột phải của hình thu nhỏ trang, theo bố cục của Acrobat. */
export function openPageMenu(x: number, y: number, a: PageMenuActions) {
  const off = a.busy;
  const L = pagesLabel(a.count);
  const items: MenuItem[] = tidyItems([
    { label: "Chèn: trang trắng", disabled: off, run: () => a.insert("blank") },
    { label: "Chèn: từ file khác…", disabled: off, run: () => a.insert("file") },
    { label: "Chèn: từ ảnh…", disabled: off, run: () => a.insert("image") },
    { label: "Chèn: từ clipboard", disabled: off, run: () => a.insert("clipboard") },
    { label: `Trích xuất ${L}…`, disabled: off, run: a.extract },
    { label: `Thay thế ${L}…`, disabled: off, run: a.replace },
    { label: `Xoá ${L}`, hint: "Ctrl+Shift+D", disabled: off, run: a.remove },
    { sep: true },
    { label: `Cắt lề ${L}…`, disabled: off, run: a.crop },
    { label: "Xoay phải", hint: "Ctrl+Shift+=", disabled: off, run: () => a.rotate(90) },
    { label: "Xoay trái", hint: "Ctrl+Shift+-", disabled: off, run: () => a.rotate(-90) },
    { label: "Chuyển trang (Page Transitions)…", disabled: off, run: a.transitions },
    { sep: true },
    { label: `Sao chép ${L} (ảnh)`, hint: "Ctrl+C", run: a.copy },
    { sep: true },
    { label: "Đánh số trang…", disabled: off, run: a.number },
    { sep: true },
    { label: "In tài liệu…", hint: "Ctrl+P", run: a.print },
    { sep: true },
    { label: "Nhúng hình thu nhỏ vào file…", disabled: off, run: () => a.embedThumbs(true) },
    { label: "Gỡ hình thu nhỏ đã nhúng…", disabled: off, run: () => a.embedThumbs(false) },
    { sep: true },
    { label: "Thu nhỏ hình thu nhỏ", run: a.smaller },
    { label: "Phóng to hình thu nhỏ", run: a.larger },
    { sep: true },
    { label: "Thuộc tính trang…", run: a.properties },
  ]);
  useCtxMenu.getState().open(x, y, items);
}

/** Mô tả thuộc tính của một trang để hiện trong hộp thoại. */
export function pageProperties(p: PageItem, position: number, total: number): [string, string][] {
  const wmm = ptToMmRound(p.w), hmm = ptToMmRound(p.h);
  const paper = paperName(p.w, p.h);
  return [
    ["Vị trí", `${position} / ${total}`],
    ["Khổ trang", `${wmm} × ${hmm} mm (${Math.round(p.w)} × ${Math.round(p.h)} pt)${paper ? ` · ${paper}` : ""}`],
    ["Hướng", p.w > p.h ? "Ngang" : "Dọc"],
    ["Xoay thêm", `${p.rot}°`],
    ["Nguồn", p.source === null ? "Trang trắng" : `${p.source.split(/[\\/]/).pop()} · trang ${p.index + 1}`],
    ["Cắt lề", p.crop ? `trái ${p.crop.l}, trên ${p.crop.t}, phải ${p.crop.r}, dưới ${p.crop.b} pt` : "Không"],
    ["Số trang in lên", p.stamp ? p.stamp.text : "Không"],
  ];
}
