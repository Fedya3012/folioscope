import { create } from "zustand";
import { listPageObjects, type NormRect, type ObjEdit, type PageObj } from "../lib/api";
import { countEdits, editKey, groupByPage, patchEdit, removeEdit, type ByPage, type EditMap } from "./model";

const LIMIT = 100;

interface EditState {
  /** Đối tượng từng trang (đọc lười khi trang hiện ra ở chế độ Chỉnh sửa). */
  objects: Record<number, PageObj[]>;
  edits: EditMap;
  byPage: ByPage;
  /** Khung đo lại sau khi vẽ (chữ đổi nội dung thì bề rộng thay đổi). */
  rects: Record<string, NormRect>;
  selected: string | null;
  /** Đối tượng chữ đang gõ trực tiếp trên trang. */
  typing: string | null;
  past: EditMap[];
  future: EditMap[];
  /** Tăng khi phải vẽ lại mọi trang (sau khi lưu đè). */
  rev: number;
  loadObjects(path: string, page: number): Promise<void>;
  select(key: string | null): void;
  type(key: string | null): void;
  /** Sửa một đối tượng và ghi một bước hoàn tác. */
  apply(page: number, o: PageObj, patch: Partial<ObjEdit>): void;
  revert(page: number, id: number): void;
  setRects(page: number, list: { id: number; rect: NormRect }[]): void;
  undo(): void;
  redo(): void;
  /** Sau khi đã lưu: bỏ hết sửa đổi và đọc lại đối tượng từ file mới. */
  saved(): void;
  reset(): void;
}

const empty = { objects: {}, edits: {}, byPage: {}, rects: {}, selected: null, typing: null, past: [], future: [] };

const clearRect = (rects: Record<string, NormRect>, key: string) => {
  if (!(key in rects)) return rects;
  const out = { ...rects };
  delete out[key];
  return out;
};

export const useEdit = create<EditState>((set, get) => {
  const setEdits = (edits: EditMap, extra: Partial<EditState> = {}) => set((s) => ({ edits, byPage: groupByPage(edits, s.byPage), ...extra }));
  const inflight = new Set<string>();

  return {
    ...empty, rev: 0,

    async loadObjects(path, page) {
      const tag = `${path}#${page}`;
      if (get().objects[page] || inflight.has(tag)) return;
      inflight.add(tag);
      try {
        const list = await listPageObjects(path, page);
        set((s) => ({ objects: { ...s.objects, [page]: list } }));
      } catch {
        set((s) => ({ objects: { ...s.objects, [page]: [] } })); // trang không sửa được thì coi như không có đối tượng
      } finally { inflight.delete(tag); }
    },
    select: (selected) => set({ selected, typing: null }),
    type: (typing) => set(typing ? { typing, selected: typing } : { typing: null }),

    apply(page, o, patch) {
      const s = get();
      const next = patchEdit(s.edits, o, page, patch);
      if (next === s.edits) return;
      setEdits(next, { past: [...s.past, s.edits].slice(-LIMIT), future: [], rects: clearRect(s.rects, editKey(page, o.id)) });
    },
    revert(page, id) {
      const s = get();
      setEdits(removeEdit(s.edits, page, id), { past: [...s.past, s.edits].slice(-LIMIT), future: [], rects: clearRect(s.rects, editKey(page, id)) });
    },
    setRects(page, list) {
      set((s) => {
        const rects = { ...s.rects };
        let changed = false;
        for (const { id, rect } of list) {
          const key = editKey(page, id), old = rects[key];
          if (!old || old.some((v, i) => Math.abs(v - rect[i]) > 1e-5)) { rects[key] = rect; changed = true; }
        }
        return changed ? { rects } : {};
      });
    },
    undo() {
      const { past, edits, future } = get();
      if (!past.length) return;
      setEdits(past[past.length - 1], { past: past.slice(0, -1), future: [edits, ...future], selected: null, typing: null, rects: {} });
    },
    redo() {
      const { past, edits, future } = get();
      if (!future.length) return;
      setEdits(future[0], { past: [...past, edits], future: future.slice(1), selected: null, typing: null, rects: {} });
    },
    saved: () => set((s) => ({ ...empty, rev: s.rev + 1 })),
    reset: () => set((s) => ({ ...empty, rev: s.rev })),
  };
});

export const editCount = () => countEdits(useEdit.getState().edits);
