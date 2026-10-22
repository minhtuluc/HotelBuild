import type { Session } from '../session';

/**
 * Báo khi **ngữ cảnh làm việc** đổi (đăng nhập/đăng xuất, đổi cơ sở). Làm mới token im lặng cũng phát tín hiệu
 * của `Session` — ví dụ khi `pin/verify` nhận 401 — nhưng không đổi người hay cơ sở, nên bị bỏ qua để màn đang
 * mở (PIN đã nhập, form) không bị xoá oan.
 */
export function watchContext(session: Session, onChange: () => void): () => void {
  let authenticated = session.hasAccessToken();
  let property = session.selectedProperty();
  return session.subscribe(() => {
    const nextAuthenticated = session.hasAccessToken();
    const nextProperty = session.selectedProperty();
    if (nextAuthenticated === authenticated && nextProperty === property) return;
    authenticated = nextAuthenticated;
    property = nextProperty;
    onChange();
  });
}
