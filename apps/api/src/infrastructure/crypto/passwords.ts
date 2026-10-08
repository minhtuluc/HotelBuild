/**
 * Băm mật khẩu Argon2id (BR-RBAC-05, NFR-SEC-05). Tham số theo khuyến nghị OWASP hiện hành:
 * memoryCost 19 MiB, timeCost 2, parallelism 1 — **một chỗ** cho cả băm mới và băm giả chống dò tài khoản.
 * Không truyền `algorithm`: `Algorithm` là ambient const enum, `verbatimModuleSyntax` không cho dùng giá trị.
 */
import { hash, verify } from '@node-rs/argon2';

const PARAMETERS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

/** Hash dùng một lần cho tài khoản không tồn tại, để thời gian phản hồi tương đương sai mật khẩu. */
let dummyHash: string | undefined;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, PARAMETERS);
}

export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(storedHash, plain);
  } catch {
    // Hash hỏng/không đúng định dạng PHC coi như không khớp, không làm lộ chi tiết.
    return false;
  }
}

/** Kiểm mật khẩu cho **tài khoản không tồn tại**: chạy đúng chi phí băm như thật rồi trả `false`. */
export async function verifyAgainstDummyPassword(plain: string): Promise<false> {
  dummyHash ??= await hashPassword('dummy-password-for-timing-equalization');
  await verifyPassword(dummyHash, plain);
  return false;
}
