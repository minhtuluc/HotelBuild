'use client';

/**
 * Đầu trang khu tài khoản: trạng thái đăng nhập + đăng xuất (SCR-08). Trạng thái chỉ để hiển thị; mọi
 * quyết định truy cập vẫn do máy chủ. Khách ẩn danh là trạng thái bình thường, không phải "hết phiên".
 */
import { useEffect, useState, type ReactElement } from 'react';
import { guestSession, isSignedIn, subscribeSignedIn } from '../../../session/guest-session';
import { useAccountText } from '../../../i18n/client';
import { useLocalePath } from '../../../i18n/client';

type Status = 'checking' | 'in' | 'out';

export function SessionStatus(): ReactElement {
  const localPath = useLocalePath();
  const text = useAccountText();
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
    <section
      aria-label={text('navLabel')}
      data-testid="account-status"
      className="ph-card"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '12px 16px',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 20px',
      }}
    >
      <nav aria-label={text('navLabel')} style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <a
          href={localPath('/')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            minHeight: 44,
            color: 'var(--color-text)',
            textDecoration: 'underline',
            textUnderlineOffset: 3,
          }}
        >
          {text('home')}
        </a>
        {status === 'in' ? (
          <a
            href={localPath('/profile')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              minHeight: 44,
              color: 'var(--color-primary)',
              textDecoration: 'underline',
              textUnderlineOffset: 3,
            }}
          >
            {text('profileLink')}
          </a>
        ) : null}
        {status === 'out' ? (
          <a
            href={localPath('/account/login')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              minHeight: 44,
              color: 'var(--color-primary)',
              textDecoration: 'underline',
              textUnderlineOffset: 3,
            }}
          >
            {text('loginLink')}
          </a>
        ) : null}
        {status === 'out' ? (
          <a
            href={localPath('/account/register')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              minHeight: 44,
              color: 'var(--color-primary)',
              textDecoration: 'underline',
              textUnderlineOffset: 3,
            }}
          >
            {text('registerLink')}
          </a>
        ) : null}
      </nav>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span
          role="status"
          data-testid="account-status-text"
          data-status={status}
          style={{ fontSize: 14, color: 'var(--color-textMuted)' }}
        >
          {status === 'checking' ? text('statusChecking') : null}
          {status === 'in' ? text('statusIn') : null}
          {status === 'out' ? text('statusOut') : null}
        </span>
        {status === 'in' ? (
          <button
            type="button"
            data-testid="account-logout"
            className="ph-btn"
            disabled={busy}
            onClick={() => void logout()}
          >
            {busy ? text('loggingOut') : text('logout')}
          </button>
        ) : null}
      </div>
      {partial ? (
        <p
          role="alert"
          data-testid="account-logout-partial"
          style={{ margin: 0, flexBasis: '100%', color: 'var(--color-danger)' }}
        >
          {text('logoutPartial')}
        </p>
      ) : null}
    </section>
  );
}
