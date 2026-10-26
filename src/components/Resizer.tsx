import { useRef, useState } from "react";

/** Thanh kéo đổi bề rộng panel. `side` cho biết panel nằm bên nào của thanh. */
export function Resizer({ side, onDrag }: { side: "left" | "right"; onDrag: (rawWidth: number) => void }) {
  const [active, setActive] = useState(false);
  const start = useRef<{ x: number; w: number } | null>(null);
  const el = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={el}
      className={`resizer${active ? " active" : ""}`}
      role="separator"
      aria-orientation="vertical"
      onPointerDown={(e) => {
        const panel = (side === "left" ? el.current?.previousElementSibling : el.current?.nextElementSibling) as HTMLElement | null;
        start.current = { x: e.clientX, w: panel?.getBoundingClientRect().width ?? 0 };
        e.currentTarget.setPointerCapture(e.pointerId);
        setActive(true);
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const dx = e.clientX - start.current.x;
        onDrag(start.current.w + (side === "left" ? dx : -dx));
      }}
      onPointerUp={() => { start.current = null; setActive(false); }}
    />
  );
}
