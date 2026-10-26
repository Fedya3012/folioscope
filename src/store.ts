import { create } from "zustand";
import { LEFT, RIGHT, ZOOM_MAX, ZOOM_MIN, clamp, resolvePanelWidth, stepZoom } from "./lib/layout";
import { getOutline, openDocument, searchText, type DocumentInfo, type OutlineItem, type SearchHit } from "./lib/api";
import { isPageTheme, passwordFailure, stepIndex, type Fit, type PageTheme, type ViewMode } from "./lib/viewer";

export type Theme = "light" | "dark";
export type Mode = "view" | "annotate" | "edit" | "pages" | "tools";
type PanelKey = "left" | "right";
export type LeftTab = "thumbs" | "outline" | "search";
export type Tool = "select" | "hand";
/** Yêu cầu cuộn tới một vị trí; `nonce` đổi mỗi lần để yêu cầu lặp lại vẫn được xử lý. */
export type NavTarget = { page: number; y: number | null; nonce: number };
export type SearchState = { query: string; matchCase: boolean; hits: SearchHit[]; active: number; busy: boolean; truncated: boolean; error: string | null };

let searchGen = 0;
const noSearch: SearchState = { query: "", matchCase: false, hits: [], active: -1, busy: false, truncated: false, error: null };

const savedTheme = (): Theme => {
  try {
    const t = localStorage.getItem("folioscope.theme");
    if (t === "dark" || t === "light") return t;
  } catch { /* chạy được dù không có localStorage */ }
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

const savedPageTheme = (): PageTheme => {
  try {
    const t = localStorage.getItem("folioscope.pageTheme");
    if (isPageTheme(t)) return t;
  } catch { /* chạy được dù không có localStorage */ }
  return "normal";
};

/** File đang chờ mật khẩu; `wrong` là lần nhập trước bị sai. */
export type PasswordPrompt = { path: string; wrong: boolean };

interface State {
  theme: Theme;
  pageTheme: PageTheme;
  passwordPrompt: PasswordPrompt | null;
  setPageTheme(t: PageTheme): void;
  cancelPassword(): void;
  mode: Mode;
  leftOpen: boolean; leftWidth: number;
  rightOpen: boolean; rightWidth: number;
  path: string | null; info: DocumentInfo | null; error: string | null;
  currentPage: number; zoom: number;
  viewMode: ViewMode; fit: Fit; tool: Tool;
  leftTab: LeftTab; outline: OutlineItem[]; nav: NavTarget; search: SearchState;
  toggleTheme(): void;
  setMode(m: Mode): void;
  togglePanel(p: PanelKey): void;
  dragPanel(p: PanelKey, rawWidth: number): void;
  load(path: string, password?: string): Promise<void>;
  setPage(i: number): void;
  zoomBy(dir: 1 | -1): void;
  setZoom(z: number, fit?: Fit): void;
  setFit(fit: Fit): void;
  setViewMode(m: ViewMode): void;
  setTool(t: Tool): void;
  openLeftTab(t: LeftTab): void;
  goToPage(i: number, y?: number | null): void;
  runSearch(query: string, matchCase: boolean): Promise<void>;
  stepHit(dir: 1 | -1): void;
  goToHit(i: number): void;
}

export const useStore = create<State>((set, get) => ({
  theme: savedTheme(), pageTheme: savedPageTheme(), passwordPrompt: null, mode: "view",
  leftOpen: true, leftWidth: LEFT.def, rightOpen: false, rightWidth: RIGHT.def,
  path: null, info: null, error: null, currentPage: 0, zoom: 1,
  viewMode: "continuous", fit: "width", tool: "select",
  leftTab: "thumbs", outline: [], nav: { page: 0, y: null, nonce: 0 }, search: noSearch,

  toggleTheme() {
    const theme = get().theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("folioscope.theme", theme); } catch { /* bỏ qua */ }
    set({ theme });
  },
  setPageTheme(pageTheme) {
    try { localStorage.setItem("folioscope.pageTheme", pageTheme); } catch { /* bỏ qua */ }
    set({ pageTheme });
  },
  cancelPassword: () => set({ passwordPrompt: null }),
  setMode: (mode) => set({ mode }),
  togglePanel: (p) => set(p === "left" ? { leftOpen: !get().leftOpen } : { rightOpen: !get().rightOpen }),
  dragPanel(p, raw) {
    const r = resolvePanelWidth(raw, p === "left" ? LEFT : RIGHT);
    set(p === "left" ? { leftOpen: r.open, leftWidth: r.width } : { rightOpen: r.open, rightWidth: r.width });
  },
  async load(path, password) {
    try {
      const info = await openDocument(path, password);
      searchGen++;
      set({ path, info, error: null, passwordPrompt: null, currentPage: 0, fit: "width", outline: [], search: noSearch, nav: { page: 0, y: null, nonce: get().nav.nonce + 1 } });
      // Mục lục có thể không có hoặc hỏng; không để nó cản việc mở file.
      getOutline(path).then((outline) => { if (get().path === path) set({ outline }); }).catch(() => {});
    } catch (e) {
      // File có mật khẩu: không báo lỗi, mở hộp nhập mật khẩu.
      const why = passwordFailure(e);
      if (why) set({ passwordPrompt: { path, wrong: why === "wrong" }, error: null });
      else set({ error: String(e), passwordPrompt: null });
    }
  },
  setPage: (i) => set({ currentPage: clamp(i, 0, Math.max(0, (get().info?.page_count ?? 1) - 1)) }),
  zoomBy: (dir) => set({ zoom: clamp(stepZoom(get().zoom, dir), ZOOM_MIN, ZOOM_MAX), fit: null }),
  setZoom: (z, fit = null) => set({ zoom: clamp(z, ZOOM_MIN, ZOOM_MAX), fit }),
  setFit: (fit) => set({ fit }),
  setViewMode: (viewMode) => set({ viewMode, nav: { page: get().currentPage, y: null, nonce: get().nav.nonce + 1 } }),
  setTool: (tool) => set({ tool }),
  openLeftTab(tab) {
    const { leftOpen, leftTab } = get();
    // Bấm lại đúng nút đang mở thì thu panel; bấm nút khác thì chuyển tab.
    if (leftOpen && leftTab === tab) set({ leftOpen: false });
    else set({ leftOpen: true, leftTab: tab });
  },
  goToPage(i, y = null) {
    const page = clamp(i, 0, Math.max(0, (get().info?.page_count ?? 1) - 1));
    set({ currentPage: page, nav: { page, y, nonce: get().nav.nonce + 1 } });
  },
  async runSearch(query, matchCase) {
    const { path } = get();
    const gen = ++searchGen;
    if (!path || !query.trim()) { set({ search: { ...noSearch, query, matchCase } }); return; }
    set({ search: { ...noSearch, query, matchCase, busy: true } });
    try {
      const r = await searchText(path, query, matchCase);
      if (gen !== searchGen) return; // đã có lần tìm mới hơn
      set({ search: { query, matchCase, hits: r.hits, active: -1, busy: false, truncated: r.truncated, error: null } });
      if (r.hits.length) get().goToHit(0);
    } catch (e) {
      if (gen === searchGen) set({ search: { ...noSearch, query, matchCase, error: String(e) } });
    }
  },
  stepHit(dir) {
    const { hits, active } = get().search;
    const next = stepIndex(active, hits.length, dir);
    if (next >= 0) get().goToHit(next);
  },
  goToHit(i) {
    const hit = get().search.hits[i];
    if (!hit) return;
    set({ search: { ...get().search, active: i } });
    // Cuộn sao cho kết quả nằm gần đầu khung nhìn, không dính sát mép.
    get().goToPage(hit.page, Math.min(...hit.rects.map((r) => r[1])));
  },
}));
