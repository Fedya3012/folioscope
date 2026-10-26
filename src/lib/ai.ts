/** Trợ lý AI: dựng câu lệnh, che dữ liệu nhạy cảm và đọc phần trích trang trong câu trả lời. */

export const AI_MODELS: [id: string, label: string][] = [
  ["claude-sonnet-5-5", "Cân bằng (Sonnet 5.5)"],
  ["claude-haiku-5-5", "Nhanh và rẻ (Haiku 5.5)"],
  ["claude-opus-5-5", "Mạnh nhất (Opus 5.5)"],
];
export const DEFAULT_AI_MODEL = AI_MODELS[0][0];

export type AiTask = "ask" | "summary" | "translate" | "rewrite" | "table";
export type AiScope = "doc" | "page";
export type ChatMsg = { role: "user" | "assistant"; content: string; task?: AiTask; pages?: string };

/** Giới hạn chữ gửi đi mỗi lần (khoảng 40 nghìn từ), để khỏi vượt cỡ ngữ cảnh và tốn tiền. */
export const MAX_CONTEXT_CHARS = 150_000;

/** Che số thẻ, CMND/CCCD và email trước khi gửi qua mạng. */
export function redactSensitive(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[email]")
    .replace(/\b(?:\d[ -]?){12,18}\d\b/g, (m) => (m.replace(/\D/g, "").length >= 13 ? "[số thẻ]" : m))
    .replace(/(?<![\d-])\d{12}(?![\d-])/g, "[số CCCD]")
    .replace(/(?<![\d-])\d{9}(?![\d-])/g, "[số CMND]");
}

/** Ghép chữ các trang `from..to` (đếm từ 0) thành một khối có đánh dấu số trang. */
export function buildContext(pages: string[], from: number, to: number, redact: boolean, maxChars = MAX_CONTEXT_CHARS) {
  let out = "", truncated = false, last = from - 1;
  for (let i = Math.max(0, from); i <= Math.min(to, pages.length - 1); i++) {
    const body = (redact ? redactSensitive(pages[i]) : pages[i]).trim();
    const block = `[Trang ${i + 1}]\n${body || "(trang không có chữ)"}\n\n`;
    if (out.length + block.length > maxChars) { truncated = true; break; }
    out += block; last = i;
  }
  return { text: out.trimEnd(), truncated, lastPage: last };
}

const SYSTEM = [
  "Bạn là trợ lý đọc tài liệu trong ứng dụng Folioscope. Người dùng gửi chữ trích từ một file PDF, mỗi trang bắt đầu bằng dòng [Trang N].",
  "Trả lời bằng tiếng Việt, trừ khi nhiệm vụ yêu cầu ngôn ngữ khác.",
  "Chỉ dựa vào nội dung tài liệu; nếu tài liệu không có thông tin thì nói rõ là không thấy trong tài liệu.",
  "Khi nêu một ý lấy từ tài liệu, ghi nguồn ngay sau ý đó theo dạng [tr. N] (N là số trang), ví dụ [tr. 3].",
  "Không dùng Markdown phức tạp: chỉ dùng đoạn văn, gạch đầu dòng bắt đầu bằng dấu - và bảng dạng văn bản thô khi được yêu cầu.",
].join("\n");

export type Prompt = { system: string; user: string };

export function buildPrompt(task: AiTask, context: string, opts: { question?: string; language?: string; style?: string; truncated?: boolean }): Prompt {
  const note = opts.truncated ? "\n(Lưu ý: tài liệu dài nên chỉ gửi phần đầu.)" : "";
  const doc = `<tai_lieu>\n${context}\n</tai_lieu>${note}\n\n`;
  const ask = {
    ask: `Câu hỏi: ${opts.question ?? ""}`,
    summary: "Hãy tóm tắt tài liệu: một đoạn 2-3 câu nêu ý chính, rồi 5-8 gạch đầu dòng cho các ý quan trọng, mỗi ý ghi nguồn trang.",
    translate: `Hãy dịch toàn bộ nội dung sang ${opts.language || "tiếng Anh"}. Giữ nguyên các dòng [Trang N] làm tiêu đề từng phần. Không thêm bình luận.`,
    rewrite: `Hãy viết lại nội dung cho ${opts.style || "rõ ràng và ngắn gọn hơn"}, giữ nguyên ý và số liệu. Giữ các dòng [Trang N] làm tiêu đề từng phần.`,
    table: "Hãy tìm các bảng hoặc dữ liệu dạng bảng trong tài liệu và trích ra dạng bảng văn bản thô, các cột cách nhau bằng dấu | , mỗi bảng có một dòng tiêu đề ghi nguồn trang. Nếu không có bảng thì nói rõ.",
  }[task];
  return { system: SYSTEM, user: doc + ask };
}

export type ReplyPart = { text: string } | { page: number; label: string };

/** Tách câu trả lời thành chữ và các nguồn trang: [tr. 3], [trang 3], [tr. 3-5], [tr. 3, 7]. Trả `page` đếm từ 0. */
export function splitCitations(reply: string, pageCount: number): ReplyPart[] {
  const re = /\[(?:tr\.?|trang|p\.?|page)\s*(\d+(?:\s*[-–,]\s*\d+)*)\]/gi;
  const parts: ReplyPart[] = [];
  let at = 0;
  for (const m of reply.matchAll(re)) {
    const first = Number(m[1].match(/\d+/)![0]);
    if (first < 1 || first > pageCount) continue;
    if (m.index > at) parts.push({ text: reply.slice(at, m.index) });
    parts.push({ page: first - 1, label: m[0] });
    at = m.index + m[0].length;
  }
  if (at < reply.length) parts.push({ text: reply.slice(at) });
  return parts;
}

/** Lịch sử gửi lên mô hình: cặp hỏi–đáp trước đó (chỉ chữ), không kèm lại cả tài liệu. */
export function historyForModel(history: ChatMsg[], limit = 6): { role: "user" | "assistant"; content: string }[] {
  return history.slice(-limit).map((m) => ({ role: m.role, content: m.content }));
}
