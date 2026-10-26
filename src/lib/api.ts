import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

export type DocumentInfo = { page_count: number; page_sizes: [number, number][] };
export type RenderedPage = { width: number; height: number; png_base64: string };

export const openDocument = (path: string) => invoke<DocumentInfo>("open_document", { path });
export const renderPage = (path: string, index: number, width: number) =>
  invoke<RenderedPage>("render_page", { path, index, width });

export async function pickPdf(): Promise<string | null> {
  const picked = await open({ multiple: false, filters: [{ name: "PDF", extensions: ["pdf"] }] });
  return typeof picked === "string" ? picked : null;
}

// ---- Gộp file ----
export type FileKind = "pdf" | "image" | "office" | "unsupported";
export type FileProbe = { path: string; name: string; kind: FileKind; size: number; pages: number | null; error: string | null };
export type CompressionLevel = "none" | "balanced" | "max";
export type CombineRequest = {
  files: { path: string; title: string }[];
  output: string;
  bookmarks: boolean;
  compression: CompressionLevel;
};
export type CombineProgress = { stage: "convert" | "merge" | "optimize" | "write"; current: number; total: number; file: string | null; percent: number };
export type CombineResult = { output: string; pages: number; bytes: number; converted: number };
export type MenuStatus = { supported: boolean; installed: boolean };

export const probeFiles = (paths: string[]) => invoke<FileProbe[]>("probe_files", { paths });
export const officeStatus = () => invoke<string | null>("office_status");
export const combineFiles = (request: CombineRequest) => invoke<CombineResult>("combine_files", { request });
export const cancelCombine = () => invoke<void>("cancel_combine");
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
