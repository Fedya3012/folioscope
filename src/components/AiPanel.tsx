import { useEffect, useRef, useState } from "react";
import { aiChat, aiKeyStatus, getDocText } from "../lib/api";
import { buildContext, buildPrompt, historyForModel, splitCitations, type AiScope, type AiTask, type ChatMsg } from "../lib/ai";
import { db } from "../lib/db";
import { toast } from "../lib/toast";
import { useStore } from "../store";

const HIST_KEY = (path: string) => `folioscope.aiHistory:${path}`;
const HIST_MAX = 40;
const LANGS = ["tiếng Anh", "tiếng Việt", "tiếng Pháp", "tiếng Trung", "tiếng Nhật", "tiếng Hàn"];
const STYLES = ["rõ ràng và ngắn gọn hơn", "trang trọng, lịch sự", "thân thiện, dễ hiểu", "học thuật", "như một email gửi đồng nghiệp"];
const TASK_LABEL: Record<AiTask, string> = { ask: "Hỏi", summary: "Tóm tắt tài liệu", translate: "Dịch", rewrite: "Viết lại", table: "Trích bảng" };

function loadHistory(path: string): ChatMsg[] {
  const raw = db.getJson(HIST_KEY(path));
  return Array.isArray(raw) ? (raw as ChatMsg[]).filter((m) => m && typeof m.content === "string" && (m.role === "user" || m.role === "assistant")) : [];
}

export function AiPanel({ onClose, width }: { onClose: () => void; width: number }) {
  const path = useStore((s) => s.path);
  const info = useStore((s) => s.info);
  const currentPage = useStore((s) => s.currentPage);
  const settings = useStore((s) => s.settings);
  const goToPage = useStore((s) => s.goToPage);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);

  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [question, setQuestion] = useState("");
  const [scope, setScope] = useState<AiScope>("doc");
  const [lang, setLang] = useState(LANGS[0]);
  const [style, setStyle] = useState(STYLES[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const texts = useRef(new Map<string, string[]>());
  const endRef = useRef<HTMLDivElement>(null);

  // Cài đặt có thể vừa đổi (đóng hộp Cài đặt xong thì kiểm lại khoá).
  const settingsOpen = useStore((s) => s.settingsOpen);
  useEffect(() => { if (!settingsOpen) aiKeyStatus().then(setHasKey).catch(() => setHasKey(false)); }, [settingsOpen]);
  useEffect(() => { setMsgs(path && settings.aiKeepHistory ? loadHistory(path) : []); setError(null); }, [path, settings.aiKeepHistory]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [msgs, busy]);

  const save = (list: ChatMsg[]) => {
    setMsgs(list);
    if (path && settings.aiKeepHistory) db.setJson(HIST_KEY(path), list.slice(-HIST_MAX));
  };

  const run = async (task: AiTask) => {
    if (!path || !info || busy) return;
    if (task === "ask" && !question.trim()) return;
    setBusy(true); setError(null);
    try {
      let pages = texts.current.get(path);
      if (!pages) { pages = await getDocText(path); texts.current.set(path, pages); }
      const from = scope === "page" ? currentPage : 0, to = scope === "page" ? currentPage : pages.length - 1;
      const ctx = buildContext(pages, from, to, settings.aiRedactSensitive);
      if (!ctx.text.replace(/\[Trang \d+\]|\(trang không có chữ\)/g, "").trim()) {
        throw new Error("Không đọc được chữ trong phần này (có thể là bản quét). Hãy chạy OCR trước rồi hỏi lại.");
      }
      const prompt = buildPrompt(task, ctx.text, { question: question.trim(), language: lang, style, truncated: ctx.truncated });
      const shown = task === "ask" ? question.trim() : task === "translate" ? `Dịch sang ${lang}` : task === "rewrite" ? `Viết lại: ${style}` : TASK_LABEL[task];
      const pageNote = scope === "page" ? `trang ${currentPage + 1}` : ctx.truncated ? `trang 1–${ctx.lastPage + 1}` : "cả tài liệu";
      const user: ChatMsg = { role: "user", content: shown, task, pages: pageNote };
      const reply = await aiChat({
        model: settings.aiModel,
        system: prompt.system,
        max_tokens: task === "translate" || task === "rewrite" ? 8000 : 4096,
        messages: [...historyForModel(msgs), { role: "user", content: prompt.user }],
      });
      save([...msgs, user, { role: "assistant", content: reply, task }]);
      if (task === "ask") setQuestion("");
      if (ctx.truncated) toast.info(`Tài liệu dài nên chỉ gửi tới trang ${ctx.lastPage + 1}. Chọn "Trang đang xem" để hỏi phần sau.`);
    } catch (e) {
      setError(String(e).replace(/^Error: /, ""));
    } finally { setBusy(false); }
  };

  const ready = settings.aiEnabled && hasKey;
  const disabled = !ready || busy || !info;

  return (
    <aside className="panel right ai-panel" style={{ width }} aria-label="Trợ lý AI">
      <h2>Trợ lý AI <button className="btn ghost icon" aria-label="Đóng trợ lý AI" onClick={onClose}>✕</button></h2>
      {!settings.aiEnabled || hasKey === false ? (
        <div className="body ai-setup">
          <p>{!settings.aiEnabled ? "Trợ lý AI đang tắt, nên không có gì rời khỏi máy bạn." : "Chưa có khoá API."}</p>
          <p>Để dùng: bật AI Assistant và dán khoá API Anthropic trong Cài đặt. Khi hỏi, chữ của các trang được chọn sẽ gửi qua mạng tới Anthropic.</p>
          <button className="btn primary" onClick={() => setSettingsOpen(true)}>Mở Cài đặt</button>
        </div>
      ) : (
        <>
          <div className="ai-controls">
            <div className="segmented" role="radiogroup" aria-label="Phạm vi">
              <button role="radio" aria-checked={scope === "doc"} onClick={() => setScope("doc")}>Cả tài liệu</button>
              <button role="radio" aria-checked={scope === "page"} onClick={() => setScope("page")}>Trang đang xem</button>
            </div>
            <div className="ai-actions">
              <button className="btn secondary" disabled={disabled} onClick={() => void run("summary")}>Tóm tắt</button>
              <button className="btn secondary" disabled={disabled} onClick={() => void run("table")}>Trích bảng</button>
            </div>
            <div className="ai-actions">
              <select aria-label="Ngôn ngữ dịch" value={lang} onChange={(e) => setLang(e.target.value)}>{LANGS.map((l) => <option key={l}>{l}</option>)}</select>
              <button className="btn secondary" disabled={disabled} onClick={() => void run("translate")}>Dịch</button>
            </div>
            <div className="ai-actions">
              <select aria-label="Phong cách viết lại" value={style} onChange={(e) => setStyle(e.target.value)}>{STYLES.map((l) => <option key={l}>{l}</option>)}</select>
              <button className="btn secondary" disabled={disabled} onClick={() => void run("rewrite")}>Viết lại</button>
            </div>
          </div>

          <div className="ai-log" aria-live="polite">
            {msgs.length === 0 && !busy && <p className="ai-empty">Hỏi bất cứ điều gì về tài liệu này, hoặc bấm một nút ở trên. Câu trả lời có ghi nguồn trang; bấm vào nguồn để nhảy tới trang đó.</p>}
            {msgs.map((m, i) => (
              <div key={i} className={`ai-msg ${m.role}`}>
                {m.role === "user" ? (
                  <><span className="ai-who">Bạn{m.pages ? ` · ${m.pages}` : ""}</span><p>{m.content}</p></>
                ) : (
                  <>
                    <span className="ai-who">AI<button className="btn ghost sm" onClick={() => { void navigator.clipboard.writeText(m.content); toast.success("Đã sao chép"); }}>Sao chép</button></span>
                    <p>{splitCitations(m.content, info?.page_count ?? 0).map((part, j) =>
                      "page" in part
                        ? <button key={j} className="ai-cite" onClick={() => goToPage(part.page)}>{part.label}</button>
                        : <span key={j}>{part.text}</span>)}</p>
                  </>
                )}
              </div>
            ))}
            {busy && <p className="ai-msg assistant" role="status">AI đang đọc và trả lời…</p>}
            {error && <p role="alert" className="notice err">{error}</p>}
            <div ref={endRef} />
          </div>

          <form className="ai-ask" onSubmit={(e) => { e.preventDefault(); void run("ask"); }}>
            <textarea aria-label="Câu hỏi về tài liệu" rows={2} value={question} disabled={!info} placeholder="Hỏi về tài liệu… (Enter để gửi)"
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void run("ask"); } }} />
            <div className="ai-ask-row">
              {msgs.length > 0 && <button type="button" className="btn ghost sm" onClick={() => { save([]); if (path) db.removeItem(HIST_KEY(path)); }}>Xoá lịch sử</button>}
              <span className="spacer" />
              <button className="btn primary" type="submit" disabled={disabled || !question.trim()}>Gửi</button>
            </div>
          </form>
        </>
      )}
    </aside>
  );
}
