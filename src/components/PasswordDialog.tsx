import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";

/** Hộp nhập mật khẩu khi mở file PDF được bảo vệ. Mật khẩu chỉ giữ trong bộ nhớ, không lưu ra đĩa. */
export function PasswordDialog() {
  const prompt = useStore((s) => s.passwordPrompt);
  const load = useStore((s) => s.load);
  const cancel = useStore((s) => s.cancelPassword);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // Mỗi lần hộp mở lại (file mới hoặc nhập sai) xoá ô và đặt con trỏ vào đó.
  useEffect(() => {
    setValue("");
    setBusy(false);
    input.current?.focus();
  }, [prompt]);

  if (!prompt) return null;
  const name = prompt.path.split(/[\\/]/).pop();
  const submit = async () => {
    if (!value || busy) return;
    setBusy(true);
    await load(prompt.path, value);
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) cancel(); }}>
      <div className="modal narrow" role="dialog" aria-modal="true" aria-labelledby="pw-title"
        onKeyDown={(e) => { if (e.key === "Escape") cancel(); if (e.key === "Enter") void submit(); }}>
        <header>
          <h2 id="pw-title">File có mật khẩu</h2>
          <button className="btn ghost icon" aria-label="Đóng" onClick={cancel}>✕</button>
        </header>
        <div className="modal-body">
          <p className="hint path" title={prompt.path}>{name}</p>
          <label className="stack">
            <span>Nhập mật khẩu để mở file</span>
            <input ref={input} type="password" autoComplete="off" value={value} aria-invalid={prompt.wrong}
              aria-describedby={prompt.wrong ? "pw-err" : undefined} onChange={(e) => setValue(e.target.value)} />
          </label>
          {prompt.wrong && <p id="pw-err" role="alert" className="notice err">Mật khẩu chưa đúng, hãy thử lại.</p>}
          <div className="actions">
            <button className="btn secondary" onClick={cancel}>Huỷ</button>
            <button className="btn primary" disabled={!value || busy} onClick={() => void submit()}>Mở file</button>
          </div>
        </div>
      </div>
    </div>
  );
}
