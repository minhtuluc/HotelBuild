import type { MailMessage } from '../../../../infrastructure/mail/mailer.js';
import { RESET_TOKEN_TTL_MS } from './token.js';

/** Thư đặt lại mật khẩu: chỉ một liên kết, không nêu SĐT/tên khách (NFR-SEC-03). */
export function resetMail(to: string, link: string): MailMessage {
  const minutes = RESET_TOKEN_TTL_MS / 60_000;
  return {
    to,
    subject: 'Đặt lại mật khẩu tài khoản Pine Hill',
    text: [
      'Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản Pine Hill của bạn.',
      '',
      `Mở liên kết sau trong ${minutes} phút để đặt mật khẩu mới (chỉ dùng được một lần):`,
      link,
      '',
      'Nếu bạn không yêu cầu, hãy bỏ qua thư này — mật khẩu hiện tại vẫn giữ nguyên.',
      'Bạn không có email đăng ký? Hãy liên hệ lễ tân khách sạn để được hỗ trợ.',
    ].join('\n'),
  };
}

/** Link tới customer web: `<GUEST_WEB_BASE_URL>/account/reset-password?token=…` (HB-023). */
export function resetLink(base: string, token: string): string {
  const url = new URL('account/reset-password', base.endsWith('/') ? base : `${base}/`);
  url.searchParams.set('token', token);
  return url.href;
}
