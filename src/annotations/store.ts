import { create } from "zustand";
import { COLORS, DEFAULT_COLOR, type Annotation, type Tool } from "./types";

interface AnnotState {
  items: Annotation[];
  tool: Tool;
  color: string;
  strokeWidth: number;
  selectedId: string | null;
  editingId: string | null;
  past: Annotation[][];
  future: Annotation[][];
  dirty: boolean;
  setTool(t: Tool): void;
  setStyle(p: { color?: string; strokeWidth?: number }): void;
  select(id: string | null): void;
  edit(id: string | null): void;
  add(a: Annotation): void;
  /** Cập nhật khi đang kéo: không ghi lịch sử. Gọi checkpoint() một lần trước khi kéo. */
  patch(id: string, a: Partial<Annotation>): void;
  checkpoint(): void;
  remove(id: string): void;
  duplicate(id: string): void;
  undo(): void;
  redo(): void;
  reset(): void;
}

const uid = () => Math.random().toString(36).slice(2, 10);
const LIMIT = 100;

export const useAnnot = create<AnnotState>((set, get) => {
  const commit = (items: Annotation[]) =>
    set((s) => ({ items, past: [...s.past, s.items].slice(-LIMIT), future: [], dirty: true }));
  return {
    items: [], tool: "select", color: DEFAULT_COLOR, strokeWidth: 2,
    selectedId: null, editingId: null, past: [], future: [], dirty: false,

    setTool: (tool) => set({ tool, selectedId: null, editingId: null }),
    setStyle(p) {
      const { selectedId, items } = get();
      if (!selectedId) return set(p);
      // Đổi kiểu lúc đang chọn một đối tượng thì áp luôn cho nó.
      commit(items.map((a) => (a.id === selectedId ? { ...a, ...p } : a)));
      set(p);
    },
    select: (selectedId) => set({ selectedId, editingId: null }),
    edit: (editingId) => set({ editingId }),
    add(a) { commit([...get().items, { ...a, id: a.id || uid() }]); set({ selectedId: a.id || null }); },
    patch: (id, a) => set((s) => ({ items: s.items.map((x) => (x.id === id ? { ...x, ...a } : x)), dirty: true })),
    checkpoint: () => set((s) => ({ past: [...s.past, s.items].slice(-LIMIT), future: [] })),
    remove(id) { commit(get().items.filter((a) => a.id !== id)); set({ selectedId: null, editingId: null }); },
    duplicate(id) {
      const a = get().items.find((x) => x.id === id);
      if (!a) return;
      const copy: Annotation = {
        ...a, id: uid(),
        rect: a.rect && { ...a.rect, x: Math.min(a.rect.x + 0.02, 1 - a.rect.w), y: Math.min(a.rect.y + 0.02, 1 - a.rect.h) },
        points: a.points?.map((p) => ({ x: Math.min(p.x + 0.02, 1), y: Math.min(p.y + 0.02, 1) })),
      };
      commit([...get().items, copy]);
      set({ selectedId: copy.id });
    },
    undo() {
      const { past, items, future } = get();
      if (!past.length) return;
      set({ items: past[past.length - 1], past: past.slice(0, -1), future: [items, ...future], selectedId: null, editingId: null, dirty: true });
    },
    redo() {
      const { past, items, future } = get();
      if (!future.length) return;
      set({ items: future[0], past: [...past, items], future: future.slice(1), selectedId: null, editingId: null, dirty: true });
    },
    reset: () => set({ items: [], past: [], future: [], selectedId: null, editingId: null, dirty: false, color: COLORS[0] }),
  };
});

export const newId = uid;
