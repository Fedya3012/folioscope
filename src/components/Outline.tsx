import { useState } from "react";
import type { OutlineItem } from "../lib/api";
import { useStore } from "../store";

function Node({ item, depth }: { item: OutlineItem; depth: number }) {
  const [open, setOpen] = useState(depth < 1);
  const goToPage = useStore((s) => s.goToPage);
  const hasKids = item.children.length > 0;
  return (
    <li role="treeitem" aria-expanded={hasKids ? open : undefined}>
      <div className="outline-row" style={{ paddingLeft: 8 + depth * 14 }}>
        <button className="twisty" aria-label={open ? "Thu gọn" : "Mở rộng"} onClick={() => setOpen(!open)} style={{ visibility: hasKids ? "visible" : "hidden" }}>{open ? "▾" : "▸"}</button>
        <button className="outline-title" disabled={item.page == null} onClick={() => item.page != null && goToPage(item.page)} title={item.title}>
          {item.title || "(không tên)"}
        </button>
        {item.page != null && <span className="outline-page">{item.page + 1}</span>}
      </div>
      {hasKids && open && <ul role="group">{item.children.map((c, i) => <Node key={i} item={c} depth={depth + 1} />)}</ul>}
    </li>
  );
}

export function Outline() {
  const outline = useStore((s) => s.outline);
  const hasDoc = useStore((s) => s.info != null);
  if (!hasDoc) return <p className="body">Chưa có tài liệu.</p>;
  if (!outline.length) return <p className="body">Tài liệu này không có mục lục (bookmark).</p>;
  return <ul className="outline" role="tree">{outline.map((o, i) => <Node key={i} item={o} depth={0} />)}</ul>;
}
