import { create } from "zustand";
import {
  exportPages, openDocument, pickFolder, pickPdf, pickSavePath, type DocumentInfo, type PageRef,
} from "./lib/api";
import {
  chunkEvery, insertItems, moveItems, parseRanges, partName, pushHistory, rangeIds, redoHistory,
  removeItems, reverseItems, rotateItems, splitFileName, undoHistory,
  type History, type PageItem,
} from "./lib/organizer";
import { toast } from "./lib/toast";


let nextId = 1;
const newId = () => `pg${nextId++}`;

const itemsOf = (path: string, info: DocumentInfo): PageItem[] =>
  info.page_sizes.map(([w, h], index) => ({ id: newId(), source: path, index, rot: 0, w, h }));

const toRefs = (items: PageItem[]): PageRef[] =>
  items.map((p) => ({ source: p.source, index: p.index, rotate: p.rot, width: p.w, height: p.h }));

interface OrganizerState {
  /** Tài liệu gốc mà danh sách đang được dựng từ đó. */
  baseInfo: DocumentInfo | null;
  basePath: string | null;
  items: PageItem[];
  selected: ReadonlySet<string>;
  anchor: string | null;
  history: History<PageItem>;
  thumb: number;
  busy: boolean;

  /** Dựng lại danh sách khi tài liệu đang mở đổi; giữ nguyên nếu vẫn là tài liệu đó. */
  sync(path: string | null, info: DocumentInfo | null): void;
  reset(): void;
  setThumb(px: number): void;

  click(id: string, mod: { toggle: boolean; range: boolean }): void;
  setSelection(ids: Iterable<string>): void;
  selectAll(): void;
  clearSelection(): void;

  rotate(delta: number): void;
  remove(): void;
  moveSelected(at: number, ids?: ReadonlySet<string>): void;
  reverse(): void;
  undo(): void;
  redo(): void;
  insertBlank(): void;
  insertFromFile(): Promise<void>;

  save(): Promise<string | null>;
  extract(): Promise<void>;
  split(mode: "every" | "ranges", value: string): Promise<boolean>;
}

export const useOrganizer = create<OrganizerState>((set, get) => {
  /** Ghi một thay đổi vào lịch sử rồi áp dụng. */
  const commit = (items: PageItem[], patch: Partial<OrganizerState> = {}) =>
    set((s) => ({ items, history: pushHistory(s.history, s.items), ...patch }));
  const fail = (e: unknown) => { set({ busy: false }); toast.error(String(e)); };
  const undoAction = { label: "Hoàn tác", run: () => get().undo() };
  const insertionPoint = () => {
    const { items, selected } = get();
    let last = -1;
    items.forEach((p, i) => { if (selected.has(p.id)) last = i; });
    return last < 0 ? items.length : last + 1;
  };

  return {
    baseInfo: null, basePath: null, items: [], selected: new Set(), anchor: null,
    history: { past: [], future: [] }, thumb: 180, busy: false,

    sync(path, info) {
      if (info === get().baseInfo) return;
      if (!path || !info) { get().reset(); return; }
      set({
        baseInfo: info, basePath: path, items: itemsOf(path, info), selected: new Set(), anchor: null,
        history: { past: [], future: [] },
      });
    },
    reset: () => set({
      baseInfo: null, basePath: null, items: [], selected: new Set(), anchor: null,
      history: { past: [], future: [] },
    }),
    setThumb: (thumb) => set({ thumb }),

    click(id, { toggle, range }) {
      const { items, selected, anchor } = get();
      if (range && anchor) {
        const ids = rangeIds(items, anchor, id);
        set({ selected: new Set(toggle ? [...selected, ...ids] : ids) });
      } else if (toggle) {
        const next = new Set(selected);
        if (!next.delete(id)) next.add(id);
        set({ selected: next, anchor: id });
      } else {
        set({ selected: new Set([id]), anchor: id });
      }
    },
    setSelection: (ids) => set({ selected: new Set(ids) }),
    selectAll: () => set((s) => ({ selected: new Set(s.items.map((p) => p.id)) })),
    clearSelection: () => set({ selected: new Set(), anchor: null }),

    rotate(delta) {
      const { items, selected } = get();
      if (selected.size === 0) return;
      commit(rotateItems(items, selected, delta));
    },
    remove() {
      const { items, selected } = get();
      if (selected.size === 0) return;
      if (selected.size >= items.length) {
        toast.error("Tài liệu phải còn ít nhất một trang.");
        return;
      }
      const n = selected.size;
      commit(removeItems(items, selected), {
        selected: new Set(), anchor: null,
      });
      toast.success(`Đã xoá ${n} trang`, undoAction);
    },
    moveSelected(at, ids) {
      const { items, selected } = get();
      const moving = ids ?? selected;
      const next = moveItems(items, moving, at);
      if (next.every((p, i) => p === items[i])) return;
      commit(next);
    },
    reverse() {
      const { items, selected } = get();
      if (items.length < 2) return;
      commit(reverseItems(items, selected));
    },
    undo() {
      const { history, items } = get();
      const r = undoHistory(history, items);
      if (r) set({ items: r.items, history: r.history, selected: new Set() });
    },
    redo() {
      const { history, items } = get();
      const r = redoHistory(history, items);
      if (r) set({ items: r.items, history: r.history, selected: new Set() });
    },

    insertBlank() {
      const { items } = get();
      if (items.length === 0) return;
      const at = insertionPoint();
      const ref = items[Math.max(0, Math.min(at, items.length) - 1)];
      const blank: PageItem = { id: newId(), source: null, index: 0, rot: 0, w: ref.w, h: ref.h };
      commit(insertItems(items, at, [blank]), { selected: new Set([blank.id]), anchor: blank.id });
    },
    async insertFromFile() {
      try {
        const path = await pickPdf();
        if (!path) return;
        set({ busy: true });
        const info = await openDocument(path);
        const added = itemsOf(path, info);
        commit(insertItems(get().items, insertionPoint(), added), {
          busy: false, selected: new Set(added.map((p) => p.id)), anchor: added[0]?.id ?? null,
        });
        toast.success(`Đã chèn ${added.length} trang`, undoAction);
      } catch (e) { fail(e); }
    },

    /** Ghi toàn bộ danh sách thành file mới; trả về đường dẫn đã ghi. */
    async save() {
      const { items, basePath } = get();
      if (!basePath || items.length === 0) return null;
      const { dir, sep, base } = splitFileName(basePath);
      try {
        const out = await pickSavePath(`${dir}${sep}${base}_da-sap-xep.pdf`);
        if (!out) return null;
        set({ busy: true });
        await exportPages(toRefs(items), out);
        set({ busy: false });
        return out;
      } catch (e) { fail(e); return null; }
    },
    async extract() {
      const { items, selected, basePath } = get();
      const picked = items.filter((p) => selected.has(p.id));
      if (picked.length === 0 || !basePath) return;
      const { dir, sep, base } = splitFileName(basePath);
      try {
        const out = await pickSavePath(`${dir}${sep}${base}_trich-xuat.pdf`);
        if (!out) return;
        set({ busy: true });
        await exportPages(toRefs(picked), out);
        set({ busy: false });
        toast.success(`Đã trích ${picked.length} trang ra ${out}`);
      } catch (e) { fail(e); }
    },
    async split(mode, value) {
      const { items, basePath } = get();
      if (!basePath || items.length === 0) return false;
      let groups: number[][];
      try {
        groups = mode === "every" ? chunkEvery(Number(value), items.length) : parseRanges(value, items.length);
      } catch (e) {
        toast.error((e as Error).message);
        return false;
      }
      try {
        const folder = await pickFolder();
        if (!folder) return false;
        set({ busy: true });
        const { sep, base } = splitFileName(basePath);
        const dir = folder.replace(/[\\/]+$/, "");
        for (const [n, group] of groups.entries()) {
          await exportPages(toRefs(group.map((i) => items[i])), `${dir}${sep}${partName(base, n + 1, groups.length)}`);
        }
        set({ busy: false });
        toast.success(`Đã tách thành ${groups.length} file trong ${dir}`);
        return true;
      } catch (e) { fail(e); return false; }
    },
  };
});
