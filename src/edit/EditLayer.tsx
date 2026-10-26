import { useEffect, useRef, useState, type PointerEvent as RPE } from "react";
import { createPortal } from "react-dom";
import type { NormRect, PageObj } from "../lib/api";
import { registerCommands } from "../lib/shortcuts";
import { PT_TO_PX } from "../lib/viewer";
import { useStore } from "../store";
import { displayRect, editKey, hitTest, moveRect, resizeRect } from "./model";
import { useEdit } from "./store";

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

const parseKey = (key: string): [number, number] => { const [p, i] = key.split(":"); return [Number(p), Number(i)]; };
const pct = (v: number) => `${v * 100}%`;

/** Lớp chọn và sửa đối tượng, chồng lên từng trang khi ở chế độ "Chỉnh sửa". */
export function EditLayer() {
  const { mode, path } = useStore();
  const [root, setRoot] = useState<HTMLElement | null>(null);
  useEffect(() => { setRoot(document.querySelector<HTMLElement>(".canvas")); }, [path]);
  const pages = usePageElements(root);
  const active = mode === "edit";
  const selected = useEdit((s) => s.selected);
  // Chọn một đối tượng thì mở bảng Thuộc tính bên phải để đổi màu, cỡ chữ...
  useEffect(() => { if (active && selected && !useStore.getState().rightOpen) useStore.setState({ rightOpen: true }); }, [active, selected]);

  useEffect(() => {
    if (!active) return;
    const deleteSelected = () => {
      const st = useEdit.getState();
      if (!st.selected) return false;
      const [page, id] = parseKey(st.selected);
      const o = st.objects[page]?.find((x) => x.id === id);
      if (!o) return false;
      st.apply(page, o, { deleted: true });
      st.select(null);
    };
    const offCmds = registerCommands([
      { id: "edit.delete", label: "Xoá đối tượng đang chọn", group: "Chỉnh sửa", keys: ["Delete", "Backspace"], run: deleteSelected },
      { id: "edit.escape", label: "Bỏ chọn đối tượng", group: "Chỉnh sửa", keys: ["Escape"], run: () => { const st = useEdit.getState(); if (!st.selected) return false; st.select(null); } },
      {
        id: "edit.text", label: "Sửa chữ đang chọn", group: "Chỉnh sửa", keys: ["Enter"],
        run: () => {
          const st = useEdit.getState();
          if (!st.selected) return false;
          const [page, id] = parseKey(st.selected);
          if (st.objects[page]?.find((x) => x.id === id)?.kind !== "text") return false;
          st.type(st.selected);
        },
      },
    ]);
    return () => { offCmds(); useEdit.getState().select(null); };
  }, [active]);

  if (!active || !path) return null;
  return <>{pages.map((el) => createPortal(<PageEdit key={el.dataset.page} index={Number(el.dataset.page)} el={el} path={path} />, el, `e${el.dataset.page}`))}</>;
}

type Drag = { key: string; o: PageObj; start: { x: number; y: number }; origin: NormRect; mode: "move" | "resize"; moved: boolean; rect: NormRect };

function PageEdit({ index, el, path }: { index: number; el: HTMLElement; path: string }) {
  const objs = useEdit((s) => s.objects[index]);
  const edits = useEdit((s) => s.edits);
  const rects = useEdit((s) => s.rects);
  const selected = useEdit((s) => s.selected);
  const typing = useEdit((s) => s.typing);
  const zoom = useStore((s) => s.zoom);
  const root = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);

  useEffect(() => { void useEdit.getState().loadObjects(path, index); }, [path, index]);

  const pt = (e: { clientX: number; clientY: number }) => {
    const r = root.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  const hitAt = (e: RPE) => { const p = pt(e); return objs ? hitTest(objs, edits, index, rects, p.x, p.y) : null; };
  const rectOf = (o: PageObj) => { const key = editKey(index, o.id); return displayRect(o, edits[key], rects[key]); };

  const setDragState = (d: Drag | null) => { dragRef.current = d; setDrag(d); };

  const down = (e: RPE) => {
    if (e.button !== 0 || typing) return;
    const st = useEdit.getState();
    const o = hitAt(e);
    if (!o) { st.select(null); return; }
    const key = editKey(index, o.id);
    st.select(key);
    root.current!.setPointerCapture(e.pointerId);
    const origin = rectOf(o);
    setDragState({ key, o, start: pt(e), origin, mode: "move", moved: false, rect: origin });
  };

  const startResize = (o: PageObj) => (e: RPE) => {
    e.stopPropagation();
    root.current!.setPointerCapture(e.pointerId);
    const origin = rectOf(o);
    setDragState({ key: editKey(index, o.id), o, start: pt(e), origin, mode: "resize", moved: false, rect: origin });
  };

  const move = (e: RPE) => {
    const d = dragRef.current;
    const p = pt(e);
    if (!d) { const h = hitAt(e); setHover(h ? editKey(index, h.id) : null); return; }
    const dx = p.x - d.start.x, dy = p.y - d.start.y;
    if (!d.moved && Math.hypot(dx * el.offsetWidth, dy * el.offsetHeight) < 3) return; // chỉ bấm, chưa kéo
    const rect = d.mode === "move" ? moveRect(d.origin, dx, dy) : resizeRect(d.origin, p.x, p.y);
    setDragState({ ...d, moved: true, rect });
  };

  const up = () => {
    const d = dragRef.current;
    setDragState(null);
    if (d?.moved) useEdit.getState().apply(index, d.o, { rect: d.rect });
  };

  const dbl = (e: RPE | React.MouseEvent) => {
    const o = hitAt(e as RPE);
    if (o?.kind === "text") useEdit.getState().type(editKey(index, o.id));
  };

  const live = (objs ?? []).filter((o) => !edits[editKey(index, o.id)]?.deleted);
  const show = new Set<string>([selected, hover].filter((k): k is string => !!k));
  const typingObj = typing && parseKey(typing)[0] === index ? live.find((o) => editKey(index, o.id) === typing) : undefined;

  return (
    <div
      ref={root} className="edit-root" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      onPointerLeave={() => setHover(null)} onDoubleClick={dbl}
    >
      {live.map((o) => {
        const key = editKey(index, o.id);
        if (!show.has(key)) return null;
        const r = drag?.key === key ? drag.rect : rectOf(o);
        const isSel = key === selected;
        return (
          <div key={key} className={`edit-box kind-${o.kind}${isSel ? " selected" : ""}${edits[key] ? " edited" : ""}`}
            style={{ left: pct(r[0]), top: pct(r[1]), width: pct(r[2]), height: pct(r[3]) }}>
            {isSel && o.kind !== "text" && !typing && <span className="edit-handle" onPointerDown={startResize(o)} aria-label="Đổi kích thước" />}
          </div>
        );
      })}
      {typingObj && <TextInput page={index} o={typingObj} rect={rectOf(typingObj)} zoom={zoom} />}
    </div>
  );
}

function TextInput({ page, o, rect, zoom }: { page: number; o: PageObj; rect: NormRect; zoom: number }) {
  const key = editKey(page, o.id);
  const edit = useEdit((s) => s.edits[key]);
  const initial = edit?.text ?? o.text ?? "";
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);

  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    const st = useEdit.getState();
    if (commit && value !== initial && value.trim() !== "") st.apply(page, o, { text: value });
    st.type(null);
  };
  const sizePx = (edit?.size ?? o.size ?? 12) * PT_TO_PX * zoom;

  return (
    <input
      ref={input} className="edit-text" value={value} spellCheck={false}
      style={{ left: pct(rect[0]), top: pct(rect[1]), minWidth: pct(rect[2]), height: pct(rect[3]), fontSize: sizePx, fontWeight: (edit?.bold ?? o.bold) ? 700 : 400 }}
      onChange={(e) => setValue(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); finish(true); }
        else if (e.key === "Escape") { e.preventDefault(); finish(false); }
        e.stopPropagation();
      }}
    />
  );
}
