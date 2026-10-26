import { bounds } from "./geometry";
import { useAnnot } from "./store";
import { COLORS, type Annotation } from "./types";

/** Thanh nổi hiện phía trên đối tượng đang chọn: đổi màu, nét, sửa chữ, nhân đôi, xoá. */
export function FloatingToolbar({ a }: { a: Annotation }) {
  const { setStyle, remove, duplicate, edit } = useAnnot.getState();
  const b = bounds(a);
  const flip = b.y < 0.08; // sát mép trên thì hiện bên dưới
  const left = Math.min(Math.max(b.x * 100, 0), 70);
  const style = flip
    ? { left: `${left}%`, top: `${(b.y + b.h) * 100}%`, marginTop: 34 }
    : { left: `${left}%`, top: `${b.y * 100}%`, marginTop: -44 };
  const hasText = a.kind === "note" || a.kind === "text";
  const hasStroke = a.kind !== "highlight" && a.kind !== "note";

  return (
    <div className="float-toolbar" style={style} role="toolbar" aria-label="Thuộc tính ghi chú" onPointerDown={(e) => e.stopPropagation()}>
      {COLORS.map((c) => (
        <button key={c} className="swatch" aria-label={`Màu ${c}`} aria-pressed={a.color === c}
          style={{ background: c }} onClick={() => setStyle({ color: c })} />
      ))}
      {hasStroke && (
        <>
          <span className="sep" />
          <button aria-label="Nét mảnh hơn" onClick={() => setStyle({ strokeWidth: Math.max(1, a.strokeWidth - 1) })}>−</button>
          <span className="val">{a.strokeWidth}</span>
          <button aria-label="Nét dày hơn" onClick={() => setStyle({ strokeWidth: Math.min(12, a.strokeWidth + 1) })}>+</button>
        </>
      )}
      <span className="sep" />
      {hasText && <button onClick={() => edit(a.id)}>Sửa chữ</button>}
      <button onClick={() => duplicate(a.id)}>Nhân đôi</button>
      <button className="danger" onClick={() => remove(a.id)}>Xoá</button>
    </div>
  );
}
