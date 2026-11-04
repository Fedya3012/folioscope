import { printPdf } from "./api";
import { toast } from "./toast";
import { useStore, isDirty } from "../store";

/** In file đang mở bằng chương trình in của hệ điều hành. Thay đổi chưa lưu không có trong bản in. */
export async function printDocument() {
  const path = useStore.getState().path;
  if (!path) return;
  if (isDirty(path)) toast.warning("Bản in là file đã lưu; các thay đổi chưa lưu sẽ không có trong bản in");
  try { await printPdf(path); toast.info("Đã gửi file tới máy in"); } catch (e) { toast.error(String(e)); }
}
