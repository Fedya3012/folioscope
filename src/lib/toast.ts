import { create } from "zustand";

export type ToastKind = "success" | "info" | "warning" | "error";
export type ToastAction = { label: string; run: () => void };
export type ToastItem = { id: number; kind: ToastKind; text: string; action?: ToastAction; ms: number };

/** Theo thiết kế: tối đa 3 toast xếp chồng; tự đóng sau 4 giây, 6 giây nếu có nút Hoàn tác; lỗi ở lại lâu hơn. */
export const MAX_TOASTS = 3;
export const toastDuration = (kind: ToastKind, action?: ToastAction) => (kind === "error" ? 9000 : action ? 6000 : 4000);

type State = {
  items: ToastItem[];
  push(t: { kind?: ToastKind; text: string; action?: ToastAction }): number;
  dismiss(id: number): void;
  clear(): void;
};

let seq = 0;

export const useToasts = create<State>((set) => ({
  items: [],
  push({ kind = "info", text, action }) {
    const id = ++seq;
    set((s) => ({ items: [...s.items, { id, kind, text, action, ms: toastDuration(kind, action) }].slice(-MAX_TOASTS) }));
    return id;
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
  clear: () => set({ items: [] }),
}));

/** Gọi từ bất kỳ đâu (không cần hook): `toast.success("Đã lưu")`. */
export const toast = {
  show: (text: string, o: { kind?: ToastKind; action?: ToastAction } = {}) => useToasts.getState().push({ text, ...o }),
  success: (text: string, action?: ToastAction) => useToasts.getState().push({ kind: "success", text, action }),
  info: (text: string, action?: ToastAction) => useToasts.getState().push({ kind: "info", text, action }),
  warning: (text: string, action?: ToastAction) => useToasts.getState().push({ kind: "warning", text, action }),
  error: (text: string) => useToasts.getState().push({ kind: "error", text }),
  dismiss: (id: number) => useToasts.getState().dismiss(id),
};
