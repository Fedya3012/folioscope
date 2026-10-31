import { savePath } from "./save";
import { useAnnot } from "./store";
import { UNITS, type Unit } from "./measure";
import { COLORS, STAMPS, TOOLS, isMeasure } from "./types";
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
        <button key={t.id} aria-pressed={a.tool === t.id} title={t.hint ? `${t.label} (${t.hint})` : t.label} onClick={() => a.setTool(t.id)}>{t.label}</button>
      ))}
      <span className="sep" />
      {COLORS.map((c) => (
        <button key={c} className="swatch" aria-label={`Màu ${c}`} aria-pressed={a.color === c} style={{ background: c }} onClick={() => a.setStyle({ color: c })} />
      ))}
      {a.tool === "stamp" && (
        <select aria-label="Loại tem" value={a.stamp} onChange={(e) => a.setStamp(e.target.value)}>
          {STAMPS.map((x) => <option key={x.label}>{x.label}</option>)}
        </select>
      )}
      {isMeasure(a.tool) && (
        <span className="measure-opts">
          <select aria-label="Đơn vị đo" value={a.scale.unit} onChange={(e) => a.setScale({ unit: e.target.value as Unit })}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select>
          {a.tool !== "distance" && <em>Bấm từng điểm, bấm đúp hoặc Enter để kết thúc</em>}
        </span>
      )}
      <span className="spacer" />
      <button disabled={!a.past.length} onClick={a.undo}>Hoàn tác</button>
      <button disabled={!a.future.length} onClick={a.redo}>Làm lại</button>
      <button className="save" disabled={!path || !count} onClick={save}>Lưu bản sao có ghi chú ({count})</button>
    </div>
  );
}
