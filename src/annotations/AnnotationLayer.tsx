import { useEffect, useRef, useState, type PointerEvent as RPE } from "react";
import { createPortal } from "react-dom";
import { registerCommands } from "../lib/shortcuts";
import { useStore } from "../store";
import { bounds, clamp01, rectFrom, resizeTo, simplify, translate } from "./geometry";
import { useAnnot, newId } from "./store";
import { FloatingToolbar } from "./FloatingToolbar";
import type { Annotation, Pt } from "./types";

/** Tìm các khung trang do Viewer vẽ (không sửa Viewer): mỗi trang là phần tử `.page[data-page]`. */
function usePageElements(root: HTMLElement | null) {
  const [pages, setPages] = useState<HTMLElement[]>([]);
  useEffect(() => {
    if (!root) return;
    const scan = () => setPages(Array.from(root.querySelectorAll<HTMLElement>(".page[data-page]")));
    scan();
    const mo = new MutationObserver(scan);
    mo.observe(root, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [root]);
  return pages;
}

export function AnnotationLayer() {
  const { mode, path } = useStore();
  const [root, setRoot] = useState<HTMLElement | null>(null);
  useEffect(() => { setRoot(document.querySelector<HTMLElement>(".canvas")); }, [path]);
  const pages = usePageElements(root);

  // Chú thích theo từng tài liệu: store tab (store.ts) cất/nạp lại khi chuyển tab, và xoá khi mở tài liệu mới.

  // Phím của chế độ Ghi chú đăng ký vào hệ phím tắt chung (Ctrl+Z/Y do hệ hoàn tác toàn cục lo).
  useEffect(() => {
    if (mode !== "annotate") return;
    return registerCommands([
      {
        id: "annotate.delete", label: "Xoá ghi chú đang chọn", group: "Ghi chú", keys: ["Delete", "Backspace"],
        run: () => { const a = useAnnot.getState(); if (!a.selectedId) return false; a.remove(a.selectedId); },
      },
      { id: "annotate.escape", label: "Bỏ chọn ghi chú", group: "Ghi chú", keys: ["Escape"], run: () => { const a = useAnnot.getState(); a.select(null); a.setTool("select"); return false; } },
    ]);
  }, [mode]);

  if (mode !== "annotate" && mode !== "view" && mode !== "edit") return null;
  return <>{pages.map((el) => createPortal(<PageOverlay index={Number(el.dataset.page)} el={el} />, el, `p${el.dataset.page}`))}</>;
}

function PageOverlay({ index, el }: { index: number; el: HTMLElement }) {
  const mode = useStore((s) => s.mode);
  const interactive = mode === "annotate";
  const items = useAnnot((s) => s.items).filter((a) => a.page === index);
  const [size, setSize] = useState({ w: el.offsetWidth, h: el.offsetHeight });
  const [draft, setDraft] = useState<Annotation | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<null | { id: string; last: Pt; mode: "move" | "resize" }>(null);
  const start = useRef<Pt | null>(null);

  useEffect(() => {
    const ro = new ResizeObserver(() => setSize({ w: el.offsetWidth, h: el.offsetHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);

  const pt = (e: { clientX: number; clientY: number }): Pt => {
    const r = svg.current!.getBoundingClientRect();
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) };
  };

  const down = (e: RPE<SVGSVGElement>) => {
    if (!interactive || e.button !== 0) return;
    const st = useAnnot.getState();
    if (st.tool === "select") { st.select(null); return; }
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = pt(e);
    start.current = p;
    const base = { id: newId(), page: index, kind: st.tool, color: st.color, strokeWidth: st.strokeWidth } as Annotation;
    if (st.tool === "note") {
      st.add({ ...base, rect: { x: p.x, y: p.y, w: 0, h: 0 }, text: "" });
      st.edit(base.id); start.current = null; return;
    }
    if (st.tool === "ink") setDraft({ ...base, points: [p] });
    else if (st.tool === "line" || st.tool === "arrow") setDraft({ ...base, points: [p, p] });
    else setDraft({ ...base, rect: { x: p.x, y: p.y, w: 0, h: 0 } });
  };

  const move = (e: RPE<SVGSVGElement>) => {
    const p = pt(e);
    const st = useAnnot.getState();
    if (drag.current) {
      const d = drag.current;
      const cur = st.items.find((a) => a.id === d.id);
      if (!cur) return;
      const next = d.mode === "move" ? translate(cur, p.x - d.last.x, p.y - d.last.y) : resizeTo(cur, p);
      st.patch(d.id, { rect: next.rect, points: next.points });
      d.last = p;
      return;
    }
    if (!draft || !start.current) return;
    if (draft.kind === "ink") setDraft({ ...draft, points: [...draft.points!, p] });
    else if (draft.points) setDraft({ ...draft, points: [start.current, p] });
    else setDraft({ ...draft, rect: rectFrom(start.current, p) });
  };

  const up = () => {
    drag.current = null;
    if (!draft) return;
    const d = draft;
    setDraft(null); start.current = null;
    const b = bounds(d);
    if (b.w < 0.004 && b.h < 0.004) return; // chỉ bấm chứ không kéo
    const st = useAnnot.getState();
    if (d.kind === "ink") d.points = simplify(d.points!);
    // Gạch chân / gạch ngang chỉ cần chiều rộng, giữ chiều cao dòng.
    if (d.kind === "text") d.text = "";
    st.add(d);
    if (d.kind === "text") st.edit(d.id);
  };

  const grab = (a: Annotation, mode: "move" | "resize") => (e: RPE) => {
    if (!interactive || useAnnot.getState().tool !== "select") return;
    e.stopPropagation();
    svg.current!.setPointerCapture(e.pointerId);
    const st = useAnnot.getState();
    st.select(a.id);
    st.checkpoint();
    drag.current = { id: a.id, last: pt(e), mode };
  };

  const sel = useAnnot((s) => s.selectedId);
  const selected = items.find((a) => a.id === sel);

  return (
    <div className="annot-root" style={{ pointerEvents: interactive ? "auto" : "none" }}>
      <svg
        ref={svg} width={size.w} height={size.h}
        className={`annot-svg tool-${interactive ? useAnnot.getState().tool : "none"}`}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      >
        {items.map((a) => (
          <Shape key={a.id} a={a} w={size.w} h={size.h} selected={a.id === sel}
            onGrab={grab(a, "move")} onResize={grab(a, "resize")} />
        ))}
        {draft && <Shape a={draft} w={size.w} h={size.h} selected={false} />}
      </svg>
      {interactive && selected && <FloatingToolbar a={selected} />}
    </div>
  );
}

function Shape({ a, w, h, selected, onGrab, onResize }: {
  a: Annotation; w: number; h: number; selected: boolean;
  onGrab?: (e: RPE) => void; onResize?: (e: RPE) => void;
}) {
  const zoom = useStore((s) => s.zoom);
  const editing = useAnnot((s) => s.editingId === a.id);
  const sw = a.strokeWidth * zoom;
  const X = (v: number) => v * w, Y = (v: number) => v * h;
  const r = a.rect;
  const common = { onPointerDown: onGrab, style: { cursor: onGrab ? "move" : undefined } };
  let body: React.ReactNode = null;

  switch (a.kind) {
    case "highlight":
      body = r && <rect x={X(r.x)} y={Y(r.y)} width={X(r.w)} height={Y(r.h)} fill={a.color} opacity={0.4} style={{ mixBlendMode: "multiply" }} />;
      break;
    case "underline":
      body = r && <line x1={X(r.x)} x2={X(r.x + r.w)} y1={Y(r.y + r.h)} y2={Y(r.y + r.h)} stroke={a.color} strokeWidth={Math.max(1.5, sw)} />;
      break;
    case "strikeout":
      body = r && <line x1={X(r.x)} x2={X(r.x + r.w)} y1={Y(r.y + r.h / 2)} y2={Y(r.y + r.h / 2)} stroke={a.color} strokeWidth={Math.max(1.5, sw)} />;
      break;
    case "rect":
      body = r && <rect x={X(r.x)} y={Y(r.y)} width={X(r.w)} height={Y(r.h)} fill="none" stroke={a.color} strokeWidth={sw} />;
      break;
    case "ellipse":
      body = r && <ellipse cx={X(r.x + r.w / 2)} cy={Y(r.y + r.h / 2)} rx={X(r.w / 2)} ry={Y(r.h / 2)} fill="none" stroke={a.color} strokeWidth={sw} />;
      break;
    case "line": case "arrow": case "ink": {
      const pts = (a.points ?? []).map((p) => `${X(p.x)},${Y(p.y)}`).join(" ");
      body = <>
        <polyline points={pts} fill="none" stroke={a.color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
        {a.kind === "arrow" && a.points && <ArrowHead p={a.points} w={w} h={h} color={a.color} size={10 * zoom + sw * 2} />}
      </>;
      break;
    }
    case "note":
      body = r && (
        <g transform={`translate(${X(r.x)},${Y(r.y)})`}>
          <path d="M0 0h20a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2h-9l-5 5v-5H0z" fill={a.color} stroke="#14171C" strokeOpacity=".35" />
        </g>
      );
      break;
    case "text":
      body = r && (
        <rect x={X(r.x)} y={Y(r.y)} width={X(r.w)} height={Y(r.h)} fill="rgba(255,255,255,.01)" stroke={a.color} strokeWidth={1} strokeDasharray={a.text ? undefined : "4 3"} />
      );
      break;
  }

  const box = bounds(a);
  const pad = 4;

  return (
    <g {...common} data-kind={a.kind}>
      {a.points && <polyline points={a.points.map((p) => `${X(p.x)},${Y(p.y)}`).join(" ")} fill="none" stroke="transparent" strokeWidth={Math.max(14, sw + 10)} />}
      {a.kind === "rect" && r && <rect x={X(r.x)} y={Y(r.y)} width={X(r.w)} height={Y(r.h)} fill="none" stroke="transparent" strokeWidth={Math.max(14, sw + 10)} pointerEvents="stroke" />}
      {a.kind === "ellipse" && r && <ellipse cx={X(r.x + r.w / 2)} cy={Y(r.y + r.h / 2)} rx={X(r.w / 2)} ry={Y(r.h / 2)} fill="none" stroke="transparent" strokeWidth={Math.max(14, sw + 10)} pointerEvents="stroke" />}
      {(a.kind === "underline" || a.kind === "strikeout") && r && <rect x={X(r.x)} y={Y(r.y)} width={X(r.w)} height={Y(r.h)} fill="transparent" />}
      {body}
      {(a.kind === "note" || a.kind === "text") && r && (editing || (a.kind === "text" && a.text)) && (
        <TextBody a={a} w={w} h={h} editing={editing} />
      )}
      {selected && (
        <>
          <rect x={X(box.x) - pad} y={Y(box.y) - pad} width={X(box.w) + pad * 2 + (a.kind === "note" ? 22 : 0)} height={Y(box.h) + pad * 2 + (a.kind === "note" ? 22 : 0)}
            fill="none" stroke="var(--primary)" strokeWidth={1.5} strokeDasharray="5 3" pointerEvents="none" />
          {a.rect && a.kind !== "note" && (
            <rect x={X(box.x + box.w) - 5} y={Y(box.y + box.h) - 5} width={10} height={10} rx={2}
              fill="var(--surface-1)" stroke="var(--primary)" strokeWidth={1.5} style={{ cursor: "nwse-resize" }} onPointerDown={onResize} />
          )}
        </>
      )}
    </g>
  );
}

function ArrowHead({ p, w, h, color, size }: { p: Pt[]; w: number; h: number; color: string; size: number }) {
  const a = p[p.length - 2], b = p[p.length - 1];
  const ang = Math.atan2((b.y - a.y) * h, (b.x - a.x) * w);
  const bx = b.x * w, by = b.y * h, spread = Math.PI / 7;
  const pt = (t: number) => `${bx - size * Math.cos(ang + t)},${by - size * Math.sin(ang + t)}`;
  return <polygon points={`${bx},${by} ${pt(-spread)} ${pt(spread)}`} fill={color} />;
}

function TextBody({ a, w, h, editing }: { a: Annotation; w: number; h: number; editing: boolean }) {
  const r = a.rect!;
  const patch = useAnnot((s) => s.patch);
  const commit = useAnnot((s) => s.checkpoint);
  const edit = useAnnot((s) => s.edit);
  const isNote = a.kind === "note";
  const x = r.x * w, y = r.y * h + (isNote ? 26 : 0);
  const width = isNote ? Math.max(180, w * 0.25) : Math.max(40, r.w * w);
  const height = isNote ? 90 : Math.max(24, r.h * h);
  const done = useRef(false);
  return (
    <foreignObject x={x} y={y} width={width} height={height} onPointerDown={(e) => e.stopPropagation()}>
      {editing ? (
        <textarea
          className="annot-text" autoFocus defaultValue={a.text}
          placeholder={isNote ? "Nội dung ghi chú…" : "Nhập văn bản…"}
          onFocus={() => { done.current = false; commit(); }}
          onChange={(e) => patch(a.id, { text: e.target.value })}
          onBlur={() => { if (!done.current) edit(null); }}
          onKeyDown={(e) => { if (e.key === "Escape") { done.current = true; edit(null); } e.stopPropagation(); }}
          style={{ color: isNote ? "#14171C" : a.color, background: isNote ? "#FFF8C5" : "transparent" }}
        />
      ) : (
        <div className="annot-text static" style={{ color: a.color }}>{a.text}</div>
      )}
    </foreignObject>
  );
}
