import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

export type UpdateInfo = { version: string; notes: string; handle: Update };

/** Hỏi máy chủ phát hành xem có bản mới không. Trả null khi đang dùng bản mới nhất. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const u = await check();
  return u ? { version: u.version, notes: (u.body ?? "").trim(), handle: u } : null;
}

/** Tải bản mới (báo tiến độ 0..1 nếu biết dung lượng), cài, rồi mở lại app. */
export async function installUpdate(info: UpdateInfo, onProgress: (frac: number | null) => void): Promise<void> {
  let total = 0, got = 0;
  await info.handle.downloadAndInstall((ev) => {
    if (ev.event === "Started") total = ev.data.contentLength ?? 0;
    else if (ev.event === "Progress") { got += ev.data.chunkLength; onProgress(total ? Math.min(1, got / total) : null); }
    else if (ev.event === "Finished") onProgress(1);
  });
  await relaunch();
}

export const appVersion = () => getVersion();

/** Lỗi mạng hay gặp nhất khi chưa có bản phát hành nào: nói bằng lời dễ hiểu. */
export function explainUpdateError(e: unknown): string {
  const t = String(e);
  if (/404|not found|valid release json|latest\.json/i.test(t)) return "Chưa có bản phát hành nào trên GitHub để so sánh.";
  if (/network|dns|connect|timed? ?out|error sending request/i.test(t)) return "Không kết nối được mạng. Kiểm tra internet rồi thử lại.";
  return `Không kiểm tra được bản mới: ${t}`;
}
