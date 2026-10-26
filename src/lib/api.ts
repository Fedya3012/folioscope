import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export type DocumentInfo = { page_count: number; page_sizes: [number, number][] };
export type RenderedPage = { width: number; height: number; png_base64: string };

export const openDocument = (path: string) => invoke<DocumentInfo>("open_document", { path });
export const renderPage = (path: string, index: number, width: number) =>
  invoke<RenderedPage>("render_page", { path, index, width });

export async function pickPdf(): Promise<string | null> {
  const picked = await open({ multiple: false, filters: [{ name: "PDF", extensions: ["pdf"] }] });
  return typeof picked === "string" ? picked : null;
}
