import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ACCENTS, RECENT_LIMITS, UI_SIZES, type Settings as S } from "../lib/settings";
import { toast } from "../lib/toast";
import { useStore } from "../store";
import { Icon } from "./Icon";

type Group = "general" | "appearance" | "display" | "edit" | "convert" | "ai" | "keys" | "account" | "advanced";
const GROUPS: [Group, string][] = [
  ["general", "Chung"], ["appearance", "Giao diện"], ["display", "Hiển thị tài liệu"], ["edit", "Chỉnh sửa & Ghi chú"],
  ["convert", "Chuyển đổi & OCR"], ["ai", "AI Assistant"], ["keys", "Phím tắt"], ["account", "Tài khoản & Đồng bộ"], ["advanced", "Nâng cao"],
];

/** Mục chưa làm: liệt kê theo bản thiết kế để người dùng biết sẽ có gì. */
const PLANNED: Partial<Record<Group, string>> = {
  general: "Ngôn ngữ giao diện, app PDF mặc định, tự động lưu.",
  display: "Làm mịn chữ, màu nền canvas, đọc ban đêm / sepia, độ phân giải render.",
  edit: "Tên tác giả comment, màu mặc định từng công cụ, đơn vị đo, snap & lưới, xử lý font thiếu.",
  convert: "Ngôn ngữ OCR mặc định, chất lượng, PDF/A, thư mục xuất. Có cùng lúc với tính năng Chuyển đổi và OCR.",
  ai: "Bật/tắt, xử lý trên máy hay cloud, không gửi tài liệu nhạy cảm, lịch sử hỏi đáp.",
  keys: "Bảng tất cả phím tắt, ghi phím mới, cảnh báo trùng, bộ preset “Giống Acrobat”.",
  account: "Thiết bị và kết nối cloud (Google Drive, Dropbox, OneDrive). Folioscope dùng cá nhân nên chưa cần gói đăng ký.",
  advanced: "Tăng tốc GPU, bộ nhớ cache, nhật ký lỗi, xuất/nhập cài đặt.",
};

type Row = { id: string; group: Group; label: string; desc: string; keywords?: string; control: ReactNode };

function Seg<T extends string | number>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={String(v)} role="radio" aria-checked={value === v} onClick={() => onChange(v)}>{text}</button>
      ))}
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button role="switch" aria-checked={on} aria-label={label} className="toggle" onClick={() => onChange(!on)} />;
}

function ThemeCards({ value, onChange }: { value: S["theme"]; onChange: (v: S["theme"]) => void }) {
  const items: [S["theme"], string][] = [["light", "Sáng"], ["dark", "Tối"], ["system", "Theo hệ thống"]];
  return (
    <div className="theme-cards" role="radiogroup" aria-label="Chủ đề">
      {items.map(([v, label]) => (
        <button key={v} role="radio" aria-checked={value === v} className={`theme-card t-${v}`} onClick={() => onChange(v)}>
          <span className="tc-prev" aria-hidden="true"><i /><b><s /><s /></b></span>
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

export function Settings() {
  const { settings: st, updateSettings, resetSettings, clearRecent, setSettingsOpen } = useStore();
  const [group, setGroup] = useState<Group>("general");
  const [query, setQuery] = useState("");
  const [confirm, setConfirm] = useState<"reset" | "recent" | null>(null);
  const close = () => setSettingsOpen(false);

  const set = (patch: Partial<S>) => {
    updateSettings(patch);
    toast.success("Đã lưu");
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const rows: Row[] = [
    { id: "name", group: "general", label: "Tên của bạn", desc: "Dùng trong lời chào ở màn hình Home.", keywords: "tên chào",
      control: <input className="field" value={st.userName} maxLength={60} placeholder="Ví dụ: Fedya" aria-label="Tên của bạn" onChange={(e) => set({ userName: e.target.value })} /> },
    { id: "startup", group: "general", label: "Khi khởi động", desc: "Mở màn hình Home, hoặc mở lại file đã xem gần nhất.", keywords: "khởi động mở",
      control: <Seg label="Khi khởi động" value={st.startup} onChange={(startup) => set({ startup })} options={[["home", "Màn hình Home"], ["last", "File gần nhất"]]} /> },
    { id: "recent", group: "general", label: "Số file gần đây", desc: "File đã ghim không bị tính vào giới hạn.", keywords: "gần đây lịch sử",
      control: <Seg label="Số file gần đây" value={st.recentLimit} onChange={(recentLimit) => set({ recentLimit })} options={RECENT_LIMITS.map((n) => [n, String(n)] as [number, string])} /> },

    { id: "theme", group: "appearance", label: "Chủ đề", desc: "Sáng, tối, hoặc đi theo hệ điều hành.", keywords: "theme sáng tối dark light",
      control: <ThemeCards value={st.theme} onChange={(theme) => set({ theme })} /> },
    { id: "accent", group: "appearance", label: "Màu nhấn", desc: "Màu của nút chính, vùng chọn và vòng focus.", keywords: "accent màu",
      control: (
        <div className="swatches" role="radiogroup" aria-label="Màu nhấn">
          {ACCENTS.map((a) => (
            <button key={a.id} role="radio" aria-checked={st.accent === a.id} aria-label={a.label} title={a.label} className="swatch" style={{ background: a.swatch }} onClick={() => set({ accent: a.id })} />
          ))}
        </div>
      ) },
    { id: "size", group: "appearance", label: "Cỡ giao diện", desc: "Cỡ chữ của menu, nút và danh sách.", keywords: "cỡ chữ font size",
      control: <Seg label="Cỡ giao diện" value={st.uiSize} onChange={(uiSize) => set({ uiSize })} options={UI_SIZES.map((n, i) => [n, ["Nhỏ", "Mặc định", "Lớn", "Rất lớn"][i]] as [S["uiSize"], string])} /> },
    { id: "density", group: "appearance", label: "Mật độ", desc: "Gọn thì nút và hàng thấp hơn.", keywords: "density gọn",
      control: <Seg label="Mật độ" value={st.density} onChange={(density) => set({ density })} options={[["comfortable", "Thoải mái"], ["compact", "Gọn"]]} /> },
    { id: "motion", group: "appearance", label: "Giảm chuyển động", desc: "Tắt hiệu ứng trượt và mờ dần.", keywords: "animation chuyển động",
      control: <Toggle label="Giảm chuyển động" on={st.reduceMotion} onChange={(reduceMotion) => set({ reduceMotion })} /> },

    { id: "zoom", group: "display", label: "Zoom mặc định", desc: "Áp dụng khi mở một file mới.", keywords: "zoom phóng to",
      control: <Seg label="Zoom mặc định" value={st.defaultZoom} onChange={(defaultZoom) => set({ defaultZoom })} options={[["width", "Vừa bề rộng"], ["page", "Vừa trang"], ["actual", "100%"]]} /> },
    { id: "layout", group: "display", label: "Bố cục trang mặc định", desc: "Cuộn liên tục hoặc xem từng trang.", keywords: "bố cục cuộn trang",
      control: <Seg label="Bố cục trang" value={st.defaultViewMode} onChange={(defaultViewMode) => set({ defaultViewMode })} options={[["continuous", "Cuộn liên tục"], ["single", "Từng trang"]]} /> },

    { id: "clear", group: "advanced", label: "Xoá danh sách file gần đây", desc: "Chỉ xoá danh sách, không đụng tới file. File đã ghim được giữ lại.", keywords: "xoá lịch sử",
      control: confirm === "recent"
        ? <span className="confirm">Chắc chưa? <button className="btn danger sm" onClick={() => { clearRecent(); setConfirm(null); }}>Xoá</button><button className="btn ghost sm" onClick={() => setConfirm(null)}>Huỷ</button></span>
        : <button className="btn ghost danger-text" onClick={() => setConfirm("recent")}>Xoá danh sách</button> },
    { id: "reset", group: "advanced", label: "Khôi phục mặc định", desc: "Đặt lại mọi cài đặt về ban đầu.", keywords: "reset mặc định",
      control: confirm === "reset"
        ? <span className="confirm">Đặt lại tất cả? <button className="btn danger sm" onClick={() => { resetSettings(); setConfirm(null); }}>Đặt lại</button><button className="btn ghost sm" onClick={() => setConfirm(null)}>Huỷ</button></span>
        : <button className="btn ghost danger-text" onClick={() => setConfirm("reset")}>Khôi phục mặc định</button> },
  ];

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => (q ? rows.filter((r) => `${r.label} ${r.desc} ${r.keywords ?? ""}`.toLowerCase().includes(q)) : []), [q, st, confirm]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = q ? matches : rows.filter((r) => r.group === group);
  const groupLabel = (g: Group) => GROUPS.find(([id]) => id === g)![1];

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="settings" role="dialog" aria-modal="true" aria-label="Cài đặt">
        <aside className="set-nav">
          <div className="set-search">
            <Icon name="search" />
            <input type="search" value={query} placeholder="Tìm cài đặt" aria-label="Tìm cài đặt" autoFocus onChange={(e) => setQuery(e.target.value)} />
          </div>
          <nav>
            {GROUPS.map(([id, label]) => (
              <button key={id} className="side-item" aria-current={!q && group === id ? "page" : undefined} onClick={() => { setQuery(""); setGroup(id); }}>{label}</button>
            ))}
          </nav>
        </aside>
        <section className="set-body">
          <header>
            <h1>{q ? `Kết quả cho “${query.trim()}”` : groupLabel(group)}</h1>
            <button className="btn ghost icon" aria-label="Đóng" onClick={close}><Icon name="close" /></button>
          </header>
          <div className="set-rows">
            {shown.map((r) => (
              <div key={r.id} className="set-row">
                <div className="set-text">
                  <strong>{r.label}</strong>
                  <span>{r.desc}</span>
                  {q && <small>{groupLabel(r.group)}</small>}
                </div>
                <div className="set-ctl">{r.control}</div>
              </div>
            ))}
            {q && shown.length === 0 && <p className="home-empty">Không có cài đặt nào khớp.</p>}
            {!q && PLANNED[group] && (
              <p className="set-planned"><strong>{shown.length ? "Sắp có thêm" : "Sắp có"}:</strong> {PLANNED[group]}</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
