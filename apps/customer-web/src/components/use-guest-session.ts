'use client';
/**
 * Phiên khách cho một màn hình: tạo một lần, huỷ khi màn hình rời đi (HB-309).
 *
 * Trước đây các màn tạo phiên trong `useMemo` và huỷ ở cleanup của effect. Ở chế độ dev, React StrictMode
 * chạy effect → cleanup → effect lại ngay trên cùng phiên: phiên đã bị huỷ nhưng vẫn được dùng tiếp, nên
 * SCR-04/05 và SCR-07 lỗi "Session client is disposed" (bản production không bị).
 *
 * Ở đây cleanup chỉ **hẹn** huỷ sang nhịp sau; nếu effect chạy lại ngay (StrictMode) thì bỏ hẹn và giữ phiên.
 * Rời màn thật thì không có lần chạy lại, phiên bị huỷ ở nhịp sau.
 */
import { useEffect, useRef, useState } from 'react';
import { createSessionClient } from '@pinehill/web-session/client';

export type GuestSession = ReturnType<typeof createSessionClient>;

function createGuestSession(): GuestSession {
  return createSessionClient({ kind: 'guest' });
}

export function useGuestSession(): GuestSession {
  const [session] = useState(createGuestSession);
  const pendingDispose = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (pendingDispose.current !== null) {
      clearTimeout(pendingDispose.current);
      pendingDispose.current = null;
    }
    return () => {
      pendingDispose.current = setTimeout(() => {
        pendingDispose.current = null;
        session.dispose();
      }, 0);
    };
  }, [session]);
  return session;
}
