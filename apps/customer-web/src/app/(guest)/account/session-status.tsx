'use client';

/**
 * Đầu trang khu tài khoản: trạng thái đăng nhập + đăng xuất (SCR-08). Trạng thái chỉ để hiển thị; mọi
 * quyết định truy cập vẫn do máy chủ. Khách ẩn danh là trạng thái bình thường, không phải "hết phiên".
 */
import { useEffect, useState, type ReactElement } from 'react';
import { guestSession, isSignedIn, subscribeSignedIn } from '../../../session/guest-session';
import { accountText as text } from './messages';

type Status = 'checking' | 'in' | 'out';

export function SessionStatus(): ReactElement {
  const [status, setStatus] = useState<Status>('checking');
  const [busy, setBusy] = useState(false);
  const [partial, setPartial] = useState(false);

  useEffect(() => {
    let alive = true;
    const off = subscribeSignedIn((signedIn) => {
      if (alive) setStatus(signedIn ? 'in' : 'out');
    });
    void isSignedIn().then((signedIn) => {
      if (alive) setStatus(signedIn ? 'in' : 'out');
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  async function logout(): Promise<void> {
    setBusy(true);
    setPartial(false);
    try {
      await guestSession().logout();
    } catch {
      // Phiên cục bộ đã bị xoá (finally của client); chỉ báo rằng máy chủ chưa xác nhận thu hồi.
      setPartial(true);
    } finally {
      setBusy(false);
      setStatus('out');
    }
  }

  return (
    <header
      data-testid="account-status"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 'var(--space-s3, 12px)',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingBottom: 'var(--space-s3, 12px)',
        borderBottom: '1px solid var(--color-border, #E5E7EB)',
      }}
    >
      <nav aria-label={text('navLabel')} style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <a href="/">{text('home')}</a>
        {status === 'in' ? <a href="/profile">{text('profileLink')}</a> : null}
        {status === 'out' ? <a href="/account/login">{text('loginLink')}</a> : null}
        {status === 'out' ? <a href="/account/register">{text('registerLink')}</a> : null}
      </nav>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <span role="status" data-testid="account-status-text" data-status={status}>
          {status === 'checking' ? text('statusChecking') : null}
          {status === 'in' ? text('statusIn') : null}
          {status === 'out' ? text('statusOut') : null}
        </span>
        {status === 'in' ? (
          <button
            type="button"
            data-testid="account-logout"
            disabled={busy}
            onClick={() => void logout()}
            style={{ minHeight: 44, padding: '8px 12px' }}
          >
            {busy ? text('loggingOut') : text('logout')}
          </button>
        ) : null}
      </div>
      {partial ? (
        <p
          role="alert"
          data-testid="account-logout-partial"
          style={{ margin: 0, flexBasis: '100%' }}
        >
          {text('logoutPartial')}
        </p>
      ) : null}
    </header>
  );
}
