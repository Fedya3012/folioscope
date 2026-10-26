import { create } from "zustand";
import { LEFT, RIGHT, ZOOM_MAX, ZOOM_MIN, clamp, resolvePanelWidth, stepZoom } from "./lib/layout";
import { getOutline, openDocument, probeFiles, searchText, type DocumentInfo, type OutlineItem, type SearchHit } from "./lib/api";
import { db } from "./lib/db";
import { useAnnot } from "./annotations/store";
import { useEdit } from "./edit/store";
import { useOrganizer } from "./organizerStore";
import { addTab, parsePositions, savePosition, moveTab, type ReadPos } from "./lib/tabs";
import { addRecent, parseRecent, removeRecent, togglePin, trimRecent, type RecentFile } from "./lib/recent";
import { DEFAULT_SETTINGS, initialZoom, resolveTheme, sanitizeSettings, type Settings } from "./lib/settings";
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

const SETTINGS_KEY = "folioscope.settings", RECENT_KEY = "folioscope.recent";

const readJson = (key: string): unknown => db.getJson(key);
const writeJson = (key: string, value: unknown) => db.setJson(key, value);

const systemDark = () => typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;

const savedSettings = (): Settings => {
  const raw = readJson(SETTINGS_KEY);
  if (raw) return sanitizeSettings(raw);
  // Bản cũ chỉ lưu chủ đề sáng/tối riêng.
  const t = db.getItem("folioscope.theme");
  if (t === "dark" || t === "light") return { ...DEFAULT_SETTINGS, theme: t };
  return DEFAULT_SETTINGS;
};

const savedPageTheme = (): PageTheme => {
  const t = db.getItem("folioscope.pageTheme");
  return isPageTheme(t) ? t : "normal";
};

const POS_KEY = "folioscope.positions";

/** Trạng thái của một tài liệu đang mở nhưng không phải tab hiện tại; chuyển tab là chép qua lại giữa đây và các store. */
type Session = {
  info: DocumentInfo; outline: OutlineItem[]; mode: Mode;
  currentPage: number; zoom: number; fit: Fit; viewMode: ViewMode;
  annot: Pick<ReturnType<typeof useAnnot.getState>, "items" | "past" | "future" | "dirty">;
  org: Partial<ReturnType<typeof useOrganizer.getState>>;
  edit: Pick<ReturnType<typeof useEdit.getState>, "edits" | "byPage" | "past" | "future">;
};
const sessions = new Map<string, Session>();
const ORG_KEYS = ["baseInfo", "basePath", "items", "selected", "anchor", "history"] as const;

/** File đang chờ mật khẩu; `wrong` là lần nhập trước bị sai. */
export type PasswordPrompt = { path: string; wrong: boolean };

interface State {
  theme: Theme;
  pageTheme: PageTheme;
  passwordPrompt: PasswordPrompt | null;
  setPageTheme(t: PageTheme): void;
  cancelPassword(): void;
  /** "home" = màn hình Bắt đầu; "doc" = tài liệu đang mở. */
  view: "home" | "doc";
  settings: Settings; settingsOpen: boolean;
  recent: RecentFile[];
  setView(v: "home" | "doc"): void;
  /** Các tab tài liệu theo thứ tự (Home luôn ghim đầu, không nằm trong đây). `path` là tab đang chọn. */
  tabs: string[];
  /** Tab nền có thay đổi chưa lưu (tab đang chọn xem trực tiếp ở các store ghi chú/trang). */
  tabDirty: Record<string, boolean>;
  /** Các tab đang chờ người dùng xác nhận đóng vì còn thay đổi chưa lưu. */
  closePrompt: string[] | null;
  activateTab(path: string): void;
  closeTab(path: string): void;
  closeOtherTabs(path: string): void;
  confirmClose(): void;
  cancelClose(): void;
  reorderTab(from: number, to: number): void;
  setSettingsOpen(open: boolean): void;
  updateSettings(patch: Partial<Settings>): void;
  resetSettings(): void;
  setSystemDark(dark: boolean): void;
  togglePinRecent(path: string): void;
  forgetRecent(path: string): void;
  clearRecent(): void;
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
  noteRecent(path: string, pages: number): Promise<void>;
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

const readPositions = () => parsePositions(db.getJson(POS_KEY));

/** Ghi vị trí đọc của tài liệu đang chọn (trang, zoom, kiểu xem). */
function rememberPosition() {
  const { path, info, currentPage, zoom, fit, viewMode } = useStore.getState();
  if (!path || !info) return;
  const pos: ReadPos = { page: currentPage, zoom, fit: fit === "width" || fit === "page" ? fit : null, viewMode: viewMode === "single" ? "single" : "continuous", at: Date.now() };
  db.setJson(POS_KEY, savePosition(readPositions(), path, pos));
}

const liveDirty = () => useAnnot.getState().dirty || useOrganizer.getState().history.past.length > 0 || Object.keys(useEdit.getState().edits).length > 0;
/** Tab có thay đổi chưa lưu (tab đang chọn lấy trực tiếp từ store, tab nền lấy lúc rời đi). */
export const isDirty = (path: string): boolean => (path === useStore.getState().path ? liveDirty() : !!useStore.getState().tabDirty[path]);

/** Cất trạng thái của tài liệu đang chọn trước khi rời sang tab khác. */
function capture() {
  const s = useStore.getState();
  if (!s.path || !s.info) return;
  rememberPosition();
  const a = useAnnot.getState(), o = useOrganizer.getState(), ed = useEdit.getState();
  const org: Session["org"] = {};
  for (const k of ORG_KEYS) (org as Record<string, unknown>)[k] = o[k];
  sessions.set(s.path, {
    info: s.info, outline: s.outline, mode: s.mode, currentPage: s.currentPage, zoom: s.zoom, fit: s.fit, viewMode: s.viewMode,
    annot: { items: a.items, past: a.past, future: a.future, dirty: a.dirty }, org,
    edit: { edits: ed.edits, byPage: ed.byPage, past: ed.past, future: ed.future },
  });
  useStore.setState({ tabDirty: { ...s.tabDirty, [s.path]: liveDirty() } });
}

/** Đưa trạng thái đã cất của một tab trở lại các store. */
function restore(path: string, snap: Session, view: "home" | "doc") {
  searchGen++;
  useAnnot.getState().reset();
  useAnnot.setState(snap.annot);
  useOrganizer.setState(snap.org);
  useEdit.getState().reset();
  useEdit.setState(snap.edit);
  const s = useStore.getState();
  useStore.setState({
    path, info: snap.info, view, error: null, mode: snap.mode, currentPage: snap.currentPage, zoom: snap.zoom, fit: snap.fit,
    viewMode: snap.viewMode, outline: snap.outline, search: noSearch, nav: { page: snap.currentPage, y: null, nonce: s.nav.nonce + 1 },
  });
}

/** Đóng các tab (đã xác nhận xong). Đóng tab đang chọn thì chuyển sang tab kề; hết tab thì về Home. */
function closeNow(paths: string[]) {
  const s = useStore.getState();
  const gone = new Set(paths);
  if (gone.has(s.path ?? "")) rememberPosition();
  const remaining = s.tabs.filter((p) => !gone.has(p));
  const tabDirty = { ...s.tabDirty };
  paths.forEach((p) => { sessions.delete(p); delete tabDirty[p]; });
  useStore.setState({ tabs: remaining, tabDirty });
  if (!s.path || !gone.has(s.path)) return;
  const at = s.tabs.indexOf(s.path) - s.tabs.slice(0, s.tabs.indexOf(s.path)).filter((p) => gone.has(p)).length;
  const next = remaining[Math.min(at, remaining.length - 1)];
  const snap = next ? sessions.get(next) : undefined;
  if (next && snap) { restore(next, snap, s.view); return; }
  searchGen++;
  useAnnot.getState().reset();
  useOrganizer.getState().reset();
  useEdit.getState().reset();
  useStore.setState({ path: null, info: null, outline: [], search: noSearch, view: "home", mode: "view", currentPage: 0 });
}

const initialSettings = savedSettings();
let prefersDark = systemDark();

export const useStore = create<State>((set, get) => ({
  theme: resolveTheme(initialSettings.theme, prefersDark), pageTheme: savedPageTheme(), passwordPrompt: null, mode: "view",
  view: "home", settings: initialSettings, settingsOpen: false, tabs: [], tabDirty: {}, closePrompt: null,
  recent: parseRecent(readJson(RECENT_KEY)),
  leftOpen: true, leftWidth: LEFT.def, rightOpen: false, rightWidth: RIGHT.def,
  path: null, info: null, error: null, currentPage: 0, zoom: 1,
  viewMode: initialSettings.defaultViewMode, fit: initialZoom(initialSettings.defaultZoom).fit, tool: "select",
  leftTab: "thumbs", outline: [], nav: { page: 0, y: null, nonce: 0 }, search: noSearch,

  toggleTheme() {
    get().updateSettings({ theme: get().theme === "dark" ? "light" : "dark" });
  },
  setPageTheme(pageTheme) {
    db.setItem("folioscope.pageTheme", pageTheme);
    set({ pageTheme });
  },
  cancelPassword: () => set({ passwordPrompt: null }),
  setView: (view) => set({ view }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  updateSettings(patch) {
    const settings = sanitizeSettings({ ...get().settings, ...patch });
    writeJson(SETTINGS_KEY, settings);
    const recent = trimRecent(get().recent, settings.recentLimit);
    if (recent.length !== get().recent.length) writeJson(RECENT_KEY, recent);
    set({ settings, recent, theme: resolveTheme(settings.theme, prefersDark), viewMode: patch.defaultViewMode ?? get().viewMode });
  },
  resetSettings() { get().updateSettings(DEFAULT_SETTINGS); },
  setSystemDark(dark) {
    prefersDark = dark;
    set({ theme: resolveTheme(get().settings.theme, dark) });
  },
  togglePinRecent(path) { const recent = togglePin(get().recent, path); writeJson(RECENT_KEY, recent); set({ recent }); },
  forgetRecent(path) { const recent = removeRecent(get().recent, path); writeJson(RECENT_KEY, recent); set({ recent }); },
  clearRecent() { const recent = get().recent.filter((f) => f.pinned); writeJson(RECENT_KEY, recent); set({ recent }); },
  setMode: (mode) => set({ mode }),
  togglePanel: (p) => set(p === "left" ? { leftOpen: !get().leftOpen } : { rightOpen: !get().rightOpen }),
  dragPanel(p, raw) {
    const r = resolvePanelWidth(raw, p === "left" ? LEFT : RIGHT);
    set(p === "left" ? { leftOpen: r.open, leftWidth: r.width } : { rightOpen: r.open, rightWidth: r.width });
  },
  async load(path, password) {
    // Tài liệu đã mở ở tab khác thì chỉ chuyển sang tab đó (đừng mở lại bản thứ hai).
    if (!password && path !== get().path && get().tabs.includes(path)) { get().activateTab(path); return; }
    try {
      const info = await openDocument(path, password);
      searchGen++;
      const prev = get().path;
      const switching = prev !== path;
      if (switching) capture();
      const z = initialZoom(get().settings.defaultZoom);
      // Mở lại file đã đọc trước đây thì quay về trang, mức zoom và kiểu xem lần cuối.
      const pos = switching ? readPositions()[path] : undefined;
      const page = pos ? Math.min(pos.page, info.page_count - 1) : 0;
      if (switching) { useAnnot.getState().reset(); useEdit.getState().reset(); }
      set({
        path, info, view: "doc", error: null, passwordPrompt: null, currentPage: page,
        fit: pos ? pos.fit : z.fit, zoom: pos ? pos.zoom : z.zoom ?? get().zoom, viewMode: pos ? pos.viewMode : get().viewMode,
        outline: [], search: noSearch, nav: { page, y: null, nonce: get().nav.nonce + 1 },
        tabs: addTab(get().tabs, path, prev),
      });
      // Mục lục có thể không có hoặc hỏng; không để nó cản việc mở file.
      void get().noteRecent(path, info.page_count);
      getOutline(path).then((outline) => { if (get().path === path) set({ outline }); }).catch(() => {});
    } catch (e) {
      // File có mật khẩu: không báo lỗi, mở hộp nhập mật khẩu.
      const why = passwordFailure(e);
      if (why) set({ passwordPrompt: { path, wrong: why === "wrong" }, error: null });
      else set({ error: String(e), passwordPrompt: null });
    }
  },
  activateTab(path) {
    if (path === get().path) { set({ view: "doc" }); return; }
    const snap = sessions.get(path);
    if (!snap) { void get().load(path); return; }
    capture();
    restore(path, snap, "doc");
  },
  closeTab(path) {
    if (!get().tabs.includes(path)) return;
    if (isDirty(path)) set({ closePrompt: [path] });
    else closeNow([path]);
  },
  closeOtherTabs(path) {
    const others = get().tabs.filter((p) => p !== path);
    if (!others.length) return;
    if (others.some(isDirty)) set({ closePrompt: others });
    else closeNow(others);
  },
  confirmClose() { const ps = get().closePrompt; set({ closePrompt: null }); if (ps) closeNow(ps); },
  cancelClose: () => set({ closePrompt: null }),
  reorderTab: (from, to) => set({ tabs: moveTab(get().tabs, from, to) }),
  async noteRecent(path, pages) {
    const { recentLimit } = get().settings;
    const put = (size: number | null) => {
      const recent = addRecent(get().recent, { path, openedAt: Date.now(), size, pages }, recentLimit);
      writeJson(RECENT_KEY, recent);
      set({ recent });
    };
    put(null);
    // Dung lượng chỉ để hiển thị; không có cũng không sao.
    try { const [p] = await probeFiles([path]); if (p) put(p.size); } catch { /* bỏ qua */ }
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

// Nhớ vị trí đọc: ghi sau khi người dùng ngừng cuộn/zoom một lúc, và khi đóng cửa sổ.
let posTimer: ReturnType<typeof setTimeout> | undefined;
useStore.subscribe((s, p) => {
  if (s.path === p.path && s.currentPage === p.currentPage && s.zoom === p.zoom && s.fit === p.fit && s.viewMode === p.viewMode) return;
  clearTimeout(posTimer);
  posTimer = setTimeout(rememberPosition, 800);
});
if (typeof window !== "undefined") window.addEventListener("pagehide", rememberPosition);
