import { cancelInstall, dismissOffice, installStageLabel, startInstall, useOffice } from "../lib/office";

/** Hỏi cài bộ chuyển đổi Office (LibreOffice) lần đầu cần dùng, rồi hiện tiến trình tải và cài. */
export function OfficeInstallDialog() {
  const phase = useOffice((s) => s.phase);
  const supported = useOffice((s) => s.supported);
  const progress = useOffice((s) => s.progress);
  const error = useOffice((s) => s.error);
  if (!phase) return null;

  const busy = phase === "installing";
  return (
    <div className="modal-backdrop over" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) dismissOffice(); }}>
      <div className="modal narrow" role="dialog" aria-modal="true" aria-labelledby="office-title"
        onKeyDown={(e) => { if (e.key === "Escape" && !busy) dismissOffice(); }}>
        <header>
          <h2 id="office-title">Cần bộ chuyển đổi Word, Excel, PowerPoint</h2>
          <button className="btn ghost icon" aria-label="Đóng" disabled={busy} onClick={dismissOffice}>✕</button>
        </header>
        <div className="modal-body">
          {phase === "ask" && supported && (
            <>
              <p>Để chuyển file Word, Excel, PowerPoint, txt và HTML sang PDF, Folioscope dùng LibreOffice, một bộ chuyển đổi miễn phí. Bộ này chưa có trên máy bạn.</p>
              <ul className="office-facts">
                <li>Tải khoảng <strong>350 MB</strong>, chiếm khoảng 1 GB trên ổ đĩa.</li>
                <li>Chỉ cài một lần, chỉ Folioscope dùng, không cần quyền quản trị.</li>
                <li>Cần kết nối Internet trong lúc tải.</li>
              </ul>
              <div className="actions">
                <button className="btn secondary" onClick={dismissOffice}>Để sau</button>
                <button className="btn primary" autoFocus onClick={() => void startInstall()}>Tải và cài đặt</button>
              </div>
            </>
          )}
          {phase === "ask" && !supported && (
            <>
              <p>Máy này chưa có LibreOffice. Hãy cài từ <strong>libreoffice.org</strong> (miễn phí), rồi bấm lại. Folioscope sẽ tự nhận ra.</p>
              <div className="actions"><button className="btn primary" autoFocus onClick={dismissOffice}>Đã hiểu</button></div>
            </>
          )}
          {busy && (
            <>
              <div className="progress" role="status">
                <div className="bar"><div style={{ width: `${progress?.percent ?? 0}%` }} className={progress?.percent == null ? "indeterminate" : ""} /></div>
                <span>{installStageLabel(progress)}{progress?.percent != null && progress.stage === "download" ? ` · ${Math.round(progress.percent)}%` : ""}</span>
              </div>
              <div className="actions"><button className="btn secondary" onClick={cancelInstall}>Huỷ</button></div>
            </>
          )}
          {phase === "error" && (
            <>
              <p role="alert" className="notice err">{error}</p>
              <div className="actions">
                <button className="btn secondary" onClick={dismissOffice}>Đóng</button>
                <button className="btn primary" onClick={() => void startInstall()}>Thử lại</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
