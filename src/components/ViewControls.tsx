import { useEffect, useRef, useState } from "react";
import { ZOOM_PRESETS, zoomChoice } from "../lib/viewer";
import { useStore } from "../store";
import { GOTO_INPUT_ID } from "../appCommands";

/** Thời gian không đụng chuột thì thanh mờ đi (ms), theo thiết kế: 2 giây. */
const IDLE_MS = 2000;

/** Thanh điều khiển nổi ở góc dưới phải trang: trang trước/sau, zoom, công cụ tay và chọn chữ. */
export function ViewControls() {
  const s = useStore();
  const [idle, setIdle] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const wake = () => {
    setIdle(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setIdle(true), IDLE_MS);
  };
  useEffect(() => {
    wake();
    return () => clearTimeout(timer.current);
  }, []);

  if (!s.info) return null;
  const last = s.info.page_count - 1;
  const choice = zoomChoice(s.zoom, s.fit);
  const onZoomChoice = (v: string) => {
    if (v === "width" || v === "page") s.setFit(v);
    else if (v !== "custom") s.setZoom(Number(v));
  };

  return (
    <div className={`view-controls${idle ? " idle" : ""}`} role="toolbar" aria-label="Điều khiển xem trang"
      onPointerEnter={wake} onPointerMove={wake} onFocus={wake}>
      <button className="btn ghost icon" aria-label="Trang trước" disabled={s.currentPage === 0} onClick={() => s.goToPage(s.currentPage - 1)}>↑</button>
      <button className="btn ghost icon" aria-label="Trang sau" disabled={s.currentPage >= last} onClick={() => s.goToPage(s.currentPage + 1)}>↓</button>
      <span className="vc-pages">
        <input id={GOTO_INPUT_ID} aria-label="Đi tới trang" inputMode="numeric" key={s.currentPage} defaultValue={s.currentPage + 1}
          style={{ width: "3ch", textAlign: "right", background: "transparent", border: "none", color: "inherit", font: "inherit" }}
          onKeyDown={(e) => {
            if (e.key === "Escape") (e.target as HTMLInputElement).blur();
            if (e.key !== "Enter") return;
            const n = parseInt((e.target as HTMLInputElement).value, 10);
            if (Number.isFinite(n)) s.goToPage(Math.max(0, Math.min(last, n - 1)));
            (e.target as HTMLInputElement).blur();
          }} /> / {s.info.page_count}
      </span>
      <span className="vc-sep" />
      <button className="btn ghost icon" aria-label="Thu nhỏ" onClick={() => s.zoomBy(-1)}>−</button>
      <select aria-label="Mức zoom" value={choice} onChange={(e) => onZoomChoice(e.target.value)}>
        <option value="page">Vừa trang</option>
        <option value="width">Vừa bề rộng</option>
        {choice === "custom" && <option value="custom">{Math.round(s.zoom * 100)}%</option>}
        {ZOOM_PRESETS.map((p) => <option key={p} value={String(p)}>{Math.round(p * 100)}%</option>)}
      </select>
      <button className="btn ghost icon" aria-label="Phóng to" onClick={() => s.zoomBy(1)}>+</button>
      <span className="vc-sep" />
      <button className="btn ghost icon" aria-label="Chọn chữ" title="Chọn chữ" aria-pressed={s.tool === "select"} onClick={() => s.setTool("select")}>I</button>
      <button className="btn ghost icon" aria-label="Bàn tay" title="Bàn tay" aria-pressed={s.tool === "hand"} onClick={() => s.setTool("hand")}>✋</button>
    </div>
  );
}
