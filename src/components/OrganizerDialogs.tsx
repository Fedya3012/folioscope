import { useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { COMBINE_EXTENSIONS } from "../lib/api";
import {
  mmToPt, NUMBER_FORMATS, ptToMm, type Crop, type NumberFormat, type StampPos,
} from "../lib/organizer";
import { useOrganizer } from "../organizerStore";
import { CropShade, Thumb, tileBox } from "./PageThumb";

/** Lớp phủ + khung dùng chung cho các hộp thoại nhỏ của Page Organizer. */
function Dialog({ title, label, onClose, onSubmit, children }: {
  title: string; label: string; onClose: () => void; onSubmit: () => void; children: React.ReactNode;
}) {
  return (
    <div className="modal-scrim" onPointerDown={onClose}>
      <div className="modal" role="dialog" aria-label={label} onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "BUTTON") onSubmit(); }}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** Đọc số kiểu Việt (dấu phẩy thập phân) hoặc kiểu thường; rỗng là 0, sai là NaN. */
const num = (v: string) => (v.trim() === "" ? 0 : Number(v.replace(",", ".")));

export function SplitDialog({ total, onClose }: { total: number; onClose: () => void }) {
  const split = useOrganizer((s) => s.split);
  const busy = useOrganizer((s) => s.busy);
  const [mode, setMode] = useState<"every" | "ranges" | "bookmarks" | "size">("every");
  const [every, setEvery] = useState("10");
  const [ranges, setRanges] = useState("");
  const [mb, setMb] = useState("10");

  const value = mode === "every" ? every : mode === "ranges" ? ranges : mode === "size" ? mb : "";
  const submit = async () => { if (await split(mode, value)) onClose(); };

  return (
    <Dialog title="Tách file" label="Tách file" onClose={onClose} onSubmit={() => void submit()}>
      <p className="muted">Tách {total} trang hiện tại (theo thứ tự đang sắp xếp) thành nhiều file, rồi chọn thư mục để lưu.</p>
      <label className="radio">
        <input type="radio" checked={mode === "every"} onChange={() => setMode("every")} />
        Mỗi file
        <input className="inp" type="number" min={1} value={every} disabled={mode !== "every"}
          onChange={(e) => setEvery(e.target.value)} aria-label="Số trang mỗi file" autoFocus />
        trang
      </label>
      <label className="radio">
        <input type="radio" checked={mode === "ranges"} onChange={() => setMode("ranges")} />
        Theo khoảng trang
      </label>
      <input className="inp wide" placeholder="Ví dụ: 1-3, 5, 7-9 (mỗi mục là một file)" value={ranges}
        disabled={mode !== "ranges"} onChange={(e) => setRanges(e.target.value)} aria-label="Khoảng trang" />
      <label className="radio">
        <input type="radio" checked={mode === "bookmarks"} onChange={() => setMode("bookmarks")} />
        Theo dấu trang (bookmark) cấp cao nhất: mỗi mục một file
      </label>
      <label className="radio">
        <input type="radio" checked={mode === "size"} onChange={() => setMode("size")} />
        Theo dung lượng, tối đa
        <input className="inp" type="number" min={0.1} step={0.5} value={mb} disabled={mode !== "size"}
          onChange={(e) => setMb(e.target.value)} aria-label="Dung lượng tối đa mỗi file (MB)" />
        MB
      </label>
      {mode === "size" && <p className="muted">Dung lượng được ước lượng theo số trang, nên file thực tế có thể lệch một chút.</p>}
      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>Huỷ</button>
        <button className="btn primary" onClick={() => void submit()} disabled={busy}>{busy ? "Đang tách…" : "Chọn thư mục và tách"}</button>
      </div>
    </Dialog>
  );
}

const MARGIN_LABELS: [keyof Crop, string][] = [["l", "Trái"], ["t", "Trên"], ["r", "Phải"], ["b", "Dưới"]];

/** Cắt lề: nhập lề (mm) cho các trang đã chọn (không chọn gì thì cho cả tài liệu), có xem trước trên trang đầu. */
export function CropDialog({ onClose }: { onClose: () => void }) {
  const items = useOrganizer((s) => s.items);
  const selected = useOrganizer((s) => s.selected);
  const cropSelected = useOrganizer((s) => s.cropSelected);
  const targets = useMemo(() => (selected.size ? items.filter((p) => selected.has(p.id)) : items), [items, selected]);
  const first = targets[0];
  const mm = (v: number) => String(Math.round(ptToMm(v) * 10) / 10);
  const [vals, setVals] = useState<Record<keyof Crop, string>>({
    l: mm(first?.crop?.l ?? 0), t: mm(first?.crop?.t ?? 0), r: mm(first?.crop?.r ?? 0), b: mm(first?.crop?.b ?? 0),
  });
  const crop: Crop = { l: mmToPt(num(vals.l)), t: mmToPt(num(vals.t)), r: mmToPt(num(vals.r)), b: mmToPt(num(vals.b)) };
  const hasCrop = targets.some((p) => p.crop);
  if (!first) return null;

  const [bw, bh] = tileBox(first, 150);
  const submit = () => { if (cropSelected(crop)) onClose(); };

  return (
    <Dialog title="Cắt lề trang" label="Cắt lề trang" onClose={onClose} onSubmit={submit}>
      <p className="muted">
        Áp dụng cho {selected.size ? `${targets.length} trang đã chọn` : `tất cả ${targets.length} trang`}.
        Phần bị cắt được tô mờ; trang chỉ thật sự bị cắt khi bạn lưu file.
      </p>
      <div className="crop-body">
        <div className="obox crop-preview" style={{ width: bw, height: bh }}>
          <Thumb item={first} bw={bw} bh={bh} />
          <CropShade item={{ ...first, crop }} bw={bw} />
        </div>
        <div className="crop-fields">
          {MARGIN_LABELS.map(([k, label]) => (
            <label key={k}>
              {label} (mm)
              <input className="inp" inputMode="decimal" value={vals[k]} aria-label={`Lề ${label.toLowerCase()} (mm)`}
                onChange={(e) => setVals({ ...vals, [k]: e.target.value })} autoFocus={k === "l"} />
            </label>
          ))}
        </div>
      </div>
      <div className="modal-actions">
        {hasCrop && <button className="btn ghost left" onClick={() => { if (cropSelected(null)) onClose(); }}>Bỏ cắt</button>}
        <button className="btn ghost" onClick={onClose}>Huỷ</button>
        <button className="btn primary" onClick={submit}>Cắt lề</button>
      </div>
    </Dialog>
  );
}

const POSITIONS: [StampPos, string][] = [
  ["tl", "Trên trái"], ["tc", "Trên giữa"], ["tr", "Trên phải"], ["bl", "Dưới trái"], ["bc", "Dưới giữa"], ["br", "Dưới phải"],
];

/** Đánh số trang cho các trang đã chọn (không chọn gì thì cả tài liệu). Số được in vào trang khi lưu file. */
export function NumberDialog({ onClose }: { onClose: () => void }) {
  const items = useOrganizer((s) => s.items);
  const selected = useOrganizer((s) => s.selected);
  const numberPages = useOrganizer((s) => s.numberPages);
  const removeNumbers = useOrganizer((s) => s.removeNumbers);
  const [format, setFormat] = useState<NumberFormat>("n");
  const [pos, setPos] = useState<StampPos>("bc");
  const [start, setStart] = useState("1");
  const [size, setSize] = useState("11");
  const [margin, setMargin] = useState("10");
  const [error, setError] = useState<string | null>(null);
  const count = selected.size || items.length;
  const hasNumbers = items.some((p) => p.stamp && (!selected.size || selected.has(p.id)));

  const submit = () => {
    const s = Math.trunc(num(start)), sz = num(size), m = num(margin);
    if (!Number.isFinite(s) || s < 0 || s > 100000) return setError("Số bắt đầu phải là số nguyên từ 0 trở lên.");
    if (!(sz >= 4 && sz <= 72)) return setError("Cỡ chữ từ 4 đến 72 pt.");
    if (!(m >= 0 && m <= 100)) return setError("Khoảng cách tới mép từ 0 đến 100 mm.");
    numberPages({ format, start: s, pos, size: sz, marginMm: m });
    onClose();
  };

  return (
    <Dialog title="Đánh số trang" label="Đánh số trang" onClose={onClose} onSubmit={submit}>
      <p className="muted">
        Đánh số {selected.size ? `${count} trang đã chọn` : `tất cả ${count} trang`} theo thứ tự hiện tại.
        Số được in vào trang khi bạn lưu file.
      </p>
      <fieldset className="num-fieldset">
        <legend>Kiểu số</legend>
        {NUMBER_FORMATS.map(([f, label]) => (
          <label key={f} className="radio"><input type="radio" checked={format === f} onChange={() => setFormat(f)} />{label}</label>
        ))}
      </fieldset>
      <fieldset className="num-fieldset">
        <legend>Vị trí</legend>
        <div className="num-pos" role="radiogroup" aria-label="Vị trí số trang">
          {POSITIONS.map(([p, label]) => (
            <label key={p} className="radio"><input type="radio" name="numpos" checked={pos === p} onChange={() => setPos(p)} />{label}</label>
          ))}
        </div>
      </fieldset>
      <div className="num-row">
        <label>Bắt đầu từ<input className="inp" inputMode="numeric" value={start} onChange={(e) => setStart(e.target.value)} aria-label="Số bắt đầu" /></label>
        <label>Cỡ chữ (pt)<input className="inp" inputMode="decimal" value={size} onChange={(e) => setSize(e.target.value)} aria-label="Cỡ chữ" /></label>
        <label>Cách mép (mm)<input className="inp" inputMode="decimal" value={margin} onChange={(e) => setMargin(e.target.value)} aria-label="Cách mép" /></label>
      </div>
      {error && <p className="notice err" role="alert">{error}</p>}
      <div className="modal-actions">
        {hasNumbers && <button className="btn ghost left" onClick={() => { removeNumbers(); onClose(); }}>Gỡ số trang</button>}
        <button className="btn ghost" onClick={onClose}>Huỷ</button>
        <button className="btn primary" onClick={submit}>Đánh số</button>
      </div>
    </Dialog>
  );
}

/** Thay các trang đã chọn bằng trang lấy từ một file khác (PDF, ảnh, Word, Excel, PowerPoint). */
export function ReplaceDialog({ onClose }: { onClose: () => void }) {
  const n = useOrganizer((s) => s.selected.size);
  const busy = useOrganizer((s) => s.busy);
  const replaceFromFile = useOrganizer((s) => s.replaceFromFile);
  const [file, setFile] = useState<string | null>(null);
  const [range, setRange] = useState("");

  const pick = async () => {
    const p = await open({
      multiple: false,
      filters: [{ name: "Tất cả file hỗ trợ", extensions: COMBINE_EXTENSIONS }, { name: "PDF", extensions: ["pdf"] }],
    });
    if (typeof p === "string") setFile(p);
  };
  const submit = async () => { if (file && (await replaceFromFile(file, range))) onClose(); };

  return (
    <Dialog title="Thay thế trang" label="Thay thế trang" onClose={onClose} onSubmit={() => void submit()}>
      <p className="muted">Thay {n} trang đã chọn bằng các trang của một file khác, đặt đúng chỗ trang đầu tiên bị thay.</p>
      <div className="row">
        <button className="btn secondary" onClick={() => void pick()}>{file ? "Chọn file khác…" : "Chọn file…"}</button>
        <span className="hint path" title={file ?? undefined}>{file ? file.split(/[\\/]/).pop() : "Chưa chọn file"}</span>
      </div>
      <label className="num-row-label">
        Lấy trang nào của file đó
        <input className="inp wide" placeholder="Để trống = tất cả trang; hoặc ví dụ 2-4" value={range}
          onChange={(e) => setRange(e.target.value)} aria-label="Khoảng trang lấy từ file" />
      </label>
      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>Huỷ</button>
        <button className="btn primary" onClick={() => void submit()} disabled={!file || busy}>{busy ? "Đang thay…" : "Thay thế"}</button>
      </div>
    </Dialog>
  );
}
