import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";

export const SEARCH_INPUT_ID = "folioscope-search-input";

export function SearchPanel() {
  const { search, runSearch, stepHit, goToHit, info } = useStore();
  const [text, setText] = useState(search.query);
  const [matchCase, setMatchCase] = useState(search.matchCase);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);

  const submit = () => {
    // Enter lần đầu (hoặc sau khi đổi chữ) thì tìm; các lần sau nhảy sang kết quả kế.
    if (text === search.query && matchCase === search.matchCase && search.hits.length) stepHit(1);
    else void runSearch(text, matchCase);
  };

  const status = !info ? "Chưa có tài liệu."
    : search.busy ? "Đang tìm…"
    : search.error ? search.error
    : !search.query ? ""
    : search.hits.length === 0 ? "Không có kết quả."
    : `${search.active + 1} / ${search.hits.length}${search.truncated ? "+" : ""} kết quả`;

  return (
    <div className="search">
      <div className="search-box">
        <input
          id={SEARCH_INPUT_ID} ref={input} type="search" value={text} placeholder="Tìm trong tài liệu"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (e.shiftKey && search.hits.length) stepHit(-1); else submit(); } }}
          disabled={!info}
        />
        <button className="btn ghost" aria-label="Kết quả trước" onClick={() => stepHit(-1)} disabled={!search.hits.length}>↑</button>
        <button className="btn ghost" aria-label="Kết quả sau" onClick={() => stepHit(1)} disabled={!search.hits.length}>↓</button>
      </div>
      <label className="search-opt">
        <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> Phân biệt hoa/thường
      </label>
      <p className="search-status" role="status">{status}</p>
      <ul className="search-results">
        {search.hits.slice(0, 500).map((h, i) => (
          <li key={i}>
            <button aria-current={i === search.active} onClick={() => goToHit(i)}>Trang {h.page + 1}</button>
          </li>
        ))}
      </ul>
      {search.hits.length > 500 && <p className="body">Hiện 500 kết quả đầu; dùng ↑ ↓ để duyệt tiếp.</p>}
    </div>
  );
}
