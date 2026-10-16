/**
 * Sinh CSV cho báo cáo xuất bất đồng bộ (HB-163).
 *
 * Chuẩn áp dụng:
 * - RFC 4180: ô chứa `,`, `"` hoặc xuống dòng thì bọc trong nháy kép và nhân đôi
 *   nháy kép bên trong; bản ghi cách nhau bằng CRLF.
 * - BOM UTF-8 ở đầu tệp để Excel (Windows, bản tiếng Việt) nhận đúng bảng mã;
 *   không có BOM thì Excel đoán ANSI và tiếng Việt thành ký tự rác.
 * - CSV không có kiểu dữ liệu nên Excel diễn giải ô bắt đầu bằng `=`/`+`/`-`/`@`
 *   thành công thức (formula injection, CWE-1236). Tiền tố nháy đơn buộc Excel
 *   coi ô là văn bản — giữ đúng quy ước đã dùng ở API/tầng web.
 */

const BOM = '\uFEFF';
const CRLF = '\r\n';

/** Ô bắt đầu bằng ký tự mở công thức, kể cả khi có khoảng trắng/BOM đứng trước. */
const FORMULA_START = /^[\s\uFEFF]*[=+\-@]/;

/** Ô cần bọc nháy kép theo RFC 4180. */
const NEEDS_QUOTING = /[",\r\n]/;

function csvCell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return NEEDS_QUOTING.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** CSV có BOM + tiêu đề cột; mỗi bản ghi (kể cả bản ghi cuối) kết thúc bằng CRLF. */
export function toCsv(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const lines = [headers, ...rows].map((cells) => cells.map(csvCell).join(','));
  return `${BOM}${lines.join(CRLF)}${CRLF}`;
}
