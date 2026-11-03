import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { clampMenu, useCtxMenu } from "../lib/ctxMenu";

/** Menu chuột phải dùng chung: mở bằng `useCtxMenu.getState().open(x, y, items)`. */
export function ContextMenu() {
  const { menu, close } = useCtxMenu();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos(clampMenu(menu.x, menu.y, r.width, r.height, window.innerWidth, window.innerHeight));
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, [menu, close]);

  if (!menu) return null;
  return (
    <div ref={ref} className="ctx-menu" role="menu" style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      {menu.items.map((it, i) => "sep" in it ? <div key={i} className="sep" role="separator" /> : (
        <button key={i} role="menuitem" disabled={it.disabled} className={it.danger ? "danger" : undefined}
          onClick={() => { close(); it.run(); }}>{it.label}{it.hint && <kbd style={{ float: "right", opacity: 0.6 }}>{it.hint}</kbd>}</button>
      ))}
    </div>
  );
}
