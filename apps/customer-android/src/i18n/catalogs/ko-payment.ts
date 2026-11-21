/**
 * HB-275 — câu chữ app khách bằng 한국어. Bộ khoá theo tiếng Việt; thiếu khoá thì báo lỗi khi biên dịch.
 * Bản dịch do Claude soạn — nên có người bản ngữ đọc lại trước khi phát hành.
 */
import type { PaymentCatalog, PhaseCatalog } from '../../payment/messages';

export const koPayment: PaymentCatalog = {
  title: '보증금 결제',
  reading: '서버 확인 중',
  changed: '금액 또는 예약이 변경되었습니다. 최신 데이터를 불러온 뒤 다시 확인하세요.',
  handoffFailed:
    '브라우저를 열 수 없습니다. 거래는 유지됩니다. 다시 확인하거나 같은 거래를 다시 여세요.',
  backToBookings: '내 예약으로',
  booking: '예약 {code}',
  money: '{amount} ₫',
  total: '객실 요금 합계: {amount}',
  paid: '결제 완료: {amount}',
  balance: '미결제 잔액: {amount}',
  deposit: '결제할 보증금: {amount}',
  unavailableAmount: '아직 데이터가 없습니다',
  bookingStatus: '예약 상태: {status}',
  holdExpiry: '임시 예약 만료: {time}. 임시 예약 기한은 결제 거래와 별개입니다.',
  transaction: '거래 번호: {id}',
  paymentStatus: '거래 상태: {status}',
  checkedAt: '{time}에 서버에서 확인',
  provider: '결제 수단',
  providerVnpay: 'VNPay',
  providerMomo: 'MoMo',
  prepare: '결제 전 확인',
  confirmInfo:
    '선택한 결제 수단: {provider}. 결제는 시스템 브라우저에서 열리며, 돌아오면 서버에서 다시 확인합니다.',
  confirm: '확인하고 결제 페이지 열기',
  reopen: '이 거래의 결제 페이지 다시 열기',
  unsafeUrl: '서버가 아직 안전한 HTTPS 링크를 보내지 않았습니다. 거래 상태를 확인하세요.',
  reference: '참조 번호: {id}',
  login: '로그인으로',
  check: '서버에서 다시 확인',
};

export const koPhases: PhaseCatalog = {
  loading: '서버에서 거래와 예약을 불러오는 중…',
  ready: '결제 수단을 선택하세요. 보증금 금액은 서버에서 가져옵니다.',
  confirm: '확인 전에 금액과 결제 수단을 점검하세요.',
  pending: '거래가 대기 중입니다. 결제 결과는 서버에서만 확정됩니다.',
  unknown:
    '전송 결과를 알 수 없습니다. 새 거래를 만들지 말고 다시 확인하거나 참조 번호로 프런트에 문의하세요.',
  received: '결제를 받아 처리 중입니다. 예약 상태는 서버가 결정합니다.',
  confirmed: '서버에서 거래와 예약이 확정되었습니다.',
  failed: '거래가 성공하지 못했습니다. 최신 상태를 다시 확인하세요.',
  blocked: '온라인 결제를 시작할 서버 데이터가 부족합니다. 다시 확인하거나 프런트에 문의하세요.',
  forbidden: '이 거래를 볼 권한이 없습니다.',
  expired: '세션이 만료되었습니다. 다시 로그인하세요.',
  offline:
    '상태 확인이나 결제에는 네트워크 연결이 필요합니다. 이전 데이터로는 결제 완료를 확인할 수 없습니다.',
  error: '서버 상태를 읽을 수 없습니다. 다시 확인하세요.',
};
