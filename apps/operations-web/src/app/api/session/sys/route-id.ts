/**
 * Giải mã id trên tuyến động của BFF phiên (HB-201): chấp nhận một đoạn pathname đã mã hoá, từ chối
 * chuỗi rỗng, `.`/`..`, hoặc chứa `/`/`\` trước khi dựng lại path chuyển tiếp (cùng nguyên tắc
 * `decodedId` ở `web-session`).
 */
export function decodedId(value: string): string | undefined {
  let id: string;
  try {
    id = decodeURIComponent(value);
  } catch {
    return undefined;
  }
  if (id === '.' || id === '..' || id.includes('/') || id.includes('\\') || !id.trim())
    return undefined;
  return id;
}
