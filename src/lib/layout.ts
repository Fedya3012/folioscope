/** Giới hạn bề rộng panel theo bản thiết kế: trái 200–420 (mặc định 260), phải 280–480 (mặc định 320). */
export const LEFT = { min: 200, max: 420, def: 260 } as const;
export const RIGHT = { min: 280, max: 480, def: 320 } as const;
/** Kéo nhỏ hơn mức này thì panel tự thu gọn (snap). */
export const SNAP_CLOSE = 160;

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export type PanelResult = { open: boolean; width: number };

export function resolvePanelWidth(raw: number, limits: { min: number; max: number; def: number }): PanelResult {
  if (raw < SNAP_CLOSE) return { open: false, width: limits.def };
  return { open: true, width: clamp(raw, limits.min, limits.max) };
}

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 8;
export const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const;

export function stepZoom(current: number, dir: 1 | -1): number {
  const next = dir === 1 ? ZOOM_STEPS.find((z) => z > current + 1e-6) : [...ZOOM_STEPS].reverse().find((z) => z < current - 1e-6);
  return clamp(next ?? current, ZOOM_MIN, ZOOM_MAX);
}
