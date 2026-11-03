import { db } from "./db";

const KEY = "folioscope.recentSearches", LIMIT = 8;

/** Thêm cụm vừa tìm lên đầu danh sách, bỏ trùng (không phân biệt hoa/thường) và giữ tối đa LIMIT cụm. */
export function addSearch(list: string[], query: string, limit = LIMIT): string[] {
  const q = query.trim();
  if (!q) return list;
  return [q, ...list.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, limit);
}

export const sanitizeSearches = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, LIMIT) : [];

export const getRecentSearches = () => sanitizeSearches(db.getJson(KEY));
export const pushRecentSearch = (q: string) => db.setJson(KEY, addSearch(getRecentSearches(), q));
export const clearRecentSearches = () => db.setJson(KEY, []);
