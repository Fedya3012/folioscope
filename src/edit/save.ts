import { pickSavePath, saveContentEdits } from "../lib/api";
import { toast } from "../lib/toast";
import { clearThumbs } from "../lib/thumbs";
import { useStore } from "../store";
import { useEdit } from "./store";

/** Ghi mọi sửa đổi ra file. `copy` hỏi tên mới; `overwrite` ghi đè file gốc và giữ bản cũ thành `.bak`. */
export async function saveEdits(path: string, how: "copy" | "overwrite"): Promise<boolean> {
  const edits = Object.values(useEdit.getState().edits);
  if (!edits.length) return false;
  let out = path;
  if (how === "copy") {
    const picked = await pickSavePath(`${path.replace(/\.pdf$/i, "")} (đã sửa).pdf`);
    if (!picked) return false;
    out = picked;
  }
  try {
    const r = await saveContentEdits(path, out, edits);
    const same = out === path;
    useEdit.getState().saved();
    if (same) clearThumbs(path);
    if (r.font_fallback) toast.warning("Máy không có phông Arial nên chữ mới dùng Helvetica, dấu tiếng Việt có thể bị thiếu.");
    if (same) toast.success(`Đã lưu ${r.applied} thay đổi (bản cũ giữ thành .bak)`);
    else toast.success(`Đã lưu ${r.applied} thay đổi vào bản sao`, { label: "Mở bản sao", run: () => void useStore.getState().load(out) });
    return true;
  } catch (e) {
    toast.error(`Không lưu được: ${String(e)}`);
    return false;
  }
}
