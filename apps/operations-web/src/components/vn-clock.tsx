'use client';

/**
 * Đồng hồ giờ Việt Nam trên dải bảng ga. Chỉ để định hướng (mọi mốc nghiệp vụ là giờ VN); không dùng để
 * tính hạn giữ chỗ hay mốc huỷ — các mốc đó do máy chủ trả.
 */
import { useEffect, useState, type ReactElement } from 'react';

const FORMAT = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function VnClock({ label }: { label: string }): ReactElement {
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    const tick = (): void => {
      setNow(FORMAT.format(new Date()));
    };
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => {
      window.clearInterval(id);
    };
  }, []);
  return (
    <span className="ph-clock">
      <span className="ph-clock-label">{label}</span>
      <time className="ph-clock-time" suppressHydrationWarning>
        {now ?? '--:--'}
      </time>
    </span>
  );
}
