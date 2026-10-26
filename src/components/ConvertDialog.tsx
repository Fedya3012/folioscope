import { useCallback, useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { convertCancel, convertRun, type ConvertItemResult, type ConvertProgress, type ConvertTarget } from "../lib/api";
import {
  baseName, DPI_CHOICES, dirOf, GROUP_LABEL, needsInstall, needsOcr, needsOffice, OCR_LANGS, splitByTarget, summarize, TARGETS,
  targetInfo,
} from "../lib/convert";
import { ensureOffice } from "../lib/office";
import { ensureOcr } from "../lib/ocr";

type Phase = "edit" | "running" | "done";

/** Màn hình "Chuyển đổi": sang PDF (kể cả PDF/A), từ PDF sang Word/Excel/PowerPoint/ảnh/văn bản/HTML, và OCR. */
export function ConvertDialog({ initial, initialTarget, onClose, onOpenResult }: {
  initial: string[]; initialTarget: ConvertTarget; onClose: () => void; onOpenResult: (path: string) => void;
}) {
  const [target, setTarget] = useState<ConvertTarget>(initialTarget);
  const [files, setFiles] = useState<string[]>(initial);
  const [pdfa, setPdfa] = useState(false);
  const [lang, setLang] = useState("vie+eng");
  const [dpi, setDpi] = useState(200);
  const [dir, setDir] = useState("");
  const [dirTouched, setDirTouched] = useState(false);
  const [phase, setPhase] = useState<Phase>("edit");
  const [progress, setProgress] = useState<ConvertProgress | null>(null);
  const [results, setResults] = useState<ConvertItemResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const add = useCallback((paths: string[]) => {
    setFiles((cur) => [...cur, ...paths.filter((p) => !cur.includes(p))]);
  }, []);

  // Thư mục lưu mặc định: cạnh file đầu tiên, cho đến khi người dùng tự chọn.
  useEffect(() => { if (!dirTouched && files[0]) setDir(dirOf(files[0])); }, [files, dirTouched]);

  useEffect(() => {
    const subs = [
      listen<ConvertProgress>("convert-progress", (e) => setProgress(e.payload)),
      getCurrentWebview().onDragDropEvent((e) => { if (e.payload.type === "drop") add(e.payload.paths); }),
    ];
    return () => { subs.forEach((p) => void p.then((un) => un()).catch(() => {})); };
  }, [add]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && phase !== "running") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, onClose]);

  const info = targetInfo(target);
  const { ok, rejected } = useMemo(() => splitByTarget(target, pdfa, files), [target, pdfa, files]);
  const canRun = phase === "edit" && ok.length > 0 && rejected.length === 0 && !!dir;
  const summary = summarize(results);

  const pick = async () => {
    const exts = info.ext;
    const picked = await open({ multiple: true, filters: [{ name: info.label, extensions: exts }] });
    if (Array.isArray(picked)) add(picked);
  };

  const run = async () => {
    setError(null);
    if (needsOffice(target, pdfa, ok) && !(await ensureOffice())) {
      setError("Chưa có bộ chuyển đổi Word, Excel, PowerPoint (LibreOffice), nên chưa chuyển được."); return;
    }
    if (needsOcr(target) && !(await ensureOcr())) {
      setError("Chưa có bộ nhận dạng chữ (Tesseract), nên chưa OCR được."); return;
    }
    setPhase("running"); setProgress(null);
    try {
      setResults(await convertRun({ files: ok, out_dir: dir, target, pdfa, lang, dpi }));
      setPhase("done");
    } catch (e) {
      const msg = String(e);
      setError(needsInstall(msg, "OFFICE_MISSING") ? "Chưa có bộ chuyển đổi LibreOffice." : needsInstall(msg, "OCR_MISSING") ? "Chưa có bộ nhận dạng Tesseract." : msg);
      setPhase("edit");
    }
  };

  const groups = (["to_pdf", "from_pdf", "ocr"] as const).map((g) => ({ g, items: TARGETS.filter((t) => t.group === g) }));

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && phase !== "running") onClose(); }}>
      <div className="modal convert" role="dialog" aria-modal="true" aria-labelledby="convert-title">
        <header>
          <h2 id="convert-title">Chuyển đổi và OCR</h2>
          <button className="btn ghost icon" aria-label="Đóng" disabled={phase === "running"} onClick={onClose}>✕</button>
        </header>

        {phase === "done" ? (
          <div className="modal-body done">
            <p className={summary.failed ? "notice warn" : "ok"}>
              {summary.failed ? `Xong ${summary.done} file, ${summary.failed} file lỗi` : `✓ Đã xong ${summary.done} file`}
            </p>
            <ul className="convert-results">
              {results.map((r) => (
                <li key={r.input} data-error={!!r.error}>
                  <strong>{baseName(r.input)}</strong>
                  {r.error ? <span className="err">{r.error}</span> : r.outputs.map((o) => (
                    <span key={o} className="path" title={o}>
                      {r.outputs.length > 1 ? baseName(o) : o}
                      {o.toLowerCase().endsWith(".pdf") && <button className="link" onClick={() => { onOpenResult(o); onClose(); }}>Mở</button>}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
            <div className="actions">
              <button className="btn secondary" onClick={() => { setPhase("edit"); setResults([]); setFiles([]); setDirTouched(false); }}>Chuyển file khác</button>
              <button className="btn primary" onClick={onClose}>Đóng</button>
            </div>
          </div>
        ) : (
          <div className="modal-body">
            <div className="convert-cols">
              <div className="convert-targets" role="radiogroup" aria-label="Kiểu chuyển đổi">
                {groups.map(({ g, items }) => (
                  <div key={g}>
                    <h3>{GROUP_LABEL[g]}</h3>
                    {items.map((t) => (
                      <label key={t.id} className="convert-target" data-on={target === t.id}>
                        <input type="radio" name="convert-target" checked={target === t.id} disabled={phase === "running"} onChange={() => setTarget(t.id)} />
                        <span><strong>{t.label}</strong><small>{t.desc}</small></span>
                      </label>
                    ))}
                  </div>
                ))}
              </div>

              <div className="convert-main">
                <div className="row">
                  <button className="btn secondary" disabled={phase === "running"} onClick={() => void pick()}>Thêm file…</button>
                  <span className="hint">{files.length ? `${files.length} file · kéo thả thêm file vào cửa sổ` : "hoặc kéo thả file vào cửa sổ"}</span>
                </div>
                {files.length === 0 ? (
                  <div className="drop-empty">Chưa có file nào. {target === "to_pdf" ? "Chọn Word, Excel, PowerPoint, ảnh, txt hoặc HTML." : target === "ocr" ? "Chọn ảnh hoặc PDF quét." : "Chọn file PDF."}</div>
                ) : (
                  <ul className="convert-files" aria-label="File sẽ chuyển">
                    {files.map((p) => (
                      <li key={p} data-error={rejected.includes(p)}>
                        <span className="meta">
                          <strong title={p}>{baseName(p)}</strong>
                          {rejected.includes(p) && <small className="err">Không dùng được cho kiểu “{info.label}”. Hãy bỏ file này.</small>}
                        </span>
                        <button className="btn ghost icon" aria-label={`Bỏ ${baseName(p)}`} disabled={phase === "running"} onClick={() => setFiles((c) => c.filter((x) => x !== p))}>✕</button>
                      </li>
                    ))}
                  </ul>
                )}

                <fieldset disabled={phase === "running"}>
                  <legend>Tuỳ chọn</legend>
                  {target === "to_pdf" && (
                    <label className="check"><input type="checkbox" checked={pdfa} onChange={(e) => setPdfa(e.target.checked)} /> Xuất PDF/A (để lưu trữ lâu dài). PDF có sẵn sẽ được dựng lại nên bố cục có thể lệch nhẹ.</label>
                  )}
                  {target === "ocr" && (
                    <label className="row">Ngôn ngữ trong ảnh
                      <select value={lang} onChange={(e) => setLang(e.target.value)}>
                        {OCR_LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                      </select>
                    </label>
                  )}
                  {(target === "png" || target === "jpg") && (
                    <label className="row">Độ nét
                      <select value={dpi} onChange={(e) => setDpi(Number(e.target.value))}>
                        {DPI_CHOICES.map((d) => <option key={d} value={d}>{d} dpi{d === 200 ? " (khuyên dùng)" : ""}</option>)}
                      </select>
                    </label>
                  )}
                  {target === "xlsx" && <p className="hint">PDF không lưu đường kẻ ô, nên app đoán ô theo vị trí chữ. Bảng đơn giản chuyển tốt hơn bảng gộp ô.</p>}
                  {(target === "docx" || target === "pptx") && <p className="hint">Bản chuyển từ PDF thường lệch bố cục ở trang phức tạp (cột, bảng, công thức). Hãy kiểm tra lại kết quả.</p>}
                  {target === "ocr" && <p className="hint">Kết quả là PDF mới tên “… -ocr.pdf”, giữ nguyên file gốc. Trang được dựng lại ở 300 dpi nên file có thể nặng hơn bản gốc.</p>}
                  <div className="row out">
                    <label htmlFor="convert-dir">Lưu vào thư mục</label>
                    <input id="convert-dir" value={dir} onChange={(e) => { setDir(e.target.value); setDirTouched(true); }} />
                    <button className="btn secondary" onClick={async () => {
                      const d = await open({ directory: true, defaultPath: dir || undefined });
                      if (typeof d === "string") { setDir(d); setDirTouched(true); }
                    }}>Chọn thư mục…</button>
                  </div>
                </fieldset>
              </div>
            </div>

            {phase === "running" && (
              <div className="progress" role="status">
                <div className="bar"><div style={{ width: `${progress?.percent ?? 0}%` }} /></div>
                <span>
                  {progress?.file ? `${progress.file} (${Math.min(progress.current + 1, progress.total)}/${progress.total})` : "Đang bắt đầu…"}
                  {progress?.detail ? ` · ${progress.detail}` : ""} · {Math.round(progress?.percent ?? 0)}%
                </span>
              </div>
            )}
            {error && <p className="notice err" role="alert">{error}</p>}

            <footer>
              {phase === "running"
                ? <button className="btn secondary" onClick={() => void convertCancel()}>Huỷ</button>
                : <button className="btn secondary" onClick={onClose}>Đóng</button>}
              <button className="btn primary" disabled={!canRun} onClick={() => void run()}>{phase === "running" ? "Đang chuyển…" : target === "ocr" ? "Bắt đầu OCR" : "Chuyển đổi"}</button>
            </footer>
          </div>
        )}
      </div>
    </div>
  );
}
