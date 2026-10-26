import { useState } from "react";
import { useStore } from "../store";
import { labelFor, UNITS, type Unit } from "./measure";
import { useAnnot } from "./store";
import { COLORS, STAMPS, TOOLS, hasThread, isMarkup, isMeasure, type Annotation } from "./types";

const KIND_LABEL = Object.fromEntries(TOOLS.map((t) => [t.id, t.label])) as Record<string, string>;
const when = (ms?: number) => (ms ? new Date(ms).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" }) : "");

/** Bảng "Thuộc tính" ở chế độ Ghi chú: thuộc tính của đối tượng đang chọn, hoặc danh sách bình luận. */
export function AnnotationPanel() {
  const { items, selectedId } = useAnnot();
  const selected = items.find((a) => a.id === selectedId);
  return selected ? <Properties a={selected} key={selected.id} /> : <CommentList />;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="prop-row"><span>{label}</span>{children}</label>;
}

function Properties({ a }: { a: Annotation }) {
  const { update, remove, duplicate, scale } = useAnnot.getState();
  const info = useStore((s) => s.info);
  const [reply, setReply] = useState("");
  const noStroke = a.kind === "note" || a.kind === "highlight" || a.kind === "stamp";
  const sendReply = () => { useAnnot.getState().addReply(a.id, reply); setReply(""); };

  return (
    <div className="body prop">
      <p className="prop-kind">{KIND_LABEL[a.kind]} · trang {a.page + 1}</p>
      <div className="prop-swatches" role="group" aria-label="Màu">
        {COLORS.map((c) => (
          <button key={c} className="swatch" aria-label={`Màu ${c}`} aria-pressed={a.color === c} style={{ background: c }} onClick={() => update(a.id, { color: c })} />
        ))}
      </div>
      {!noStroke && (
        <Row label={`Độ dày nét: ${a.strokeWidth}`}>
          <input type="range" min={1} max={12} value={a.strokeWidth} onChange={(e) => update(a.id, { strokeWidth: Number(e.target.value) })} />
        </Row>
      )}
      <Row label={`Độ trong suốt: ${Math.round((a.opacity ?? (a.kind === "highlight" ? 0.4 : 1)) * 100)}%`}>
        <input type="range" min={10} max={100} step={5} value={Math.round((a.opacity ?? (a.kind === "highlight" ? 0.4 : 1)) * 100)}
          onChange={(e) => update(a.id, { opacity: Number(e.target.value) / 100 })} />
      </Row>

      {a.kind === "stamp" && (
        <Row label="Nội dung tem">
          <select value={a.stamp} onChange={(e) => update(a.id, { stamp: e.target.value, color: STAMPS.find((s) => s.label === e.target.value)?.color ?? a.color })}>
            {STAMPS.map((s) => <option key={s.label}>{s.label}</option>)}
          </select>
        </Row>
      )}

      {isMeasure(a.kind) && (
        <>
          <p className="prop-measure">{a.label}</p>
          <button className="btn secondary" onClick={() => {
            const [pw, ph] = info?.page_sizes[a.page] ?? [595, 842];
            update(a.id, { label: labelFor(a, pw, ph, scale) });
          }}>Tính lại theo tỉ lệ hiện tại ({scale.ratio !== 1 ? `1:${scale.ratio} ` : ""}{scale.unit})</button>
        </>
      )}

      {(a.kind === "note" || a.kind === "text") && (
        <Row label={a.kind === "note" ? "Nội dung bình luận" : "Văn bản"}>
          <textarea rows={4} defaultValue={a.text} placeholder="Nhập nội dung…" onBlur={(e) => { if (e.target.value !== (a.text ?? "")) update(a.id, { text: e.target.value }); }} />
        </Row>
      )}

      {hasThread(a.kind) && (
        <section className="thread" aria-label="Chuỗi trả lời">
          <p className="prop-meta">{a.author ?? "Tôi"} · {when(a.at)}</p>
          <button className="btn secondary" onClick={() => update(a.id, { status: a.status === "resolved" ? "open" : "resolved" })}>
            {a.status === "resolved" ? "Mở lại bình luận" : "Đánh dấu đã giải quyết"}
          </button>
          {(a.replies ?? []).map((r) => (
            <div key={r.id} className="reply"><b>{r.author}</b> <span>{when(r.at)}</span><p>{r.text}</p></div>
          ))}
          <textarea rows={2} value={reply} placeholder="Trả lời…  (Ctrl+Enter để gửi)" onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) sendReply(); }} />
          <button className="btn primary" disabled={!reply.trim()} onClick={sendReply}>Trả lời</button>
        </section>
      )}

      {!hasThread(a.kind) && <p className="prop-meta">{a.author ?? "Tôi"} · {when(a.at)}</p>}
      <div className="prop-actions">
        <button className="btn secondary" onClick={() => duplicate(a.id)}>Nhân đôi</button>
        <button className="btn secondary danger" onClick={() => remove(a.id)}>Xoá</button>
      </div>
      {isMarkup(a.kind) && !a.rects?.length && <p className="prop-meta">Trang này không có lớp chữ (có thể là ảnh quét), nên đánh dấu dùng khung tự do.</p>}
    </div>
  );
}

type Filter = "all" | "open" | "resolved";

function CommentList() {
  const { items, author, setAuthor, select, scale, setScale } = useAnnot();
  const goToPage = useStore((s) => s.goToPage);
  const [filter, setFilter] = useState<Filter>("all");
  const notes = items.filter((a) => hasThread(a.kind)).filter((a) => filter === "all" || (a.status ?? "open") === filter)
    .sort((x, y) => x.page - y.page);

  return (
    <div className="body prop">
      <Row label="Tên hiển thị của bạn">
        <input value={author} onChange={(e) => setAuthor(e.target.value)} />
      </Row>
      <Row label="Tỉ lệ đo (đơn vị và 1:N)">
        <span className="prop-scale">
          <select value={scale.unit} onChange={(e) => setScale({ unit: e.target.value as Unit })}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select>
          <span>1 :</span>
          <input type="number" min={0.01} step="any" value={scale.ratio} onChange={(e) => setScale({ ratio: Number(e.target.value) })} />
        </span>
      </Row>
      <h3 className="prop-h">Bình luận ({notes.length})</h3>
      <div className="segmented" role="group" aria-label="Lọc bình luận">
        {([["all", "Tất cả"], ["open", "Đang mở"], ["resolved", "Đã xong"]] as const).map(([f, label]) => (
          <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{label}</button>
        ))}
      </div>
      {!notes.length && <p className="prop-meta">Chưa có bình luận. Chọn công cụ Ghi chú rồi bấm lên trang để thêm.</p>}
      <ul className="comment-list">
        {notes.map((a) => (
          <li key={a.id}>
            <button onClick={() => { goToPage(a.page); select(a.id); }}>
              <span className="c-top"><b>{a.author ?? "Tôi"}</b> · trang {a.page + 1}{a.status === "resolved" ? " · ✓" : ""}</span>
              <span className="c-text">{a.text || "(chưa có nội dung)"}</span>
              {!!a.replies?.length && <span className="c-replies">{a.replies.length} trả lời</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
