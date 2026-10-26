import { renderPage } from "./api";

// Hình thu nhỏ vẽ theo vài cỡ cố định để kéo thanh trượt không phải vẽ lại từng trang.
const BUCKETS = [160, 256, 384, 512, 768];
const cache = new Map<string, string>();
const MAX_CACHE = 600;
const MAX_PARALLEL = 3;

export const bucketFor = (px: number) => BUCKETS.find((b) => b >= px) ?? BUCKETS[BUCKETS.length - 1];
const keyOf = (path: string, index: number, width: number) => `${path}\u0000${index}\u0000${width}`;

/** Ảnh đã có sẵn trong bộ nhớ đệm (dùng cho hình khi đang kéo). */
export const cachedThumb = (path: string, index: number, width: number) => cache.get(keyOf(path, index, width));

/** Bỏ ảnh đệm của một file (khi file vừa bị ghi đè). */
export function clearThumbs(path: string) {
  for (const k of [...cache.keys()]) if (k.startsWith(`${path}\u0000`)) cache.delete(k);
}

type Job = { run: () => void; cancelled: boolean };
const queue: Job[] = [];
let running = 0;

function pump() {
  while (running < MAX_PARALLEL && queue.length) {
    const job = queue.shift()!;
    if (job.cancelled) continue;
    running++;
    job.run();
  }
}

/** Xin ảnh trang; trả về hàm huỷ. Ảnh đã đệm được trả ngay. */
export function requestThumb(
  path: string, index: number, width: number,
  onDone: (src: string) => void, onFail: () => void,
): () => void {
  const key = keyOf(path, index, width);
  const hit = cache.get(key);
  if (hit) { onDone(hit); return () => {}; }
  const job: Job = {
    cancelled: false,
    run: () => {
      renderPage(path, index, width)
        .then((r) => {
          const src = `data:image/png;base64,${r.png_base64}`;
          if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string);
          cache.set(key, src);
          if (!job.cancelled) onDone(src);
        })
        .catch(() => { if (!job.cancelled) onFail(); })
        .finally(() => { running--; pump(); });
    },
  };
  queue.push(job);
  pump();
  return () => { job.cancelled = true; };
}
