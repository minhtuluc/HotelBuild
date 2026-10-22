/**
 * Cơ sở đang làm việc (QĐ-03 quyết định 9): lựa chọn giao diện, lưu ở `sessionStorage` (không phải bí mật,
 * mất khi đóng tab). Máy chủ vẫn cưỡng chế toàn bộ phạm vi được cấp (BR-RBAC-02) — đây chỉ là bộ lọc hiển thị.
 */
export const WORKING_PROPERTY_KEY = 'pinehill.ops.workingProperty';

export interface PropertyStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Chế độ riêng tư/chặn lưu trữ có thể ném lỗi: mọi truy cập đều có try/catch, màn hình vẫn chạy khi thiếu. */
export function readStoredProperty(storage: PropertyStorage | undefined): string | null {
  try {
    return storage?.getItem(WORKING_PROPERTY_KEY) ?? null;
  } catch {
    return null;
  }
}

export function storeProperty(storage: PropertyStorage | undefined, propertyId: string): void {
  try {
    storage?.setItem(WORKING_PROPERTY_KEY, propertyId);
  } catch {
    // Không lưu được thì lần mở sau hỏi lại; không chặn luồng.
  }
}

export function clearStoredProperty(storage: PropertyStorage | undefined): void {
  try {
    storage?.removeItem(WORKING_PROPERTY_KEY);
  } catch {
    // Như trên.
  }
}

export type PropertyChoice =
  | { readonly kind: 'auto'; readonly propertyId: string }
  | { readonly kind: 'restored'; readonly propertyId: string }
  | { readonly kind: 'choose' }
  | { readonly kind: 'none' };

/**
 * Một cơ sở → vào thẳng (không có gì để chọn, kể cả OWNER); nhiều cơ sở → chọn, trừ khi lựa chọn đã lưu
 * còn hợp lệ trong danh sách được cấp; không có cơ sở nào được cấp → `none`.
 */
export function resolveWorkingProperty(input: {
  choices: readonly string[];
  stored: string | null;
}): PropertyChoice {
  const { choices, stored } = input;
  if (choices.length === 0) return { kind: 'none' };
  if (stored !== null && choices.includes(stored)) return { kind: 'restored', propertyId: stored };
  if (choices.length === 1) return { kind: 'auto', propertyId: choices[0]! };
  return { kind: 'choose' };
}
