import { useState } from "react";
import { pickImage, type ObjEdit, type PageObj } from "../lib/api";
import { asHex } from "./model";
import { useEdit } from "./store";

const KIND_LABEL = { text: "Chữ", image: "Ảnh", shape: "Hình vẽ", group: "Nhóm đối tượng" } as const;

/** Nội dung bảng Thuộc tính bên phải khi ở chế độ "Chỉnh sửa". */
export function EditPanel() {
  const selected = useEdit((s) => s.selected);
  const objects = useEdit((s) => s.objects);
  const edits = useEdit((s) => s.edits);
  const total = Object.keys(edits).length;

  const [page, id] = selected ? selected.split(":").map(Number) : [-1, -1];
  const o = objects[page]?.find((x) => x.id === id);
  const e = selected ? edits[selected] : undefined;

  if (!o) {
    return (
      <div className="body edit-panel">
        <p>Chọn một đối tượng trên trang để xem và đổi thuộc tính.</p>
        <p className="muted">Chữ: nhấp đúp để gõ lại. Ảnh: kéo góc dưới phải để đổi cỡ, hoặc thay ảnh khác. Hình vẽ: đổi màu tô, màu viền, độ dày nét.</p>
        <p className="muted">{total ? `${total} đối tượng đã sửa, chưa lưu.` : "Chưa có sửa đổi nào."}</p>
      </div>
    );
  }
  return <ObjectProps key={selected} page={page} o={o} e={e} total={total} />;
}

function ObjectProps({ page, o, e, total }: { page: number; o: PageObj; e: ObjEdit | undefined; total: number }) {
  const set = (patch: Partial<ObjEdit>) => useEdit.getState().apply(page, o, patch);
  const text = e?.text ?? o.text ?? "";
  const [draft, setDraft] = useState(text);
  const size = e?.size ?? o.size ?? 12;
  const bold = e?.bold ?? o.bold;
  const fill = e?.fill ?? o.fill ?? "none";
  const stroke = e?.stroke ?? o.stroke ?? "none";
  const sw = e?.strokeWidth ?? o.strokeWidth ?? 1;

  const swap = async () => { const f = await pickImage(); if (f) set({ image: f }); };

  return (
    <div className="body edit-panel">
      <h3>{KIND_LABEL[o.kind]}{e ? " · đã sửa" : ""}</h3>

      {o.kind === "text" && (
        <>
          <label>Nội dung
            <textarea rows={3} value={draft} onChange={(ev) => setDraft(ev.target.value)}
              onBlur={() => { if (draft !== text && draft.trim()) set({ text: draft }); else setDraft(text); }} />
          </label>
          <label>Cỡ chữ (pt)
            <input type="number" min={1} max={400} step={0.5} value={Math.round(size * 10) / 10}
              onChange={(ev) => { const v = Number(ev.target.value); if (v >= 1) set({ size: v }); }} />
          </label>
          <label className="row"><input type="checkbox" checked={bold} onChange={(ev) => set({ bold: ev.target.checked })} /> Đậm</label>
          <label>Màu chữ
            <input type="color" value={asHex(e?.fill ?? o.fill)} onChange={(ev) => set({ fill: ev.target.value })} />
          </label>
          <p className="muted">Phông gốc: {o.font ?? "không rõ"}. Chữ đã gõ lại sẽ dùng phông Arial (giữ được dấu tiếng Việt).</p>
        </>
      )}

      {o.kind === "image" && (
        <>
          <button className="btn secondary" onClick={() => void swap()}>Thay ảnh…</button>
          {e?.image && <p className="muted">Ảnh mới: {e.image.split(/[\\/]/).pop()}</p>}
          <p className="muted">Ảnh mới được đặt vào đúng khung của ảnh cũ. Kéo góc dưới phải để đổi cỡ.</p>
        </>
      )}

      {o.kind === "shape" && (
        <>
          <label className="row"><input type="checkbox" checked={fill !== "none"} onChange={(ev) => set({ fill: ev.target.checked ? asHex(o.fill, "#FFE066") : "none" })} /> Tô màu</label>
          {fill !== "none" && <input type="color" aria-label="Màu tô" value={asHex(fill)} onChange={(ev) => set({ fill: ev.target.value })} />}
          <label className="row"><input type="checkbox" checked={stroke !== "none"} onChange={(ev) => set({ stroke: ev.target.checked ? asHex(o.stroke, "#000000") : "none" })} /> Viền</label>
          {stroke !== "none" && (
            <>
              <input type="color" aria-label="Màu viền" value={asHex(stroke)} onChange={(ev) => set({ stroke: ev.target.value })} />
              <label>Độ dày nét (pt)
                <input type="number" min={0.25} max={50} step={0.25} value={Math.round(sw * 100) / 100}
                  onChange={(ev) => { const v = Number(ev.target.value); if (v > 0) set({ strokeWidth: v }); }} />
              </label>
            </>
          )}
        </>
      )}

      {o.kind === "group" && <p className="muted">Nhóm đối tượng phức tạp: chỉ di chuyển, đổi cỡ hoặc xoá được.</p>}

      <div className="edit-actions">
        <button className="btn secondary" onClick={() => { set({ deleted: true }); useEdit.getState().select(null); }}>Xoá</button>
        {e && <button className="btn ghost" onClick={() => useEdit.getState().revert(page, o.id)}>Khôi phục bản gốc</button>}
      </div>
      <p className="muted">{total} đối tượng đã sửa, chưa lưu.</p>
    </div>
  );
}
