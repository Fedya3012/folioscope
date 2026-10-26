import { formatMb, installStageLabel } from "../lib/office";
import { cancelOcrInstall, dismissOcr, startOcrInstall, useOcr } from "../lib/ocr";

/** Hỏi cài Tesseract (nhận dạng chữ) lần đầu cần OCR, rồi hiện tiến trình tải và cài. */
export function OcrInstallDialog() {
  const phase = useOcr((s) => s.phase);
  const supported = useOcr((s) => s.supported);
  const progress = useOcr((s) => s.progress);
  const error = useOcr((s) => s.error);
  if (!phase) return null;

  const busy = phase === "installing";
  return (
    <div className="modal-backdrop over" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) dismissOcr(); }}>
      <div className="modal narrow" role="dialog" aria-modal="true" aria-labelledby="ocr-title"
        onKeyDown={(e) => { if (e.key === "Escape" && !busy) dismissOcr(); }}>
        <header>
          <h2 id="ocr-title">Cần bộ nhận dạng chữ (OCR)</h2>
          <button className="btn ghost icon" aria-label="Đóng" disabled={busy} onClick={dismissOcr}>✕</button>
        </header>
        <div className="modal-body">
          {phase === "ask" && supported && (
            <>
              <p>Để nhận dạng chữ trong ảnh và PDF quét, Folioscope dùng Tesseract, một bộ nhận dạng miễn phí. Bộ này chưa có trên máy bạn.</p>
              <ul className="office-facts">
                <li>Tải khoảng <strong>50 MB</strong>, cài một lần, cần kết nối Internet.</li>
                <li>Windows có thể hiện hộp xác nhận quyền quản trị khi cài. Hãy chọn Yes.</li>
                <li>Dữ liệu tiếng Việt (khoảng 1 MB) được tải riêng ở lần OCR đầu tiên.</li>
              </ul>
              <div className="actions">
                <button className="btn secondary" onClick={dismissOcr}>Để sau</button>
                <button className="btn primary" autoFocus onClick={() => void startOcrInstall()}>Tải và cài đặt</button>
              </div>
            </>
          )}
          {phase === "ask" && !supported && (
            <>
              <p>Máy này chưa có Tesseract. Hãy cài bằng <strong>brew install tesseract</strong> (macOS) hoặc <strong>apt install tesseract-ocr</strong> (Linux), rồi bấm lại. Folioscope sẽ tự nhận ra.</p>
              <div className="actions"><button className="btn primary" autoFocus onClick={dismissOcr}>Đã hiểu</button></div>
            </>
          )}
          {busy && (
            <>
              <div className="progress" role="status">
                <div className="bar"><div style={{ width: `${progress?.percent ?? 0}%` }} className={progress?.percent == null ? "indeterminate" : ""} /></div>
                <span>
                  {progress?.stage === "extract" ? "Đang cài đặt, có thể hiện hộp xác nhận quyền…" : installStageLabel(progress).replace("LibreOffice", "Tesseract")}
                  {progress?.percent != null && progress.stage === "download" ? ` · ${Math.round(progress.percent)}% (${formatMb(progress.downloaded)})` : ""}
                </span>
              </div>
              <div className="actions"><button className="btn secondary" onClick={cancelOcrInstall}>Huỷ</button></div>
            </>
          )}
          {phase === "error" && (
            <>
              <p role="alert" className="notice err">{error}</p>
              <div className="actions">
                <button className="btn secondary" onClick={dismissOcr}>Đóng</button>
                <button className="btn primary" onClick={() => void startOcrInstall()}>Thử lại</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
