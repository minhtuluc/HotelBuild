/**
 * Mục lục bám cuộn của trang chủ (HB-325, UX-06): neo tới các dải dưới khối tìm phòng, nhãn ngắn để dải neo
 * vừa màn hẹp. Thứ tự theo thứ tự dải trên trang; test kiểm mỗi `id` có thật trong `page.tsx`.
 */
export const HOME_TOC = [
  { id: 'tuyen', key: 'guest.home.toc.route' },
  { id: 'hang-phong', key: 'guest.home.toc.classes' },
  { id: 'gia', key: 'guest.home.toc.fare' },
  { id: 'tra-ve', key: 'guest.home.toc.refund' },
  { id: 'cach-dat', key: 'guest.home.toc.steps' },
  { id: 'hoi-dap', key: 'guest.home.toc.faq' },
] as const;
