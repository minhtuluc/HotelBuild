'use client';
/**
 * Trạng thái đăng nhập trên header của mọi trang khách (HB-324, TD-42).
 *
 * Đọc cookie gợi ý `pinehill_guest_signed` do BFF phiên đặt/xoá cùng cookie refresh, **không** gọi
 * `/api/session/refresh` khi tải trang: khách chưa đăng nhập không phát yêu cầu nào, và nhiều tab không làm
 * mới chồng nhau. Cookie chỉ là gợi ý hiển thị; quyền truy cập vẫn do máy chủ quyết (trang hồ sơ, đơn của
 * tôi tự kiểm phiên). Phiên đã hết ở máy chủ thì lần làm mới thất bại kế tiếp xoá cookie gợi ý.
 *
 * Dựng ở máy chủ luôn ra trạng thái "chưa đăng nhập" (link "Tài khoản") để HTML giống nhau giữa hai lần
 * dựng; sau khi tải mới đọc cookie.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { guestSignedHint } from '@pinehill/web-session/client';
import { useAccountText, useT } from '../i18n/client';
import { guestSession, subscribeSignedIn } from '../session/guest-session';
import { LocaleLink as Link } from './locale-link';

export function HeaderAccount(): ReactElement {
  const t = useT();
  const text = useAccountText();
  const [signedIn, setSignedIn] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSignedIn(guestSignedHint());
    // Đăng nhập/đăng xuất ngay trong trang (hoặc ở tab khác): BFF đã đổi cookie gợi ý, đọc lại.
    return subscribeSignedIn(() => {
      setSignedIn(guestSignedHint());
    });
  }, []);

  async function logout(): Promise<void> {
    setBusy(true);
    try {
      await guestSession().logout();
    } catch {
      // Cookie phiên và gợi ý đã được BFF xoá kể cả khi máy chủ chưa xác nhận thu hồi.
    } finally {
      setBusy(false);
      setSignedIn(guestSignedHint());
    }
  }

  if (!signedIn)
    return (
      <Link href="/account/login" className="ph-nav-link" data-testid="header-account">
        {t('guest.nav.account')}
      </Link>
    );
  return (
    <>
      <Link href="/profile" className="ph-nav-link" data-testid="header-profile">
        {t('guest.nav.profile')}
      </Link>
      <button
        type="button"
        className="ph-nav-link ph-nav-button"
        data-testid="header-logout"
        disabled={busy}
        onClick={() => void logout()}
      >
        {busy ? text('loggingOut') : text('logout')}
      </button>
    </>
  );
}
