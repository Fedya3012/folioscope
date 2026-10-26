import type { Fit, ViewMode } from "./viewer";

export type ThemePref = "light" | "dark" | "system";
export type Accent = "cobalt" | "violet" | "teal" | "rose" | "amber" | "graphite";
export type Density = "comfortable" | "compact";
export type Startup = "home" | "last";
/** Zoom mặc định khi mở file: vừa bề rộng, vừa trang, hoặc đúng 100%. */
export type DefaultZoom = "width" | "page" | "actual";

export type Settings = {
  userName: string;
  startup: Startup;
  recentLimit: number;
  theme: ThemePref;
  accent: Accent;
  uiSize: 12 | 13 | 15 | 17;
  density: Density;
  reduceMotion: boolean;
  defaultZoom: DefaultZoom;
  defaultViewMode: ViewMode;
};

export const DEFAULT_SETTINGS: Settings = {
  userName: "", startup: "home", recentLimit: 20,
  theme: "system", accent: "cobalt", uiSize: 13, density: "comfortable", reduceMotion: false,
  defaultZoom: "width", defaultViewMode: "continuous",
};

export const ACCENTS: { id: Accent; label: string; swatch: string }[] = [
  { id: "cobalt", label: "Cobalt", swatch: "#3D63EE" },
  { id: "violet", label: "Violet", swatch: "#6B5BD6" },
  { id: "teal", label: "Teal", swatch: "#0E8F8A" },
  { id: "rose", label: "Rose", swatch: "#D6407A" },
  { id: "amber", label: "Amber", swatch: "#F5B700" },
  { id: "graphite", label: "Graphite", swatch: "#4A5262" },
];

export const UI_SIZES = [12, 13, 15, 17] as const;
export const RECENT_LIMITS = [10, 20, 50] as const;
const ZOOMS: DefaultZoom[] = ["width", "page", "actual"];
const VIEW_MODES: ViewMode[] = ["continuous", "single"];

const oneOf = <T,>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);

/** Đọc cài đặt từ dữ liệu lưu (có thể thiếu hoặc hỏng): giá trị lạ rơi về mặc định. */
export function sanitizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  return {
    userName: typeof r.userName === "string" ? r.userName.slice(0, 60) : d.userName,
    startup: oneOf(r.startup, ["home", "last"] as const, d.startup),
    recentLimit: oneOf(r.recentLimit, RECENT_LIMITS, d.recentLimit),
    theme: oneOf(r.theme, ["light", "dark", "system"] as const, d.theme),
    accent: oneOf(r.accent, ACCENTS.map((a) => a.id), d.accent),
    uiSize: oneOf(r.uiSize, UI_SIZES, d.uiSize),
    density: oneOf(r.density, ["comfortable", "compact"] as const, d.density),
    reduceMotion: typeof r.reduceMotion === "boolean" ? r.reduceMotion : d.reduceMotion,
    defaultZoom: oneOf(r.defaultZoom, ZOOMS, d.defaultZoom),
    defaultViewMode: oneOf(r.defaultViewMode, VIEW_MODES, d.defaultViewMode),
  };
}

export const resolveTheme = (pref: ThemePref, systemDark: boolean): "light" | "dark" =>
  pref === "system" ? (systemDark ? "dark" : "light") : pref;

/** Zoom/fit áp dụng khi mở file mới theo cài đặt. */
export function initialZoom(z: DefaultZoom): { zoom?: number; fit: Fit } {
  if (z === "actual") return { zoom: 1, fit: null };
  return { fit: z };
}

/** Lời chào theo giờ trong ngày. */
export function greeting(hour: number): string {
  if (hour < 5) return "Khuya rồi";
  if (hour < 11) return "Chào buổi sáng";
  if (hour < 13) return "Chào buổi trưa";
  if (hour < 18) return "Chào buổi chiều";
  return "Chào buổi tối";
}
