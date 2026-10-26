// Logic thuần của màn hình Chuyển đổi và OCR: tách khỏi giao diện để kiểm thử được.
import type { ConvertItemResult, ConvertTarget } from "./api";

export type InputKind = "pdf" | "image" | "office" | "other";

const IMAGE_EXT = ["jpg", "jpeg", "png", "gif", "bmp", "tif", "tiff", "webp"];
const OFFICE_EXT = ["doc", "docx", "docm", "odt", "rtf", "txt", "html", "htm", "xls", "xlsx", "xlsm", "ods", "csv", "ppt", "pptx", "pptm", "odp"];

export const extOf = (name: string) => (name.match(/\.([^.\\/]+)$/)?.[1] ?? "").toLowerCase();
export const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** Phân loại theo đuôi file, khớp `classify` ở Rust. */
export function kindOf(path: string): InputKind {
  const e = extOf(path);
  if (e === "pdf") return "pdf";
  if (IMAGE_EXT.includes(e)) return "image";
  if (OFFICE_EXT.includes(e)) return "office";
  return "other";
}

export type TargetInfo = {
  id: ConvertTarget; group: "to_pdf" | "from_pdf" | "ocr"; label: string; desc: string;
  /** Loại file đầu vào chấp nhận. */
  accepts: InputKind[]; ext: string[];
};

export const TARGETS: TargetInfo[] = [
  { id: "to_pdf", group: "to_pdf", label: "Sang PDF", desc: "Word, Excel, PowerPoint, văn bản, HTML, ảnh", accepts: ["office", "image", "pdf"], ext: [...OFFICE_EXT, ...IMAGE_EXT] },
  { id: "docx", group: "from_pdf", label: "Word (.docx)", desc: "Giữ bố cục gần giống bản gốc", accepts: ["pdf"], ext: ["pdf"] },
  { id: "xlsx", group: "from_pdf", label: "Excel (.xlsx)", desc: "Mỗi trang một sheet, chữ chia ô theo vị trí", accepts: ["pdf"], ext: ["pdf"] },
  { id: "pptx", group: "from_pdf", label: "PowerPoint (.pptx)", desc: "Mỗi trang một slide", accepts: ["pdf"], ext: ["pdf"] },
  { id: "png", group: "from_pdf", label: "Ảnh PNG", desc: "Mỗi trang một ảnh, nét, không mất chất lượng", accepts: ["pdf"], ext: ["pdf"] },
  { id: "jpg", group: "from_pdf", label: "Ảnh JPEG", desc: "Mỗi trang một ảnh, nhẹ hơn PNG", accepts: ["pdf"], ext: ["pdf"] },
  { id: "txt", group: "from_pdf", label: "Văn bản (.txt)", desc: "Chỉ lấy chữ", accepts: ["pdf"], ext: ["pdf"] },
  { id: "html", group: "from_pdf", label: "Trang web (.html)", desc: "Chữ theo từng trang", accepts: ["pdf"], ext: ["pdf"] },
  { id: "ocr", group: "ocr", label: "OCR: nhận dạng chữ", desc: "Biến ảnh hoặc PDF quét thành PDF tìm kiếm được", accepts: ["image", "pdf"], ext: ["pdf", ...IMAGE_EXT] },
];

export const targetInfo = (t: ConvertTarget) => TARGETS.find((x) => x.id === t)!;

export const GROUP_LABEL = { to_pdf: "Tạo PDF", from_pdf: "Chuyển từ PDF sang", ocr: "Nhận dạng chữ" } as const;

/** Chia file thành dùng được / không dùng được cho mục tiêu đã chọn. `to_pdf` + PDF/A cũng nhận PDF. */
export function splitByTarget(target: ConvertTarget, pdfa: boolean, paths: string[]): { ok: string[]; rejected: string[] } {
  const accepts = targetInfo(target).accepts.filter((k) => k !== "pdf" || target !== "to_pdf" || pdfa);
  const ok: string[] = [], rejected: string[] = [];
  for (const p of paths) (accepts.includes(kindOf(p)) ? ok : rejected).push(p);
  return { ok, rejected };
}

/** Việc này có cần LibreOffice không (giống `needs_office` ở Rust). */
export function needsOffice(target: ConvertTarget, pdfa: boolean, paths: string[]): boolean {
  if (target === "docx" || target === "pptx") return true;
  return target === "to_pdf" && (pdfa || paths.some((p) => kindOf(p) === "office"));
}

export const needsOcr = (target: ConvertTarget) => target === "ocr";

export const dirOf = (path: string) => {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i < 0 ? "" : path.slice(0, i);
};

export const OCR_LANGS: { id: string; label: string }[] = [
  { id: "vie+eng", label: "Tiếng Việt + tiếng Anh" },
  { id: "vie", label: "Chỉ tiếng Việt" },
  { id: "eng", label: "Chỉ tiếng Anh" },
];

export const DPI_CHOICES = [100, 150, 200, 300];

export type Summary = { done: number; failed: number; outputs: string[] };
export function summarize(results: ConvertItemResult[]): Summary {
  return {
    done: results.filter((r) => !r.error).length,
    failed: results.filter((r) => r.error).length,
    outputs: results.flatMap((r) => r.outputs),
  };
}

export const needsInstall = (msg: string, which: "OFFICE_MISSING" | "OCR_MISSING") => msg.includes(which);
