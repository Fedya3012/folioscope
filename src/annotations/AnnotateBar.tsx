import { savePath } from "./save";
import { useAnnot } from "./store";
import { COLORS, TOOLS } from "./types";
import { useStore } from "../store";

/** Thanh công cụ ghi chú, hiện ngay dưới thanh chính khi vào chế độ "Ghi chú". */
export function AnnotateBar() {
  const a = useAnnot();
  const { path, mode } = useStore();
  if (mode !== "annotate") return null;
  const count = a.items.length;

  const save = async () => {
    if (!path) return;
    try {
      const out = await savePath(path, a.items);
      if (out) useAnnot.setState({ dirty: false });
    } catch (e) {
      useStore.setState({ error: String(e) });
    }
  };

  return (
    <div className="annot-bar" role="toolbar" aria-label="Công cụ ghi chú">
      {TOOLS.map((t) => (
        <button key={t.id} aria-pressed={a.tool === t.id} title={`${t.label} (${t.hint})`} onClick={() => a.setTool(t.id)}>{t.label}</button>
      ))}
      <span className="sep" />
      {COLORS.map((c) => (
        <button key={c} className="swatch" aria-label={`Màu ${c}`} aria-pressed={a.color === c} style={{ background: c }} onClick={() => a.setStyle({ color: c })} />
      ))}
      <span className="spacer" />
      <button disabled={!a.past.length} onClick={a.undo}>Hoàn tác</button>
      <button disabled={!a.future.length} onClick={a.redo}>Làm lại</button>
      <button className="save" disabled={!path || !count} onClick={save}>Lưu bản sao có ghi chú ({count})</button>
    </div>
  );
}
