import { useEffect, useMemo, useRef, useState } from "react";
import { usePalette } from "../lib/paletteStore";
import { searchCommands, shortcutText } from "../lib/palette";
import { listCommands } from "../lib/shortcuts";
import { toast } from "../lib/toast";
import { Icon } from "./Icon";

/** Lệnh không gắn với một lần nhấn phím thật, nên đưa cho `run` một sự kiện giả. */
const fakeKey = { key: "", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, preventDefault() {} };

export function CommandPalette() {
  const close = () => usePalette.getState().setOpen(false);
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  // Chỉ lệnh dùng được lúc này (when) mới hiện; lấy một lần khi mở.
  const items = useMemo(
    () => listCommands().filter((c) => !c.when || c.when()).map((c) => ({ id: c.id, label: c.label, group: c.group, keys: c.keys })),
    [],
  );
  const results = useMemo(() => searchCommands(items, query), [items, query]);
  useEffect(() => setSel(0), [query]);
  useEffect(() => { listRef.current?.children[sel]?.scrollIntoView({ block: "nearest" }); }, [sel]);

  const runAt = (i: number) => {
    const item = results[i];
    if (!item) return;
    const cmd = listCommands().find((c) => c.id === item.id);
    close();
    // Chờ hộp thoại đóng xong rồi mới chạy, để lệnh mở hộp thoại khác không bị nuốt phím.
    setTimeout(() => { if (cmd && cmd.run(fakeKey) === false) toast.error("Lệnh này chưa dùng được lúc này"); }, 0);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(results.length - 1, s + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); runAt(sel); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
  };

  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Bảng lệnh" onKeyDown={onKeyDown}>
        <div className="palette-input">
          <Icon name="search" />
          <input
            autoFocus value={query} placeholder="Gõ tên lệnh… (không cần dấu)" aria-label="Tìm lệnh"
            role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={results[sel] ? `pal-${results[sel].id}` : undefined}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <ul id="palette-list" role="listbox" ref={listRef}>
          {results.map((c, i) => (
            <li key={c.id} id={`pal-${c.id}`} role="option" aria-selected={i === sel} onMouseMove={() => setSel(i)} onClick={() => runAt(i)}>
              <span className="pal-label">{c.label}<small>{c.group}</small></span>
              {shortcutText(c.keys) && <kbd>{shortcutText(c.keys)}</kbd>}
            </li>
          ))}
          {results.length === 0 && <li className="pal-empty">Không có lệnh nào khớp.</li>}
        </ul>
        <footer>↑↓ chọn · Enter chạy · Esc đóng</footer>
      </div>
    </div>
  );
}
