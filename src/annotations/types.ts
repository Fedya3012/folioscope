// Mọi toạ độ là tỉ lệ 0..1 trên trang (gốc ở góc trên trái), nên không đổi khi zoom.
export type Pt = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

export type Kind =
  | "highlight" | "underline" | "strikeout"
  | "note" | "text"
  | "rect" | "ellipse" | "line" | "arrow" | "ink";

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
}

export const COLORS = ["#FFD60A", "#FF453A", "#30D158", "#3D63EE", "#BF5AF2", "#14171C"] as const;
export const DEFAULT_COLOR = COLORS[0];

export const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: "select", label: "Chọn", hint: "V" },
  { id: "highlight", label: "Tô sáng", hint: "H" },
  { id: "underline", label: "Gạch chân", hint: "U" },
  { id: "strikeout", label: "Gạch ngang", hint: "S" },
  { id: "note", label: "Ghi chú", hint: "N" },
  { id: "text", label: "Hộp văn bản", hint: "T" },
  { id: "rect", label: "Chữ nhật", hint: "R" },
  { id: "ellipse", label: "Elip", hint: "O" },
  { id: "line", label: "Đường thẳng", hint: "L" },
  { id: "arrow", label: "Mũi tên", hint: "A" },
  { id: "ink", label: "Vẽ tay", hint: "P" },
];

export const isRectKind = (k: Kind) => k !== "line" && k !== "arrow" && k !== "ink";
