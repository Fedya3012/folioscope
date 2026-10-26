import { useEffect, useRef } from "react";
import { useToasts, toast, type ToastItem } from "../lib/toast";

const ICON: Record<ToastItem["kind"], string> = { success: "✓", info: "ℹ", warning: "!", error: "✕" };

function ToastView({ t }: { t: ToastItem }) {
  const timer = useRef<number>(0);
  const dismiss = () => toast.dismiss(t.id);
  // Tự đóng sau `ms`; rê chuột vào thì dừng đếm, rời ra thì đếm lại.
  const start = () => { window.clearTimeout(timer.current); timer.current = window.setTimeout(dismiss, t.ms); };
  const stop = () => window.clearTimeout(timer.current);
  useEffect(() => { start(); return stop; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={`toast-item ${t.kind}`} role={t.kind === "error" ? "alert" : "status"} onMouseEnter={stop} onMouseLeave={start}>
      <span className="toast-icon" aria-hidden="true">{ICON[t.kind]}</span>
      <span className="toast-text">{t.text}</span>
      {t.action && <button className="toast-action" onClick={() => { t.action!.run(); dismiss(); }}>{t.action.label}</button>}
      <button className="toast-close" aria-label="Đóng" onClick={dismiss}>✕</button>
    </div>
  );
}

/** Đặt một lần ở gốc app. Vùng đọc cho trình đọc màn hình: lỗi dùng "assertive", còn lại "polite". */
export function Toaster() {
  const items = useToasts((s) => s.items);
  return (
    <div className="toaster" aria-live="polite">
      {items.map((t) => <ToastView key={t.id} t={t} />)}
    </div>
  );
}
