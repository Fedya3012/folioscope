import { create } from "zustand";

/** Hoàn tác/Làm lại toàn cục. Có hai cách tham gia:
 *  1. `registerUndoScope`: tính năng đã có lịch sử riêng (Ghi chú, Trang) khai báo cách hoàn tác của nó; phạm vi nào đang `active` thì nhận Ctrl+Z.
 *  2. `pushUndo`: tính năng mới ghi từng thao tác (nhãn + cách hoàn tác + cách làm lại) vào ngăn xếp chung. */

export type UndoScope = { id: string; active(): boolean; canUndo(): boolean; canRedo(): boolean; undo(): void; redo(): void };
export type UndoEntry = { label: string; undo(): void; redo(): void };

const LIMIT = 200;
const scopes = new Map<string, UndoScope>();

type Stack = { past: UndoEntry[]; future: UndoEntry[] };
export const useUndoStack = create<Stack>(() => ({ past: [], future: [] }));

export function registerUndoScope(scope: UndoScope): () => void {
  scopes.set(scope.id, scope);
  return () => { if (scopes.get(scope.id) === scope) scopes.delete(scope.id); };
}

/** Ghi một thao tác đã làm xong. Làm thao tác mới thì xoá hàng đợi "làm lại". */
export function pushUndo(entry: UndoEntry) {
  useUndoStack.setState((s) => ({ past: [...s.past, entry].slice(-LIMIT), future: [] }));
}

export function clearUndo() { useUndoStack.setState({ past: [], future: [] }); }

const activeScope = (pick: (s: UndoScope) => boolean) => [...scopes.values()].find((s) => s.active() && pick(s));
/** Phạm vi đang hoạt động che ngăn xếp chung, kể cả khi nó hết bước (tránh hoàn tác nhầm thao tác ở nơi khác). */
const hasActive = () => [...scopes.values()].some((s) => s.active());

export function canUndo(): boolean {
  return hasActive() ? !!activeScope((s) => s.canUndo()) : useUndoStack.getState().past.length > 0;
}
export function canRedo(): boolean {
  return hasActive() ? !!activeScope((s) => s.canRedo()) : useUndoStack.getState().future.length > 0;
}

/** Trả `true` nếu đã hoàn tác được một bước. */
export function undo(): boolean {
  if (hasActive()) { const s = activeScope((x) => x.canUndo()); if (!s) return false; s.undo(); return true; }
  const { past, future } = useUndoStack.getState();
  const e = past[past.length - 1];
  if (!e) return false;
  useUndoStack.setState({ past: past.slice(0, -1), future: [e, ...future] });
  e.undo();
  return true;
}

export function redo(): boolean {
  if (hasActive()) { const s = activeScope((x) => x.canRedo()); if (!s) return false; s.redo(); return true; }
  const { past, future } = useUndoStack.getState();
  const e = future[0];
  if (!e) return false;
  useUndoStack.setState({ past: [...past, e], future: future.slice(1) });
  e.redo();
  return true;
}
