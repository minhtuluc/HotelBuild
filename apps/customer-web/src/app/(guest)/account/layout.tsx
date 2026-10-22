import type { ReactElement, ReactNode } from 'react';
import { SessionStatus } from './session-status';

/**
 * Khung riêng của khu `/account` (SCR-08): đầu trang trạng thái đăng nhập + đăng xuất. Đặt ở đây thay vì
 * `(guest)/layout.tsx` để không thêm lần làm mới phiên vào mọi trang khách khác (tránh hồi quy các luồng
 * đặt phòng/hồ sơ đang dùng phiên); 360 px không cuộn ngang.
 */
export default function AccountLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <div
      style={{
        boxSizing: 'border-box',
        maxWidth: 480,
        margin: '0 auto',
        padding: 'var(--space-s4, 16px)',
        display: 'grid',
        gap: 'var(--space-s4, 16px)',
      }}
    >
      <SessionStatus />
      {children}
    </div>
  );
}
