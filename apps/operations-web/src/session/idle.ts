/**
 * Đếm nhàn rỗi phía client (QĐ-03 quyết định 2): 15 phút không thao tác thì đưa về đăng nhập. Máy chủ vẫn
 * là nguồn quyết định phiên; đây chỉ để người rời máy không để phiên mở. `touch()` rất rẻ (chỉ ghi mốc), một
 * bộ hẹn giờ duy nhất đặt lại theo phần còn lại — không tạo/huỷ timer cho mỗi lần di chuột.
 */
export const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

export interface IdleWatcher {
  start(): void;
  stop(): void;
  /** Ghi nhận thao tác của người dùng. */
  touch(): void;
  /** Kiểm ngay (máy ngủ qua hạn, tab được hiện lại). */
  check(): void;
}

export function createIdleWatcher(options: {
  timeoutMs?: number;
  onIdle: () => void;
  now?: () => number;
}): IdleWatcher {
  const timeoutMs = options.timeoutMs ?? IDLE_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  let last = now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;

  const arm = (delay: number): void => {
    clearTimeout(timer);
    timer = setTimeout(check, Math.max(1, delay));
  };
  function check(): void {
    if (!running) return;
    const remaining = timeoutMs - (now() - last);
    if (remaining > 0) {
      arm(remaining);
      return;
    }
    running = false;
    clearTimeout(timer);
    timer = undefined;
    options.onIdle();
  }
  return {
    start: () => {
      running = true;
      last = now();
      arm(timeoutMs);
    },
    stop: () => {
      running = false;
      clearTimeout(timer);
      timer = undefined;
    },
    touch: () => {
      if (running) last = now();
    },
    check,
  };
}
