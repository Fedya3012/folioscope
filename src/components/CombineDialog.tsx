import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import {
  cancelCombine, combineFiles, officeStatus, pickFilesToCombine, probeFiles, shellMenuInstall, shellMenuStatus,
  shellMenuUninstall, type CombineProgress, type CombineResult, type CompressionLevel, type MenuStatus,
} from "../lib/api";
import { ensureOffice } from "../lib/office";
import {
  appendUnique, applyProbe, blocked, COMPRESSION_LABELS, dirOf, formatBytes, moveItem, needsOffice, progressLabel, sanitizeFileName,
  suggestOutput, totalPages, type Item,
} from "../lib/combine";

type Phase = "edit" | "running" | "done";

const KIND_LABEL = { pdf: "PDF", image: "Ảnh → PDF", office: "Chuyển sang PDF", unsupported: "Không hỗ trợ" } as const;

/** Hộp thoại "Gộp file": sắp xếp, dấu trang, nén, tên file kết quả, tiến trình. */
export function CombineDialog({ initial, onClose, onOpenResult, onOpenInOrganizer }: {
  initial: string[]; onClose: () => void; onOpenResult: (path: string) => void;
  /** Mở các file (theo thứ tự đang xếp) trong Page Organizer để chỉnh từng trang trước khi gộp. */
  onOpenInOrganizer?: (paths: string[]) => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [bookmarks, setBookmarks] = useState(true);
  const [keepBookmarks, setKeepBookmarks] = useState(false);
  const [normalizeA4, setNormalizeA4] = useState(false);
  const [pwDraft, setPwDraft] = useState<Record<number, string>>({});
  const [compression, setCompression] = useState<CompressionLevel>("balanced");
  const [dir, setDir] = useState("");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [phase, setPhase] = useState<Phase>("edit");
  const [progress, setProgress] = useState<CombineProgress | null>(null);
  const [result, setResult] = useState<CombineResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [office, setOffice] = useState<string | null | undefined>(undefined);
  const [menu, setMenu] = useState<MenuStatus | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const list = useRef<HTMLOListElement>(null);

  const add = useCallback(async (paths: string[]) => {
    if (!paths.length) return;
    try {
      const probes = await probeFiles(paths);
      setItems((cur) => appendUnique(cur, probes));
    } catch (e) { setError(String(e)); }
  }, []);

  // Nạp file ban đầu (từ menu chuột phải hoặc nút Gộp file) và thông tin môi trường.
  useEffect(() => {
    void add(initial);
    officeStatus().then(setOffice).catch(() => setOffice(null));
    shellMenuStatus().then(setMenu).catch(() => setMenu(null));
  }, [add, initial]);

  // Tên kết quả tự theo file đầu tiên cho đến khi người dùng tự gõ.
  useEffect(() => {
    if (nameTouched || !items.length) return;
    const full = suggestOutput(items);
    const d = dirOf(full);
    setDir(d);
    setName(full.slice(d.length));
  }, [items, nameTouched]);

  useEffect(() => {
    const subs = [
      listen<CombineProgress>("combine-progress", (e) => setProgress(e.payload)),
      // Kéo thả file từ Explorer vào cửa sổ để thêm vào danh sách.
      getCurrentWebview().onDragDropEvent((e) => { if (e.payload.type === "drop") void add(e.payload.paths); }),
    ];
    return () => { subs.forEach((p) => void p.then((un) => un())); };
  }, [add]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && phase !== "running") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, onClose]);

  const problems = blocked(items);
  const willAskOffice = needsOffice(items) && office === null;
  const fileName = sanitizeFileName(name);
  const sep = dir.includes("\\") ? "\\" : "/";
  const output = `${dir}${dir && !/[\\/]$/.test(dir) ? sep : ""}${fileName}`;
  const canRun = phase === "edit" && items.length > 0 && !problems.length && !!dir;

  /** Nhập mật khẩu cho một hàng: đọc lại file; đúng thì hàng hết lỗi và nhớ mật khẩu để gộp. */
  const unlock = async (it: Item) => {
    const pw = pwDraft[it.id] ?? "";
    if (!pw) return;
    try {
      const [probe] = await probeFiles([it.path], pw);
      if (probe) setItems((cur) => applyProbe(cur, it.id, probe, pw));
      if (probe?.error) setPwDraft((d) => ({ ...d, [it.id]: "" }));
    } catch (e) { setError(String(e)); }
  };

  const run = async () => {
    setError(null);
    // Lần đầu có Word/Excel/PowerPoint mà máy chưa có bộ chuyển đổi: hỏi cài rồi mới chạy.
    if (needsOffice(items)) {
      if (!(await ensureOffice())) { setError("Chưa có bộ chuyển đổi Word, Excel, PowerPoint. Bỏ các file đó ra hoặc cài bộ chuyển đổi rồi gộp lại."); return; }
      officeStatus().then(setOffice).catch(() => {});
    }
    setPhase("running"); setProgress(null);
    try {
      setResult(await combineFiles({
        files: items.map((i) => ({ path: i.path, title: bookmarks ? i.title : "", password: i.password ?? null })),
        output, bookmarks, keep_bookmarks: keepBookmarks, normalize_a4: normalizeA4, compression,
      }));
      setPhase("done");
    } catch (e) {
      setError(String(e)); setPhase("edit");
    }
  };

  const reorderTo = (from: number, y: number) => {
    const rows = [...(list.current?.children ?? [])] as HTMLElement[];
    const to = rows.findIndex((r) => { const b = r.getBoundingClientRect(); return y >= b.top && y <= b.bottom; });
    if (to >= 0 && to !== from) { setItems((cur) => moveItem(cur, from, to)); setDragFrom(to); }
  };

  const toggleMenu = async () => {
    try {
      if (menu?.installed) await shellMenuUninstall(); else await shellMenuInstall();
      setMenu(await shellMenuStatus());
    } catch (e) { setError(String(e)); }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && phase !== "running") onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="combine-title">
        <header>
          <h2 id="combine-title">Gộp file thành một PDF</h2>
          <button className="btn ghost icon" aria-label="Đóng" disabled={phase === "running"} onClick={onClose}>✕</button>
        </header>

        {phase === "done" && result ? (
          <div className="modal-body done">
            <p className="ok">✓ Đã gộp xong</p>
            <p>{result.pages} trang · {formatBytes(result.bytes)}{result.converted ? ` · ${result.converted} file đã được chuyển sang PDF` : ""}</p>
            <p className="path">{result.output}</p>
            <div className="actions">
              <button className="btn primary" onClick={() => { onOpenResult(result.output); onClose(); }}>Mở file kết quả</button>
              <button className="btn secondary" onClick={onClose}>Đóng</button>
            </div>
          </div>
        ) : (
          <div className="modal-body">
            <div className="row">
              <button className="btn secondary" disabled={phase === "running"} onClick={async () => add(await pickFilesToCombine())}>Thêm file…</button>
              <span className="hint">{items.length ? `${items.length} file${totalPages(items) ? ` · ${totalPages(items)} trang PDF` : ""} · kéo thả thêm file vào cửa sổ` : "hoặc kéo thả file vào cửa sổ"}</span>
            </div>

            {items.length === 0 ? (
              <div className="drop-empty">Chưa có file nào. Hỗ trợ PDF, Word, Excel, PowerPoint, ảnh, txt, HTML.</div>
            ) : (
              <ol className="file-list" ref={list} aria-label="Thứ tự gộp">
                {items.map((it, i) => (
                  <li key={it.id} className={dragFrom === i ? "dragging" : ""} data-error={!!it.error}>
                    <span
                      className="handle" role="button" tabIndex={-1} aria-label="Kéo để đổi thứ tự" title="Kéo để đổi thứ tự"
                      onPointerDown={(e) => { if (phase === "running") return; e.currentTarget.setPointerCapture(e.pointerId); setDragFrom(i); }}
                      onPointerMove={(e) => { if (dragFrom !== null) reorderTo(dragFrom, e.clientY); }}
                      onPointerUp={() => setDragFrom(null)}
                    >⋮⋮</span>
                    <span className="num">{i + 1}</span>
                    <div className="meta">
                      <strong title={it.path}>{it.name}</strong>
                      <small>
                        {it.error ? <span className="err">{it.error}</span> : <>{KIND_LABEL[it.kind]}{it.pages ? ` · ${it.pages} trang` : ""} · {formatBytes(it.size)}</>}
                      </small>
                    </div>
                    {it.needs_password ? (
                      <span className="pw">
                        <input type="password" autoComplete="off" aria-label={`Mật khẩu của ${it.name}`} placeholder="Mật khẩu của file này"
                          value={pwDraft[it.id] ?? ""} disabled={phase === "running"}
                          onChange={(e) => setPwDraft((d) => ({ ...d, [it.id]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === "Enter") void unlock(it); }} />
                        <button className="btn secondary" disabled={!(pwDraft[it.id] ?? "") || phase === "running"} onClick={() => void unlock(it)}>Mở khoá</button>
                      </span>
                    ) : bookmarks && (
                      <input className="title" aria-label={`Tên dấu trang của ${it.name}`} value={it.title} disabled={phase === "running"}
                        onChange={(e) => setItems((cur) => cur.map((x) => x.id === it.id ? { ...x, title: e.target.value } : x))} />
                    )}
                    <span className="ctl">
                      <button className="btn ghost icon" aria-label="Lên" disabled={i === 0 || phase === "running"} onClick={() => setItems((c) => moveItem(c, i, i - 1))}>↑</button>
                      <button className="btn ghost icon" aria-label="Xuống" disabled={i === items.length - 1 || phase === "running"} onClick={() => setItems((c) => moveItem(c, i, i + 1))}>↓</button>
                      <button className="btn ghost icon" aria-label={`Bỏ ${it.name}`} disabled={phase === "running"} onClick={() => setItems((c) => c.filter((x) => x.id !== it.id))}>✕</button>
                    </span>
                  </li>
                ))}
              </ol>
            )}

            {willAskOffice && (
              <p className="notice warn">Có file Word, Excel, PowerPoint, txt hoặc HTML. Để chuyển chúng sang PDF, Folioscope cần bộ chuyển đổi (LibreOffice, miễn phí). Khi bạn bấm Gộp file, app sẽ hỏi có cài không (khoảng 350 MB, chỉ cài một lần).</p>
            )}

            <fieldset disabled={phase === "running"}>
              <legend>Tuỳ chọn</legend>
              <label className="check"><input type="checkbox" checked={bookmarks} onChange={(e) => setBookmarks(e.target.checked)} /> Tạo dấu trang cho mỗi file (sửa tên ngay trong danh sách)</label>
              <label className="check"><input type="checkbox" checked={keepBookmarks} onChange={(e) => setKeepBookmarks(e.target.checked)} /> Giữ dấu trang gốc của từng file PDF (nằm dưới dấu trang của file đó; file có mật khẩu không giữ được)</label>
              <label className="check"><input type="checkbox" checked={normalizeA4} onChange={(e) => setNormalizeA4(e.target.checked)} /> Chuẩn hoá khổ giấy về A4 (co vừa, giữ tỉ lệ, trang ngang dùng A4 ngang)</label>
              <div className="seg-radio" role="radiogroup" aria-label="Mức nén">
                {(Object.keys(COMPRESSION_LABELS) as CompressionLevel[]).map((k) => (
                  <label key={k} data-on={compression === k}>
                    <input type="radio" name="compression" checked={compression === k} onChange={() => setCompression(k)} />
                    <strong>{COMPRESSION_LABELS[k][0]}</strong><small>{COMPRESSION_LABELS[k][1]}</small>
                  </label>
                ))}
              </div>
              <div className="row out">
                <label htmlFor="out-name">Tên file kết quả</label>
                <input id="out-name" value={name} onChange={(e) => { setName(e.target.value); setNameTouched(true); }} onBlur={() => setName(sanitizeFileName(name))} />
                <button className="btn secondary" onClick={async () => {
                  const d = await open({ directory: true, defaultPath: dir || undefined });
                  if (typeof d === "string") { setDir(d); setNameTouched(true); }
                }}>Chọn thư mục…</button>
              </div>
              <p className="hint path" title={output}>Lưu tại: {dir ? output : "—"}</p>
            </fieldset>

            {phase === "running" && (
              <div className="progress" role="status">
                <div className="bar"><div style={{ width: `${progress?.percent ?? 0}%` }} /></div>
                <span>{progress ? progressLabel(progress) : "Đang bắt đầu…"} · {Math.round(progress?.percent ?? 0)}%</span>
              </div>
            )}
            {error && <p className="notice err" role="alert">{error}</p>}
            {menu?.supported && (
              <p className="hint">Menu chuột phải “Combine files in Folioscope…”: {menu.installed ? "đang bật" : "đang tắt"} · <button className="link" onClick={toggleMenu}>{menu.installed ? "Gỡ" : "Cài vào Explorer"}</button></p>
            )}

            <footer>
              {onOpenInOrganizer && (
                <button className="btn ghost left" disabled={phase === "running" || !items.length || problems.length > 0}
                  title="Sắp xếp, xoay, xoá từng trang trước khi gộp"
                  onClick={() => { onOpenInOrganizer(items.map((i) => i.path)); onClose(); }}>Mở trong Page Organizer</button>
              )}
              {phase === "running"
                ? <button className="btn secondary" onClick={() => void cancelCombine()}>Huỷ</button>
                : <button className="btn secondary" onClick={onClose}>Đóng</button>}
              <button className="btn primary" disabled={!canRun} onClick={run}>{phase === "running" ? "Đang gộp…" : "Gộp file"}</button>
            </footer>
          </div>
        )}
      </div>
    </div>
  );
}
