import { create } from "zustand";
import { open } from "@tauri-apps/plugin-dialog";
import {
  COMBINE_EXTENSIONS, exportPages, fileSize, getOutline, openDocument, pickFolder, pickSavePath, preparePdf,
  saveClipboardImage, type DocumentInfo, type OutlineItem, type PageRef,
} from "./lib/api";
import {
  checkCrop, chunkByBytes, chunkEvery, clearNumbers, cropItems, estimatePageBytes, groupsByBookmarks, insertItems,
  moveItems, numberItems, parseRanges, parseSingleRange, partName, pushHistory, rangeIds, redoHistory, removeItems,
  replaceItems, reverseItems, rotateItems, splitFileName, undoHistory,
  type Crop, type History, type NumberSpec, type PageItem,
} from "./lib/organizer";
import { ensureOffice } from "./lib/office";
import { toast } from "./lib/toast";
import { useStore } from "./store";

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "gif", "bmp", "tif", "tiff", "webp"];


let nextId = 1;
const newId = () => `pg${nextId++}`;

const itemsOf = (path: string, info: DocumentInfo): PageItem[] =>
  info.page_sizes.map(([w, h], index) => ({ id: newId(), source: path, index, rot: 0, w, h }));

const toRefs = (items: PageItem[]): PageRef[] =>
  items.map((p) => ({
    source: p.source, index: p.index, rotate: p.rot, width: p.w, height: p.h,
    crop: p.crop ? [p.crop.l, p.crop.t, p.crop.r, p.crop.b] : null,
    stamp: p.stamp ?? null,
  }));

/** Số trang và dung lượng của các file nguồn, để ước lượng khi tách theo dung lượng. */
const sourceStats = new Map<string, { pages: number; bytes: number }>();

/** Cắt cây dấu trang lấy trang đích của các mục cấp cao nhất. */
export const topBookmarkPages = (outline: OutlineItem[]): Set<number> =>
  new Set(outline.map((o) => o.page).filter((p): p is number => p !== null && p >= 0));

/** Đưa file về PDF; gặp Word/Excel/PowerPoint mà chưa có LibreOffice thì mời cài rồi thử lại. */
async function toPdf(path: string): Promise<string> {
  try {
    return await preparePdf(path);
  } catch (e) {
    if (String(e) !== "OFFICE_MISSING") throw e;
    if (!(await ensureOffice())) throw new Error("Chưa có bộ chuyển đổi Word, Excel, PowerPoint nên chưa chèn được file này.");
    return preparePdf(path);
  }
}

/** Chèn ở đâu: đúng chỗ khe đã bấm/thả, hoặc ngay sau trang chọn cuối cùng. */
export type InsertSource = "blank" | "file" | "image" | "clipboard";

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
  /** Đường dẫn gốc để đặt tên file lưu (khi danh sách dựng từ nhiều file, hoặc file đầu là bản chuyển tạm). */
  hintPath: string | null;
  /** File cần thêm vào cuối ngay khi tài liệu nền đã nạp (dùng khi mở từ hộp thoại Gộp file). */
  pending: string[] | null;

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
  insertBlank(at?: number): void;
  insert(source: InsertSource, at?: number): Promise<void>;
  /** Chèn các file (PDF, ảnh, Word...) vào vị trí `at` (mặc định sau trang chọn cuối). */
  insertFiles(paths: string[], at?: number): Promise<void>;
  insertClipboardImage(png: Blob, at?: number): Promise<void>;
  replaceFromFile(path: string, range: string): Promise<boolean>;
  cropSelected(crop: Crop | null): boolean;
  numberPages(spec: NumberSpec): void;
  removeNumbers(): void;
  /** Mở Page Organizer với danh sách file theo thứ tự (file đầu làm tài liệu nền, các file sau nối vào). */
  openFiles(paths: string[]): Promise<void>;

  save(): Promise<string | null>;
  extract(): Promise<void>;
  split(mode: "every" | "ranges" | "bookmarks" | "size", value: string): Promise<boolean>;
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
    history: { past: [], future: [] }, thumb: 180, busy: false, hintPath: null, pending: null,

    sync(path, info) {
      if (info === get().baseInfo) return;
      if (!path || !info) { get().reset(); return; }
      const items = itemsOf(path, info);
      sourceStats.set(path, { pages: info.page_count, bytes: 0 });
      void fileSize(path).then((bytes) => sourceStats.set(path, { pages: info.page_count, bytes })).catch(() => {});
      const pending = get().pending;
      set({
        baseInfo: info, basePath: path, items, selected: new Set(), anchor: null,
        history: { past: [], future: [] }, pending: null, hintPath: pending ? get().hintPath : null,
      });
      if (pending?.length) void get().insertFiles(pending, items.length);
    },
    reset: () => set({
      baseInfo: null, basePath: null, items: [], selected: new Set(), anchor: null,
      history: { past: [], future: [] }, hintPath: null, pending: null,
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

    insertBlank(at) {
      const { items } = get();
      if (items.length === 0) return;
      const pos = at ?? insertionPoint();
      const ref = items[Math.max(0, Math.min(pos, items.length) - 1)];
      const blank: PageItem = { id: newId(), source: null, index: 0, rot: 0, w: ref.w, h: ref.h };
      commit(insertItems(items, pos, [blank]), { selected: new Set([blank.id]), anchor: blank.id });
    },
    async insert(source, at) {
      if (source === "blank") { get().insertBlank(at); return; }
      if (source === "clipboard") {
        try {
          const blob = await readClipboardImage();
          if (!blob) { toast.error("Clipboard không có ảnh. Hãy sao chép một ảnh rồi thử lại."); return; }
          await get().insertClipboardImage(blob, at);
        } catch (e) { fail(e); }
        return;
      }
      try {
        const picked = await open({
          multiple: true,
          filters: source === "image"
            ? [{ name: "Ảnh", extensions: IMAGE_EXTENSIONS }]
            : [{ name: "Tất cả file hỗ trợ", extensions: COMBINE_EXTENSIONS }, { name: "PDF", extensions: ["pdf"] }],
        });
        const paths = Array.isArray(picked) ? picked : typeof picked === "string" ? [picked] : [];
        if (paths.length) await get().insertFiles(paths, at);
      } catch (e) { fail(e); }
    },
    async insertFiles(paths, at) {
      if (!paths.length) return;
      set({ busy: true });
      const added: PageItem[] = [];
      const skipped: string[] = [];
      for (const path of paths) {
        try {
          const pdf = await toPdf(path);
          const info = await openDocument(pdf);
          sourceStats.set(pdf, { pages: info.page_count, bytes: await fileSize(pdf).catch(() => 0) });
          added.push(...itemsOf(pdf, info));
        } catch (e) {
          const why = String(e);
          const name = path.split(/[\\/]/).pop();
          skipped.push(`${name}: ${why.includes("PASSWORD") ? "file có mật khẩu, hãy mở khoá trước" : why}`);
        }
      }
      set({ busy: false });
      if (skipped.length) toast.error(skipped.length === 1 ? skipped[0] : `${skipped.length} file không chèn được: ${skipped.join("; ")}`);
      if (!added.length) return;
      const pos = at ?? insertionPoint();
      commit(insertItems(get().items, pos, added), { selected: new Set(added.map((p) => p.id)), anchor: added[0].id });
      toast.success(`Đã chèn ${added.length} trang`, undoAction);
    },
    async insertClipboardImage(png, at) {
      try {
        const pdf = await saveClipboardImage(await blobToBase64(png));
        const info = await openDocument(pdf);
        const added = itemsOf(pdf, info);
        commit(insertItems(get().items, at ?? insertionPoint(), added), { selected: new Set(added.map((p) => p.id)), anchor: added[0]?.id ?? null });
        toast.success("Đã chèn ảnh từ clipboard", undoAction);
      } catch (e) { fail(e); }
    },
    async replaceFromFile(path, range) {
      const { items, selected } = get();
      if (selected.size === 0) return false;
      try {
        set({ busy: true });
        const pdf = await toPdf(path);
        const info = await openDocument(pdf);
        const picks = parseSingleRange(range, info.page_count);
        const all = itemsOf(pdf, info);
        const added = picks.map((i) => ({ ...all[i], id: newId() }));
        const n = selected.size;
        commit(replaceItems(items, selected, added), { busy: false, selected: new Set(added.map((p) => p.id)), anchor: added[0]?.id ?? null });
        toast.success(`Đã thay ${n} trang bằng ${added.length} trang`, undoAction);
        return true;
      } catch (e) { fail(e); return false; }
    },
    cropSelected(crop) {
      const { items, selected } = get();
      const target = selected.size ? selected : new Set(items.map((p) => p.id));
      const err = crop ? checkCrop(items, target, crop) : null;
      if (err) { toast.error(err); return false; }
      commit(cropItems(items, target, crop));
      toast.success(crop ? `Đã cắt lề ${target.size} trang (áp dụng khi lưu)` : "Đã bỏ cắt lề", undoAction);
      return true;
    },
    numberPages(spec) {
      const { items, selected } = get();
      commit(numberItems(items, selected, spec));
      toast.success(`Đã đánh số ${selected.size || items.length} trang (in vào file khi lưu)`, undoAction);
    },
    removeNumbers() {
      const { items, selected } = get();
      commit(clearNumbers(items, selected));
    },
    async openFiles(paths) {
      if (!paths.length) return;
      try {
        const pdfs: string[] = [];
        for (const p of paths) pdfs.push(await toPdf(p));
        set({ pending: pdfs.slice(1), hintPath: paths[0] });
        const app = useStore.getState();
        await app.load(pdfs[0]);
        // load lỗi (hoặc cần mật khẩu) thì không vào Trang
        if (useStore.getState().path !== pdfs[0]) { set({ pending: null }); return; }
        app.setMode("pages");
      } catch (e) { set({ pending: null }); toast.error(String(e)); }
    },

    /** Ghi toàn bộ danh sách thành file mới; trả về đường dẫn đã ghi. */
    async save() {
      const { items, basePath, hintPath } = get();
      if (!basePath || items.length === 0) return null;
      const { dir, sep, base } = splitFileName(hintPath ?? basePath);
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
      const { items, selected, basePath, hintPath } = get();
      const picked = items.filter((p) => selected.has(p.id));
      if (picked.length === 0 || !basePath) return;
      const { dir, sep, base } = splitFileName(hintPath ?? basePath);
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
      const { items, basePath, hintPath } = get();
      if (!basePath || items.length === 0) return false;
      let groups: number[][];
      try {
        if (mode === "every") groups = chunkEvery(Number(value), items.length);
        else if (mode === "ranges") groups = parseRanges(value, items.length);
        else if (mode === "bookmarks") {
          const starts = topBookmarkPages(await getOutline(basePath));
          if (starts.size === 0) throw new Error("Tài liệu này không có dấu trang (bookmark) để tách.");
          groups = groupsByBookmarks(items, basePath, starts);
          if (groups.length < 2) throw new Error("Các dấu trang đều ở cùng một chỗ nên không tách được thành nhiều file.");
        } else {
          const mb = Number(value);
          if (!(mb > 0)) throw new Error("Dung lượng tối đa phải là số lớn hơn 0 (MB).");
          groups = chunkByBytes(items.map((p) => estimatePageBytes(p, p.source ? sourceStats.get(p.source) : undefined)), mb * 1024 * 1024);
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
        return false;
      }
      try {
        const folder = await pickFolder();
        if (!folder) return false;
        set({ busy: true });
        const { sep, base } = splitFileName(hintPath ?? basePath);
        const dir = folder.replace(/[\\/]+$/, "");
        for (const [n, group] of groups.entries()) {
          await exportPages(toRefs(group.map((i) => items[i])), `${dir}${sep}${partName(base, n + 1, groups.length)}`);
        }
        set({ busy: false });
        toast.success(`Đã tách thành ${groups.length} file trong ${dir}${mode === "size" ? " (dung lượng là ước lượng)" : ""}`);
        return true;
      } catch (e) { fail(e); return false; }
    },
  };
});

/** Đọc ảnh từ clipboard (cần quyền của WebView; không có ảnh thì trả null). */
async function readClipboardImage(): Promise<Blob | null> {
  if (!navigator.clipboard?.read) throw new Error("Không đọc được clipboard. Hãy dùng Ctrl+V khi đang ở màn hình Trang.");
  for (const item of await navigator.clipboard.read()) {
    const type = item.types.find((t) => t.startsWith("image/"));
    if (type) return item.getType(type);
  }
  return null;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
