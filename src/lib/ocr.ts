import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { ocrInstall, ocrInstallCancel, ocrInstallSupported, ocrStatus, type OcrProgress } from "./api";

/** Tesseract (OCR) không đóng kèm: lần đầu cần thì hỏi rồi tải về. Cùng cách làm với bộ chuyển đổi Office. */
type Phase = "ask" | "installing" | "error";

type State = { phase: Phase | null; supported: boolean; progress: OcrProgress | null; error: string | null };

export const useOcr = create<State>(() => ({ phase: null, supported: true, progress: null, error: null }));

let waiting: ((ok: boolean) => void) | null = null;
let current: Promise<boolean> | null = null;

const close = (ok: boolean) => {
  useOcr.setState({ phase: null, progress: null, error: null });
  const done = waiting;
  waiting = null;
  current = null;
  done?.(ok);
};

/** Bảo đảm máy có Tesseract: có sẵn thì `true` ngay; chưa có thì hỏi cài. `false` nếu từ chối, huỷ hoặc lỗi. */
export function ensureOcr(): Promise<boolean> {
  if (current) return current;
  current = (async () => {
    try {
      if (await ocrStatus()) return true;
    } catch { /* coi như chưa có */ }
    const supported = await ocrInstallSupported().catch(() => false);
    useOcr.setState({ phase: "ask", supported, progress: null, error: null });
    return new Promise<boolean>((resolve) => { waiting = resolve; });
  })().finally(() => { if (!waiting) current = null; });
  return current;
}

export async function startOcrInstall() {
  useOcr.setState({ phase: "installing", progress: { stage: "find", percent: null, downloaded: 0, total: 0 }, error: null });
  const off = await listen<OcrProgress>("ocr-install-progress", (e) => useOcr.setState({ progress: e.payload }));
  try {
    await ocrInstall();
    close(true);
  } catch (e) {
    const msg = String(e);
    if (msg === "đã huỷ") close(false);
    else useOcr.setState({ phase: "error", error: msg });
  } finally {
    off();
  }
}

export function cancelOcrInstall() {
  if (useOcr.getState().phase === "installing") void ocrInstallCancel();
  else close(false);
}

export const dismissOcr = () => close(false);
