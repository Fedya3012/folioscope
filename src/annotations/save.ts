import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { Annotation } from "./types";

/** Hỏi nơi lưu rồi ghi chú thích vào một bản sao PDF. Không bao giờ ghi đè file gốc. */
export async function savePath(path: string, items: Annotation[]): Promise<string | null> {
  const base = path.replace(/\.pdf$/i, "");
  const out = await save({ defaultPath: `${base} (ghi chú).pdf`, filters: [{ name: "PDF", extensions: ["pdf"] }] });
  if (!out) return null;
  if (out === path) throw new Error("Hãy chọn tên khác, Folioscope không ghi đè file gốc.");
  await invoke("save_annotations", { path, out, items });
  return out;
}
