/**
 * Dữ liệu có cấu trúc schema.org cho trang nội dung. Chuỗi JSON thoát `<` để không đóng thẻ `<script>`
 * sớm; dữ liệu chỉ lấy từ nội dung tĩnh của trang, không lấy từ tham số URL.
 */
import type { ReactElement } from 'react';

export type JsonLdValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonLdValue[]
  | { readonly [key: string]: JsonLdValue };

export function JsonLd({ data }: { data: JsonLdValue }): ReactElement {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  );
}

/** `BreadcrumbList` từ các mục đường dẫn (bỏ qua mục không có URL tuyệt đối). */
export function breadcrumbList(
  items: readonly { readonly name: string; readonly url: string }[],
): JsonLdValue {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}
