import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

export type DocumentInfo = { page_count: number; page_sizes: [number, number][] };
export type RenderedPage = { width: number; height: number; png_base64: string };

export const openDocument = (path: string, password?: string) =>
  invoke<DocumentInfo>("open_document", { path, password: password ?? null });
export const renderPage = (path: string, index: number, width: number) =>
  invoke<RenderedPage>("render_page", { path, index, width });

export async function pickPdf(): Promise<string | null> {
  const picked = await open({ multiple: false, filters: [{ name: "PDF", extensions: ["pdf"] }] });
  return typeof picked === "string" ? picked : null;
}

// ---- Gộp file ----
export type FileKind = "pdf" | "image" | "office" | "unsupported";
export type FileProbe = {
  path: string; name: string; kind: FileKind; size: number; pages: number | null; error: string | null;
  /** PDF có mật khẩu (chưa nhập hoặc nhập sai). */
  needs_password: boolean;
};
export type CompressionLevel = "none" | "balanced" | "max";
export type CombineRequest = {
  files: { path: string; title: string; password?: string | null }[];
  output: string;
  bookmarks: boolean;
  /** Giữ dấu trang gốc của từng PDF. */
  keep_bookmarks: boolean;
  /** Đưa mọi trang về khổ A4. */
  normalize_a4: boolean;
  compression: CompressionLevel;
};
export type CombineProgress = { stage: "convert" | "merge" | "optimize" | "write"; current: number; total: number; file: string | null; percent: number };
export type CombineResult = { output: string; pages: number; bytes: number; converted: number };
export type MenuStatus = { supported: boolean; installed: boolean };

export const probeFiles = (paths: string[], password?: string) =>
  invoke<FileProbe[]>("probe_files", { paths, password: password ?? null });
export const officeStatus = () => invoke<string | null>("office_status");
export const combineFiles = (request: CombineRequest) => invoke<CombineResult>("combine_files", { request });
export const cancelCombine = () => invoke<void>("cancel_combine");

// ---- Bộ chuyển đổi Office (LibreOffice tải khi cần) ----
export type OfficeProgress = { stage: "find" | "download" | "verify" | "extract" | "done"; percent: number | null; downloaded: number; total: number };
export const officeInstallSupported = () => invoke<boolean>("office_install_supported");
export const officeInstall = () => invoke<string>("office_install");
export const officeInstallCancel = () => invoke<void>("office_install_cancel");

/** Đưa file về PDF để chèn vào tài liệu (PDF giữ nguyên; ảnh, Word, Excel, PowerPoint được chuyển). Lỗi `OFFICE_MISSING` = cần cài LibreOffice. */
export const preparePdf = (path: string) => invoke<string>("prepare_pdf", { path });
export const saveClipboardImage = (pngBase64: string) => invoke<string>("save_clipboard_image", { pngBase64 });
export const fileSize = (path: string) => invoke<number>("file_size", { path });
export const takeLaunchFiles = () => invoke<string[]>("take_launch_files");
export const shellMenuStatus = () => invoke<MenuStatus>("shell_menu_status");
export const shellMenuInstall = () => invoke<void>("shell_menu_install");
export const shellMenuUninstall = () => invoke<void>("shell_menu_uninstall");

export const COMBINE_EXTENSIONS = [
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf", "txt", "csv", "html", "htm",
  "jpg", "jpeg", "png", "gif", "bmp", "tif", "tiff", "webp",
];

export async function pickFilesToCombine(): Promise<string[]> {
  const picked = await open({
    multiple: true,
    filters: [
      { name: "Tất cả file hỗ trợ", extensions: COMBINE_EXTENSIONS },
      { name: "PDF", extensions: ["pdf"] },
    ],
  });
  return Array.isArray(picked) ? picked : [];
}

export async function pickCombineOutput(defaultPath: string): Promise<string | null> {
  return save({ defaultPath, filters: [{ name: "PDF", extensions: ["pdf"] }] });
}
/** Một trang của tài liệu kết quả khi ghi file (khớp `PageRef` ở Rust). */
export type PageRef = {
  source: string | null; index: number; rotate: number; width: number; height: number;
  /** Cắt lề [trái, trên, phải, dưới] (pt). */
  crop: [number, number, number, number] | null;
  stamp: { text: string; pos: string; size: number; margin: number } | null;
};

export const exportPages = (pages: PageRef[], output: string) =>
  invoke<number>("export_pages", { pages, output });

export async function pickSavePath(defaultPath: string): Promise<string | null> {
  return save({ defaultPath, filters: [{ name: "PDF", extensions: ["pdf"] }] });
}

export async function pickFolder(): Promise<string | null> {
  const picked = await open({ directory: true, multiple: false });
  return typeof picked === "string" ? picked : null;
}
/** Hình chữ nhật theo tỉ lệ trang (0..1, gốc ở góc trên trái): [trái, trên, rộng, cao]. */
export type NormRect = [number, number, number, number];
export type OutlineItem = { title: string; page: number | null; children: OutlineItem[] };
export type TextRun = { text: string; rect: NormRect };
export type SearchHit = { page: number; rects: NormRect[] };
export type SearchResult = { hits: SearchHit[]; truncated: boolean };

export const getOutline = (path: string) => invoke<OutlineItem[]>("get_outline", { path });
export const getTextRuns = (path: string, index: number) => invoke<TextRun[]>("get_text_runs", { path, index });
export const searchText = (path: string, query: string, matchCase: boolean) =>
  invoke<SearchResult>("search_text", { path, query, matchCase });
