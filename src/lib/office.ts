import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { officeInstall, officeInstallCancel, officeInstallSupported, officeStatus, type OfficeProgress } from "./api";

/** Bộ chuyển đổi Word/Excel/PowerPoint (LibreOffice) không đóng kèm: lần đầu cần thì hỏi rồi tải về. */
type Phase = "ask" | "installing" | "error";

type State = {
  /** Hộp thoại đang mở (null = đóng). */
  phase: Phase | null;
  supported: boolean;
  progress: OfficeProgress | null;
  error: string | null;
};

export const useOffice = create<State>(() => ({ phase: null, supported: true, progress: null, error: null }));

let waiting: ((ok: boolean) => void) | null = null;
let current: Promise<boolean> | null = null;

const close = (ok: boolean) => {
  useOffice.setState({ phase: null, progress: null, error: null });
  const done = waiting;
  waiting = null;
  current = null;
  done?.(ok);
};

/**
 * Bảo đảm máy có LibreOffice: có sẵn thì trả `true` ngay; chưa có thì mở hộp thoại hỏi cài.
 * Trả `true` khi đã sẵn sàng, `false` nếu người dùng từ chối, huỷ hoặc cài lỗi.
 */
export function ensureOffice(): Promise<boolean> {
  if (current) return current;
  current = (async () => {
    try {
      if (await officeStatus()) return true;
    } catch { /* coi như chưa có */ }
    const supported = await officeInstallSupported().catch(() => false);
    useOffice.setState({ phase: "ask", supported, progress: null, error: null });
    return new Promise<boolean>((resolve) => { waiting = resolve; });
  })().finally(() => { if (!waiting) current = null; });
  return current;
}

/** Người dùng bấm "Cài đặt". */
export async function startInstall() {
  useOffice.setState({ phase: "installing", progress: { stage: "find", percent: null, downloaded: 0, total: 0 }, error: null });
  const off = await listen<OfficeProgress>("office-install-progress", (e) => useOffice.setState({ progress: e.payload }));
  try {
    await officeInstall();
    close(true);
  } catch (e) {
    const msg = String(e);
    if (msg === "đã huỷ") close(false);
    else useOffice.setState({ phase: "error", error: msg });
  } finally {
    off();
  }
}

export function cancelInstall() {
  const { phase } = useOffice.getState();
  if (phase === "installing") void officeInstallCancel(); // lệnh cài sẽ trả "đã huỷ" rồi tự đóng hộp
  else close(false);
}

/** Từ chối hoặc đóng hộp thoại khi chưa tải. */
export const dismissOffice = () => close(false);

export function formatMb(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

export function installStageLabel(p: OfficeProgress | null): string {
  if (!p) return "Đang bắt đầu…";
  switch (p.stage) {
    case "find": return "Đang tìm bản LibreOffice mới nhất…";
    case "download": return p.total > 0 ? `Đang tải ${formatMb(p.downloaded)} / ${formatMb(p.total)}` : "Đang tải…";
    case "verify": return "Đang kiểm tra file tải về…";
    case "extract": return "Đang cài đặt, có thể mất vài phút…";
    case "done": return "Hoàn tất";
  }
}
