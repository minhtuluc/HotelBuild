/**
 * Nội suy `{tên}` cho danh mục câu chữ trên Android.
 * Bản song song của `makeTranslate` bên web (không chia sẻ mã giao diện giữa hai nền tảng —
 * kiến trúc §6); test đối chiếu hai bản cho cùng kết quả trên cùng đầu vào.
 */
export type TranslateFor<T extends Readonly<Record<string, string>>> = (
  key: keyof T & string,
  vars?: Readonly<Record<string, string | number>>,
) => string;

export function makeTranslate<T extends Readonly<Record<string, string>>>(
  catalog: T,
): TranslateFor<T> {
  return (key, vars) => {
    // Thiếu khoá thì hiện chính khoá đó, khớp hành vi với bản web.
    const template = catalog[key] ?? key;
    if (vars === undefined) return template;
    return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
      const value = vars[name];
      return value === undefined ? whole : String(value);
    });
  };
}
