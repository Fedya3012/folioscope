import { create } from "zustand";

export type MenuItem =
  | { sep: true }
  | { label: string; run: () => void; disabled?: boolean; danger?: boolean; hint?: string };

type MenuState = { x: number; y: number; items: MenuItem[] } | null;
export const useCtxMenu = create<{ menu: MenuState; open(x: number, y: number, items: MenuItem[]): void; close(): void }>((set) => ({
  menu: null,
  open: (x, y, items) => set({ menu: items.length ? { x, y, items } : null }),
  close: () => set({ menu: null }),
}));

/** Đẩy menu vào trong khung nhìn để không bị cắt ở mép phải/dưới. */
export function clampMenu(x: number, y: number, w: number, h: number, vw: number, vh: number) {
  return { x: Math.max(4, Math.min(x, vw - w - 4)), y: Math.max(4, Math.min(y, vh - h - 4)) };
}

/** Bỏ dấu ngăn thừa (đầu, cuối, liên tiếp) sau khi lọc mục. */
export function tidyItems(items: (MenuItem | false | null | undefined)[]): MenuItem[] {
  const out: MenuItem[] = [];
  for (const it of items) {
    if (!it) continue;
    if ("sep" in it && (!out.length || "sep" in out[out.length - 1])) continue;
    out.push(it);
  }
  while (out.length && "sep" in out[out.length - 1]) out.pop();
  return out;
}
