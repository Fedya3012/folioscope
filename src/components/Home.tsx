import { useEffect, useMemo, useState } from "react";
import { greeting } from "../lib/settings";
import { folderOf, formatBytes, relativeTime, sortRecent, type RecentFile, type RecentSort } from "../lib/recent";
import { db } from "../lib/db";
import { requestThumb } from "../lib/thumbs";
import { useStore } from "../store";
import { Icon, type IconName } from "./Icon";

type Section = "home" | "recent" | "pinned" | "templates";
type Layout = "grid" | "list";

const SIDE: [Section, string, IconName][] = [
  ["home", "Trang chủ", "home"], ["recent", "Gần đây", "clock"], ["pinned", "Đã ghim", "star"], ["templates", "Templates", "template"],
];

type Action = { id: string; label: string; desc: string; icon: IconName; tone: string; run?: "open" | "create" | "combine" };
const ACTIONS: Action[] = [
  { id: "open", label: "Mở file", desc: "Xem và chỉnh sửa PDF", icon: "open", tone: "cobalt", run: "open" },
  { id: "create", label: "Tạo PDF", desc: "Từ ảnh, Word, Excel…", icon: "plus", tone: "success", run: "create" },
  { id: "convert", label: "Chuyển đổi", desc: "PDF ↔ Word, Excel, ảnh", icon: "convert", tone: "accent" },
  { id: "combine", label: "Gộp file", desc: "Ghép nhiều file thành một", icon: "combine", tone: "danger", run: "combine" },
  { id: "compress", label: "Nén file", desc: "Giảm dung lượng PDF", icon: "compress", tone: "violet" },
  { id: "ocr", label: "OCR", desc: "Nhận dạng chữ trong ảnh", icon: "ocr", tone: "info" },
];

const TEMPLATES: [string, string][] = [
  ["Hoá đơn", "Có bảng tính tiền và thuế"], ["Hợp đồng", "Các điều khoản cơ bản"], ["CV", "Một trang, gọn gàng"],
  ["Biểu mẫu đăng ký", "Trường điền sẵn"], ["Báo giá", "Danh mục và tổng cộng"], ["Biên bản", "Họp, bàn giao, nghiệm thu"],
];

function Thumb({ path }: { path: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setSrc(null); setFailed(false);
    return requestThumb(path, 0, 256, setSrc, () => setFailed(true));
  }, [path]);
  if (src) return <img className="rc-img" src={src} alt="" draggable={false} />;
  return <div className={`rc-ph${failed ? " failed" : ""}`}><Icon name="file" size={28} />{failed && <span>Không đọc được file</span>}</div>;
}

function RecentCard({ f, now, onOpen }: { f: RecentFile; now: number; onOpen: (p: string) => void }) {
  const { togglePinRecent, forgetRecent } = useStore();
  return (
    <div className={`rc${f.pinned ? " pinned" : ""}`}>
      <button className="rc-main" onClick={() => onOpen(f.path)} title={f.path}>
        <span className="rc-thumb"><Thumb path={f.path} /></span>
        <span className="rc-name">{f.name}</span>
        <span className="rc-sub">Mở {relativeTime(f.openedAt, now)} · {formatBytes(f.size)}</span>
      </button>
      <div className="rc-tools">
        <button className={`rc-btn${f.pinned ? " on" : ""}`} aria-pressed={f.pinned} aria-label={f.pinned ? "Bỏ ghim" : "Ghim"} title={f.pinned ? "Bỏ ghim" : "Ghim"} onClick={() => togglePinRecent(f.path)}>
          <Icon name="star" filled={f.pinned} />
        </button>
        <button className="rc-btn" aria-label="Xoá khỏi danh sách" title="Xoá khỏi danh sách (không xoá file)" onClick={() => forgetRecent(f.path)}><Icon name="close" /></button>
      </div>
    </div>
  );
}

function RecentList({ items, now, onOpen }: { items: RecentFile[]; now: number; onOpen: (p: string) => void }) {
  const { togglePinRecent, forgetRecent } = useStore();
  const [sort, setSort] = useState<RecentSort>("openedAt");
  const rows = useMemo(() => sortRecent(items, sort), [items, sort]);
  const th = (k: RecentSort, label: string) => (
    <th aria-sort={sort === k ? (k === "name" ? "ascending" : "descending") : "none"}>
      <button onClick={() => setSort(k)}>{label}{sort === k ? (k === "name" ? " ↑" : " ↓") : ""}</button>
    </th>
  );
  return (
    <table className="rl">
      <thead><tr>{th("name", "Tên")}<th>Vị trí</th>{th("openedAt", "Lần mở cuối")}{th("size", "Kích thước")}<th /></tr></thead>
      <tbody>
        {rows.map((f) => (
          <tr key={f.path}>
            <td><button className="rl-name" onClick={() => onOpen(f.path)} title={f.path}><Icon name="file" size={16} /><span>{f.name}</span></button></td>
            <td className="rl-path" title={folderOf(f.path)}>{folderOf(f.path) || "—"}</td>
            <td>{relativeTime(f.openedAt, now)}</td>
            <td className="mono">{formatBytes(f.size)}</td>
            <td className="rl-act">
              <button className={`rc-btn${f.pinned ? " on" : ""}`} aria-pressed={f.pinned} aria-label={f.pinned ? "Bỏ ghim" : "Ghim"} onClick={() => togglePinRecent(f.path)}><Icon name="star" filled={f.pinned} /></button>
              <button className="rc-btn" aria-label="Xoá khỏi danh sách" onClick={() => forgetRecent(f.path)}><Icon name="close" /></button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export type HomeProps = { onOpenDialog: () => void; onOpenPath: (p: string) => void; onCombine: (files: string[]) => void };

export function Home({ onOpenDialog, onOpenPath, onCombine }: HomeProps) {
  const { recent, settings, error, info, setView, setSettingsOpen, clearRecent } = useStore();
  const [section, setSection] = useState<Section>("home");
  const [layout, setLayout] = useState<Layout>(() => {
    return db.getItem("folioscope.recentLayout") === "list" ? "list" : "grid";
  });
  const chooseLayout = (l: Layout) => { setLayout(l); db.setItem("folioscope.recentLayout", l); };
  const now = Date.now();
  const name = settings.userName.trim();
  // Mới mở nhất lên đầu; file đã ghim luôn đứng trước.
  const sorted = useMemo(() => sortRecent(recent, "openedAt").sort((a, b) => Number(b.pinned) - Number(a.pinned)), [recent]);
  const pinned = sorted.filter((f) => f.pinned);
  const showRecent = section === "home" || section === "recent";
  const showPinned = section === "pinned" && pinned.length > 0;
  const showTemplates = section === "home" || section === "templates";
  const first = recent.length === 0;

  const run = (a: Action) => {
    if (a.run === "open") onOpenDialog();
    else if (a.run === "create" || a.run === "combine") onCombine([]);
  };

  const list = (items: RecentFile[]) => layout === "grid"
    ? <div className="rc-grid">{items.map((f) => <RecentCard key={f.path} f={f} now={now} onOpen={onOpenPath} />)}</div>
    : <RecentList items={items} now={now} onOpen={onOpenPath} />;

  return (
    <div className="home">
      <aside className="home-side" aria-label="Điều hướng Home">
        <nav>
          {SIDE.map(([id, label, icon]) => (
            <button key={id} className="side-item" aria-current={section === id ? "page" : undefined} onClick={() => setSection(id)}>
              <Icon name={icon} /> {label}
            </button>
          ))}
        </nav>
        <div className="side-foot">
          {info && <button className="side-item" onClick={() => setView("doc")}><Icon name="file" /> Quay lại tài liệu</button>}
          <button className="side-item" onClick={() => setSettingsOpen(true)}><Icon name="settings" /> Cài đặt</button>
        </div>
      </aside>

      <div className="home-content">
        <div className="home-inner">
          {section === "home" && (
            <header className="home-hero">
              <h1>{greeting(new Date().getHours())}{name ? `, ${name}` : ""}</h1>
              <p>{first ? "Mở một file PDF để bắt đầu." : `Bạn có ${recent.length} tài liệu gần đây.`}</p>
            </header>
          )}
          {error && <p className="notice err" role="alert">{error}</p>}

          {section === "home" && (
            <>
              <button className="dropzone" onClick={onOpenDialog}>
                <span className="dz-icon"><Icon name="upload" size={24} /></span>
                <span className="dz-text">
                  <span><strong>Kéo thả file vào cửa sổ</strong> hoặc <u>chọn file</u></span>
                  <small>PDF mở để xem. Nhiều file, hoặc Word, Excel, ảnh sẽ vào hộp thoại Gộp file.</small>
                </span>
              </button>

              <section aria-labelledby="h-actions">
                <h2 id="h-actions" className="visually-hidden">Thao tác nhanh</h2>
                <div className="qa-grid">
                  {ACTIONS.map((a) => (
                    <button key={a.id} className={`qa-tile tone-${a.tone}`} disabled={!a.run} onClick={() => run(a)}>
                      <span className="qa-icon"><Icon name={a.icon} size={20} /></span>
                      <span className="qa-label">{a.label}</span>
                      <span className="qa-desc">{a.desc}</span>
                      {!a.run && <em className="qa-soon">Sắp có</em>}
                    </button>
                  ))}
                </div>
              </section>
            </>
          )}

          {showPinned && (
            <section className="home-sec" aria-labelledby="h-pinned">
              <div className="sec-head"><h2 id="h-pinned">Đã ghim</h2></div>
              {list(pinned)}
            </section>
          )}
          {section === "pinned" && pinned.length === 0 && (
            <p className="home-empty">Chưa ghim file nào. Di chuột vào một file gần đây rồi bấm ngôi sao.</p>
          )}

          {showRecent && (
            <section className="home-sec" aria-labelledby="h-recent">
              <div className="sec-head">
                <h2 id="h-recent">Gần đây</h2>
                <span className="spacer" />
                {recent.some((f) => !f.pinned) && <button className="btn ghost sm" onClick={clearRecent}>Xoá danh sách</button>}
                <div className="segmented sm" role="group" aria-label="Kiểu hiển thị danh sách">
                  <button aria-pressed={layout === "grid"} aria-label="Dạng lưới" title="Dạng lưới" onClick={() => chooseLayout("grid")}><Icon name="grid" /></button>
                  <button aria-pressed={layout === "list"} aria-label="Dạng danh sách" title="Dạng danh sách" onClick={() => chooseLayout("list")}><Icon name="list" /></button>
                </div>
              </div>
              {first ? (
                <div className="first-run">
                  <div className="fr-art" aria-hidden="true"><Icon name="file" size={64} /></div>
                  <h3>Mở file PDF đầu tiên của bạn</h3>
                  <ul>
                    <li><kbd>Ctrl</kbd> + <kbd>O</kbd> chọn file từ máy</li>
                    <li>Kéo thả file vào cửa sổ này</li>
                    <li>Chuột phải nhiều file trong Explorer, chọn Combine files in Folioscope…</li>
                  </ul>
                  <button className="btn primary lg" onClick={onOpenDialog}>Chọn file…</button>
                </div>
              ) : list(sorted)}
            </section>
          )}

          {showTemplates && (
            <section className="home-sec" aria-labelledby="h-tpl">
              <div className="sec-head"><h2 id="h-tpl">Templates</h2><em className="soon">Sắp có</em></div>
              <div className="tpl-row">
                {TEMPLATES.map(([t, d]) => (
                  <div key={t} className="tpl" aria-disabled="true">
                    <div className="tpl-prev" aria-hidden="true"><i /><i /><i /><i /></div>
                    <strong>{t}</strong><small>{d}</small>
                    {t === "Biểu mẫu đăng ký" && <span className="badge">Form điền được</span>}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
