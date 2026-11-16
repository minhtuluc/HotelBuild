/**
 * Sự kiện `window` báo phiên khách vừa đổi (đăng nhập, làm mới, đăng xuất) — HB-325. `guest-session.ts` phát;
 * header nghe để đọc lại cookie gợi ý mà không phải import client phiên. Không mang token hay dữ liệu gì.
 */
export const GUEST_SESSION_EVENT = 'pinehill:guest-session';
