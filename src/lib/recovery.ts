import type { Annotation } from "../annotations/types";
import { useAnnot } from "../annotations/store";
import { db } from "./db";
import { toast } from "./toast";
import { useStore } from "../store";

const KEY = "folioscope.recovery";
const MAX_AGE = 14 * 24 * 3600 * 1000;
const DEBOUNCE = 2000;

export type Entry = { items: Annotation[]; at: number };
export type Recovery = Record<string, Entry>;

/** Đọc dữ liệu lưu (có thể hỏng) và bỏ các bản quá cũ. */
export function parseRecovery(raw: unknown, now = Date.now()): Recovery {
  const out: Recovery = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [path, v] of Object.entries(raw as Record<string, unknown>)) {
    const e = v as Partial<Entry> | null;
    if (e && Array.isArray(e.items) && e.items.length && typeof e.at === "number" && now - e.at < MAX_AGE) out[path] = { items: e.items, at: e.at };
  }
  return out;
}

export const withEntry = (r: Recovery, path: string, items: Annotation[], at: number): Recovery => ({ ...r, [path]: { items, at } });
export const withoutEntry = (r: Recovery, path: string): Recovery => { const { [path]: _drop, ...rest } = r; return rest; };

const read = () => parseRecovery(db.getJson(KEY));
const write = (r: Recovery) => db.setJson(KEY, r);

/**
 * Tự lưu bản nháp ghi chú chưa lưu của tài liệu đang mở, và khi mở lại tài liệu đó (sau khi app bị tắt đột ngột)
 * thì đề nghị khôi phục. Bản nháp bị xoá khi đã lưu hoặc người dùng bỏ qua. Trả hàm huỷ.
 */
export function startRecovery(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const offAnnot = useAnnot.subscribe((s, p) => {
    const path = useStore.getState().path;
    if (!path) return;
    // Vừa lưu xong: cờ dirty tắt mà danh sách ghi chú không đổi.
    if (p.dirty && !s.dirty && s.items === p.items) { write(withoutEntry(read(), path)); return; }
    if (!s.dirty || s.items === p.items || !s.items.length) return;
    clearTimeout(timer);
    timer = setTimeout(() => write(withEntry(read(), path, useAnnot.getState().items, Date.now())), DEBOUNCE);
  });
  const offStore = useStore.subscribe((s, p) => {
    if (!s.path || s.path === p.path) return;
    const entry = read()[s.path];
    if (!entry || useAnnot.getState().items.length) return;
    const path = s.path;
    toast.warning(`Tìm thấy ${entry.items.length} ghi chú chưa lưu từ lần trước. Khôi phục?`, {
      label: "Khôi phục",
      run: () => {
        if (useStore.getState().path !== path) return;
        useAnnot.setState({ items: entry.items, dirty: true, past: [], future: [] });
        useStore.getState().setMode("annotate");
        write(withoutEntry(read(), path));
      },
    });
  });
  return () => { clearTimeout(timer); offAnnot(); offStore(); };
}
