import { create } from "zustand";
import { LEFT, RIGHT, ZOOM_MAX, ZOOM_MIN, clamp, resolvePanelWidth, stepZoom } from "./lib/layout";
import { openDocument, type DocumentInfo } from "./lib/api";

export type Theme = "light" | "dark";
export type Mode = "view" | "annotate" | "edit" | "pages" | "tools";
type PanelKey = "left" | "right";

const savedTheme = (): Theme => {
  try {
    const t = localStorage.getItem("folioscope.theme");
    if (t === "dark" || t === "light") return t;
  } catch { /* chạy được dù không có localStorage */ }
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

interface State {
  theme: Theme;
  mode: Mode;
  leftOpen: boolean; leftWidth: number;
  rightOpen: boolean; rightWidth: number;
  path: string | null; info: DocumentInfo | null; error: string | null;
  currentPage: number; zoom: number;
  toggleTheme(): void;
  setMode(m: Mode): void;
  togglePanel(p: PanelKey): void;
  dragPanel(p: PanelKey, rawWidth: number): void;
  load(path: string): Promise<void>;
  setPage(i: number): void;
  zoomBy(dir: 1 | -1): void;
}

export const useStore = create<State>((set, get) => ({
  theme: savedTheme(), mode: "view",
  leftOpen: true, leftWidth: LEFT.def, rightOpen: false, rightWidth: RIGHT.def,
  path: null, info: null, error: null, currentPage: 0, zoom: 1,

  toggleTheme() {
    const theme = get().theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("folioscope.theme", theme); } catch { /* bỏ qua */ }
    set({ theme });
  },
  setMode: (mode) => set({ mode }),
  togglePanel: (p) => set(p === "left" ? { leftOpen: !get().leftOpen } : { rightOpen: !get().rightOpen }),
  dragPanel(p, raw) {
    const r = resolvePanelWidth(raw, p === "left" ? LEFT : RIGHT);
    set(p === "left" ? { leftOpen: r.open, leftWidth: r.width } : { rightOpen: r.open, rightWidth: r.width });
  },
  async load(path) {
    try {
      const info = await openDocument(path);
      set({ path, info, error: null, currentPage: 0 });
    } catch (e) {
      set({ error: String(e) });
    }
  },
  setPage: (i) => set({ currentPage: clamp(i, 0, Math.max(0, (get().info?.page_count ?? 1) - 1)) }),
  zoomBy: (dir) => set({ zoom: clamp(stepZoom(get().zoom, dir), ZOOM_MIN, ZOOM_MAX) }),
}));
