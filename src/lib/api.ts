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
