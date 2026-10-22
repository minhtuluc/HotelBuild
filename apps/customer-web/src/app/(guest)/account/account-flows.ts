/**
 * SCR-08 — luồng gửi của bốn biểu mẫu, tách khỏi giao diện để kiểm bằng vitest. Mỗi luồng: kiểm hình dạng
 * nhập (báo lỗi theo trường, không gửi gì), gọi lệnh qua cổng `FlowDeps`, rồi phân loại kết quả. Không có
 * luật nghiệp vụ ở đây: máy chủ quyết SĐT trùng, mật khẩu đúng, khoá tài khoản và hạn của token.
 */
import {
  failureOf,
  forgotIssues,
  loginIssues,
  normalizePhone,
  registerIssues,
  resetIssues,
  toRegisterRequest,
  type AccountFailure,
  type Issues,
  type RegisterForm,
} from './account-model';

export interface FlowDeps {
  register: (body: ReturnType<typeof toRegisterRequest>) => Promise<void>;
  /** Đăng nhập qua proxy phiên (`/api/session/login`); `phone` đã ở dạng `+84…`. */
  login: (phone: string, password: string) => Promise<unknown>;
  requestReset: (phone: string) => Promise<void>;
  confirmReset: (token: string, newPassword: string) => Promise<void>;
}

export type FlowOutcome<K extends string, Extra = never> =
  | { readonly kind: 'issues'; readonly issues: Issues<K> }
  | { readonly kind: 'failed'; readonly failure: AccountFailure }
  | Extra;

const hasIssues = (issues: object): boolean => Object.keys(issues).length > 0;

function canonical(raw: string): string {
  const phone = normalizePhone(raw);
  if (phone === null) throw new RangeError('Invalid phone');
  return phone;
}

export type RegisterOutcome = FlowOutcome<
  'fullName' | 'phone' | 'email' | 'password',
  { readonly kind: 'done' } | { readonly kind: 'createdNotSignedIn' }
>;

export async function runRegister(form: RegisterForm, deps: FlowDeps): Promise<RegisterOutcome> {
  const issues = registerIssues(form);
  if (hasIssues(issues)) return { kind: 'issues', issues };
  const body = toRegisterRequest(form);
  try {
    await deps.register(body);
  } catch (caught) {
    return { kind: 'failed', failure: failureOf(caught) };
  }
  try {
    await deps.login(body.phone, body.password);
  } catch {
    // Tài khoản đã được máy chủ tạo: đây không phải "đăng ký thất bại" mà là chưa đăng nhập được.
    return { kind: 'createdNotSignedIn' };
  }
  return { kind: 'done' };
}

export type LoginOutcome = FlowOutcome<'phone' | 'password', { readonly kind: 'done' }>;

export async function runLogin(
  form: { readonly phone: string; readonly password: string },
  deps: FlowDeps,
): Promise<LoginOutcome> {
  const issues = loginIssues(form);
  if (hasIssues(issues)) return { kind: 'issues', issues };
  try {
    await deps.login(canonical(form.phone), form.password);
  } catch (caught) {
    return { kind: 'failed', failure: failureOf(caught) };
  }
  return { kind: 'done' };
}

export type ForgotOutcome = FlowOutcome<'phone', { readonly kind: 'sent' }>;

/** `sent` luôn cùng một thông báo: màn hình không biết (và không được tiết lộ) SĐT có tài khoản hay không. */
export async function runForgot(
  form: { readonly phone: string },
  deps: FlowDeps,
): Promise<ForgotOutcome> {
  const issues = forgotIssues(form);
  if (hasIssues(issues)) return { kind: 'issues', issues };
  try {
    await deps.requestReset(canonical(form.phone));
  } catch (caught) {
    return { kind: 'failed', failure: failureOf(caught) };
  }
  return { kind: 'sent' };
}

export type ResetOutcome = FlowOutcome<'token' | 'password' | 'confirm', { readonly kind: 'done' }>;

export async function runReset(
  form: { readonly token: string; readonly password: string; readonly confirm: string },
  deps: FlowDeps,
): Promise<ResetOutcome> {
  const issues = resetIssues(form);
  if (hasIssues(issues)) return { kind: 'issues', issues };
  try {
    await deps.confirmReset(form.token.trim(), form.password);
  } catch (caught) {
    return { kind: 'failed', failure: failureOf(caught) };
  }
  return { kind: 'done' };
}
