import { useEffect, useState } from "react";
import { saveEdits } from "./save";
import { countEdits } from "./model";
import { useEdit } from "./store";
import { useStore } from "../store";

/** Thanh công cụ của chế độ "Chỉnh sửa", hiện ngay dưới thanh chính. */
export function EditBar() {
  const mode = useStore((s) => s.mode);
  const path = useStore((s) => s.path);
  const count = useEdit((s) => countEdits(s.edits));
  const canUndo = useEdit((s) => s.past.length > 0);
  const canRedo = useEdit((s) => s.future.length > 0);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!confirm) return; const t = setTimeout(() => setConfirm(false), 5000); return () => clearTimeout(t); }, [confirm]);
  if (mode !== "edit" || !path) return null;

  const run = async (how: "copy" | "overwrite") => {
    setBusy(true); setConfirm(false);
    try { await saveEdits(path, how); } finally { setBusy(false); }
  };

  return (
    <div className="annot-bar edit-bar" role="toolbar" aria-label="Công cụ chỉnh sửa nội dung">
      <span className="edit-hint">Bấm vào chữ, ảnh hoặc hình để chọn · nhấp đúp chữ để sửa · kéo để di chuyển · Delete để xoá</span>
      <span className="spacer" />
      <button disabled={!canUndo} onClick={() => useEdit.getState().undo()}>Hoàn tác</button>
      <button disabled={!canRedo} onClick={() => useEdit.getState().redo()}>Làm lại</button>
      <button disabled={busy || !count} onClick={() => (confirm ? void run("overwrite") : setConfirm(true))} title="Ghi đè file gốc, bản cũ giữ thành .bak">
        {confirm ? "Bấm lần nữa để ghi đè" : "Lưu đè"}
      </button>
      <button className="save" disabled={busy || !count} onClick={() => void run("copy")}>Lưu bản sao… ({count})</button>
    </div>
  );
}
