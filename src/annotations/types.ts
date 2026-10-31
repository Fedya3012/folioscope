// Mọi toạ độ là tỉ lệ 0..1 trên trang (gốc ở góc trên trái), nên không đổi khi zoom.
export type Pt = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

export type Kind =
  | "highlight" | "underline" | "strikeout"
  | "note" | "text"
  | "rect" | "ellipse" | "line" | "arrow" | "ink"
  | "stamp" | "distance" | "perimeter" | "area";

export interface Reply { id: string; author: string; at: number; text: string }
export type Status = "open" | "resolved";

export type Tool = "select" | Kind;

export interface Annotation {
  id: string;
  page: number;
  kind: Kind;
  color: string;
  strokeWidth: number; // px ở zoom 100%
  rect?: Rect;          // highlight, underline, strikeout, note, text, rect, ellipse
  points?: Pt[];        // line, arrow, ink
  text?: string;        // note, text
  /** Highlight/underline/strikeout bám dòng chữ: mỗi dòng một hình chữ nhật (rect là hộp bao ngoài). */
  rects?: Rect[];
  opacity?: number;     // 0.1..1, mặc định theo loại
  author?: string;
  at?: number;          // thời điểm tạo (ms)
  status?: Status;      // bình luận: đang mở / đã giải quyết
  replies?: Reply[];
  stamp?: string;       // nhãn của tem
  label?: string;       // kết quả đo, vd "12,4 cm"
}

export const COLORS = ["#FFD60A", "#FF453A", "#30D158", "#3D63EE", "#BF5AF2", "#14171C"] as const;
export const DEFAULT_COLOR = COLORS[0];

/** Nhóm công cụ xoay vòng bằng Shift+U / Shift+D. */
export const MARKUP_CYCLE: Tool[] = ["highlight", "underline", "strikeout"];
export const DRAW_CYCLE: Tool[] = ["ink", "rect", "ellipse", "line", "arrow"];

export const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: "select", label: "Chọn", hint: "V" },
  { id: "highlight", label: "Tô sáng", hint: "U" },
  { id: "underline", label: "Gạch chân", hint: "" },
  { id: "strikeout", label: "Gạch ngang", hint: "" },
  { id: "note", label: "Ghi chú", hint: "S" },
  { id: "text", label: "Hộp văn bản", hint: "X" },
  { id: "rect", label: "Chữ nhật", hint: "R" },
  { id: "ellipse", label: "Elip", hint: "E" },
  { id: "line", label: "Đường thẳng", hint: "L" },
  { id: "arrow", label: "Mũi tên", hint: "A" },
  { id: "ink", label: "Vẽ tay", hint: "D" },
  { id: "stamp", label: "Tem", hint: "K" },
  { id: "distance", label: "Đo khoảng cách", hint: "M" },
  { id: "perimeter", label: "Đo chu vi", hint: "Shift+M" },
  { id: "area", label: "Đo diện tích", hint: "G" },
];

export const STAMPS: { label: string; color: string }[] = [
  { label: "ĐÃ DUYỆT", color: "#30D158" },
  { label: "TỪ CHỐI", color: "#FF453A" },
  { label: "NHÁP", color: "#3D63EE" },
  { label: "BẢO MẬT", color: "#FF453A" },
  { label: "ĐÃ GỬI", color: "#BF5AF2" },
  { label: "CẦN XEM LẠI", color: "#FF9F0A" },
];

export const isMarkup = (k: string) => k === "highlight" || k === "underline" || k === "strikeout";
export const isMeasure = (k: string) => k === "distance" || k === "perimeter" || k === "area";
export const isPolyMeasure = (k: string) => k === "perimeter" || k === "area";
export const hasThread = (k: string) => k === "note";

export const isRectKind = (k: Kind) => !(k === "line" || k === "arrow" || k === "ink" || isMeasure(k));
