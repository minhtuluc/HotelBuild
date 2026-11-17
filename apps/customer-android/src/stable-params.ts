/**
 * HB-249: tham số route ổn định theo nội dung. Trên máy thật `useLocalSearchParams()` trả object mới mỗi lần
 * render; dùng thẳng làm dependency của `useMemo`/`useEffect` gây vòng tải lặp vô hạn.
 */
import { useMemo } from 'react';
import { useLocalSearchParams } from 'expo-router';

type RawParams = Readonly<Record<string, string | readonly string[] | undefined>>;
export type SearchParams = Readonly<Record<string, string>>;

/** Mỗi tham số một giá trị (lấy phần tử đầu nếu lặp), bỏ tham số rỗng — các màn chỉ đọc chuỗi đơn. */
export function singleValues(params: RawParams): SearchParams {
  const out: Record<string, string> = {};
  for (const name of Object.keys(params).sort()) {
    const value = params[name];
    const one = typeof value === 'string' ? value : value?.[0];
    if (one !== undefined) out[name] = one;
  }
  return out;
}

/** Khoá theo nội dung (sắp theo tên tham số), không theo danh tính object. */
export function paramsKey(params: RawParams): string {
  return JSON.stringify(singleValues(params));
}

/** Như `useLocalSearchParams`, nhưng chỉ trả object mới khi nội dung tham số thật sự đổi. */
export function useStableSearchParams(): SearchParams {
  const params = useLocalSearchParams();
  const key = paramsKey(params);
  // Dependency là `key` (nội dung), không phải `params` (danh tính đổi mỗi lần render).
  return useMemo(() => singleValues(params), [key]);
}
