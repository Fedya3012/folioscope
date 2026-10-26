import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ACROBAT_PRESET, applyPreset, conflictsFor, resetAllKeys, resetKeys, setKeys } from "../lib/keymap";
import { comboFromEvent, formatCombo, getKeyOverrides, listCommands, parseCombo } from "../lib/shortcuts";
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
  account: "Đăng nhập, thiết bị và kết nối cloud (Google Drive, Dropbox, OneDrive). Folioscope dùng cá nhân và chưa có máy chủ nên mục này để dành; chưa cần gói đăng ký.",
  advanced: "Tăng tốc GPU, bộ nhớ cache, nhật ký lỗi, xuất/nhập cài đặt.",
};

/** Bảng phím tắt: ghi phím mới, cảnh báo trùng, khôi phục mặc định, bộ "Giống Acrobat". */
function KeyMap() {
  const [, bump] = useState(0);
  const [rec, setRec] = useState<string | null>(null);
  const [warn, setWarn] = useState<{ id: string; with: string[] } | null>(null);
  const refresh = () => bump((n) => n + 1);
  const cmds = listCommands();
  const overridden = (id: string) => id in getKeyOverrides();

  useEffect(() => {
    if (!rec) return;
    const on = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation();
      if (e.key === "Escape") { setRec(null); return; }
      const spec = comboFromEvent(e);
      if (!spec) return;
      const clash = conflictsFor(rec, spec);
      setKeys(rec, [spec]);
      setWarn(clash.length ? { id: rec, with: clash } : null);
      setRec(null); refresh();
    };
    window.addEventListener("keydown", on, true);
    return () => window.removeEventListener("keydown", on, true);
  }, [rec]);

  const groups = new Map<string, typeof cmds>();
  for (const c of cmds) groups.set(c.group, [...(groups.get(c.group) ?? []), c]);

  return (
    <div>
      <div className="key-toolbar">
        <button className="btn ghost" onClick={() => { applyPreset(ACROBAT_PRESET); setWarn(null); refresh(); toast.success("Đã áp dụng bộ phím Giống Acrobat"); }}>Giống Acrobat</button>
        <button className="btn ghost danger-text" onClick={() => { resetAllKeys(); setWarn(null); refresh(); toast.success("Đã khôi phục phím mặc định"); }}>Khôi phục tất cả</button>
      </div>
      {[...groups].map(([g, list]) => (
        <section key={g}>
          <h2 className="key-group">{g}</h2>
          {list.map((c) => (
            <div key={c.id} className="key-row">
              <div className="key-name">
                <span>{c.label}</span>
                {warn?.id === c.id && <small className="warn">Trùng với: {warn.with.join(", ")}</small>}
              </div>
              <div className="key-actions">
                {c.keys.length === 0 && rec !== c.id && <span className="key-chip">Chưa gán</span>}
                {rec === c.id ? <span className="key-chip recording">Nhấn phím mới… (Esc để huỷ)</span>
                  : c.keys.map((k) => <span key={k} className="key-chip">{formatCombo(parseCombo(k))}</span>)}
                <button className="btn ghost sm" onClick={() => { setWarn(null); setRec(c.id); }}>Đổi</button>
                {overridden(c.id) && <button className="btn ghost sm" aria-label={`Khôi phục phím của ${c.label}`} onClick={() => { resetKeys(c.id); setWarn(null); refresh(); }}>↺</button>}
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

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
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector(".key-chip.recording")) { e.stopPropagation(); close(); } };
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

    { id: "author", group: "edit", label: "Tên tác giả ghi chú", desc: "Hiện trên comment và ghi chú bạn tạo. Để trống thì dùng tên ở mục Chung.", keywords: "author comment bình luận",
      control: <input className="field" value={st.authorName} maxLength={60} placeholder={st.userName || "Ví dụ: Fedya"} aria-label="Tên tác giả ghi chú" onChange={(e) => set({ authorName: e.target.value })} /> },
    { id: "unit", group: "edit", label: "Đơn vị đo", desc: "Dùng cho công cụ đo và kích thước trang.", keywords: "unit mm cm inch",
      control: <Seg label="Đơn vị đo" value={st.unit} onChange={(unit) => set({ unit })} options={[["mm", "mm"], ["cm", "cm"], ["in", "inch"], ["pt", "pt"]]} /> },
    { id: "snap", group: "edit", label: "Bám lưới khi kéo", desc: "Đối tượng tự canh theo lưới nhỏ khi di chuyển.", keywords: "snap grid lưới",
      control: <Toggle label="Bám lưới" on={st.snapToGrid} onChange={(snapToGrid) => set({ snapToGrid })} /> },
    { id: "comments", group: "edit", label: "Tự mở danh sách comment", desc: "Mở bảng comment khi vào chế độ Ghi chú.", keywords: "comment bảng",
      control: <Toggle label="Tự mở danh sách comment" on={st.autoOpenComments} onChange={(autoOpenComments) => set({ autoOpenComments })} /> },

    { id: "ocrlang", group: "convert", label: "Ngôn ngữ OCR mặc định", desc: "Nhận dạng chữ trong bản quét. Chọn đúng ngôn ngữ thì chính xác hơn.", keywords: "ocr ngôn ngữ tiếng việt",
      control: <Seg label="Ngôn ngữ OCR" value={st.ocrLang} onChange={(ocrLang) => set({ ocrLang })} options={[["vie", "Tiếng Việt"], ["eng", "English"], ["vie+eng", "Việt + Anh"]]} /> },
    { id: "ocrq", group: "convert", label: "Chất lượng OCR", desc: "Nhanh thì kém chính xác hơn; Tốt nhất chạy lâu nhất.", keywords: "ocr chất lượng tốc độ",
      control: <Seg label="Chất lượng OCR" value={st.ocrQuality} onChange={(ocrQuality) => set({ ocrQuality })} options={[["fast", "Nhanh"], ["balanced", "Cân bằng"], ["best", "Tốt nhất"]]} /> },
    { id: "deskew", group: "convert", label: "Tự làm thẳng trang quét", desc: "Chỉnh trang bị nghiêng trước khi nhận dạng.", keywords: "deskew nghiêng",
      control: <Toggle label="Tự làm thẳng trang quét" on={st.ocrDeskew} onChange={(ocrDeskew) => set({ ocrDeskew })} /> },

    { id: "aion", group: "ai", label: "Bật AI Assistant", desc: "Gửi câu hỏi qua mạng tới dịch vụ AI. Đang tắt thì không có gì rời khỏi máy.", keywords: "ai trợ lý bật tắt",
      control: <Toggle label="Bật AI Assistant" on={st.aiEnabled} onChange={(aiEnabled) => set({ aiEnabled })} /> },
    { id: "aimode", group: "ai", label: "Nơi xử lý", desc: "AI chạy trên cloud. Chế độ chạy ngay trên máy chưa có.", keywords: "cloud máy local",
      control: <Seg label="Nơi xử lý" value={"cloud"} onChange={() => {}} options={[["cloud", "Cloud (qua mạng)"]]} /> },
    { id: "airedact", group: "ai", label: "Không gửi nội dung nhạy cảm", desc: "Che số thẻ, CMND/CCCD và email trước khi gửi.", keywords: "riêng tư bảo mật nhạy cảm",
      control: <Toggle label="Không gửi nội dung nhạy cảm" on={st.aiRedactSensitive} onChange={(aiRedactSensitive) => set({ aiRedactSensitive })} /> },
    { id: "aihist", group: "ai", label: "Lưu lịch sử hỏi đáp", desc: "Giữ các câu hỏi và trả lời trên máy để xem lại.", keywords: "lịch sử history",
      control: <Toggle label="Lưu lịch sử hỏi đáp" on={st.aiKeepHistory} onChange={(aiKeepHistory) => set({ aiKeepHistory })} /> },

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
            {!q && group === "keys" && <KeyMap />}
            {(q || group !== "keys") && shown.map((r) => (
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
