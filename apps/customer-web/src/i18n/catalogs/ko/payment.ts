/** Bản tiếng Hàn của SCR-06 (thanh toán tiền cọc) — HB-313. */
import type { PaymentMessageKey } from '../vi/payment';

export const koPayment: Readonly<Record<PaymentMessageKey, string>> = {
  title: '예약금 결제',
  intro: '결제 게이트웨이를 선택하세요. 거래와 예약 상태는 서버에서 다시 확인합니다.',
  pending: '아직 입금이 확인되지 않았습니다. 결과가 불분명할 때는 다시 결제하지 마세요.',
  received:
    '결제가 접수되어 처리 중입니다. 예약 상태는 서버 기준입니다. 다시 확인하거나 프런트에 문의하세요.',
  confirmed: '서버가 예약을 확정하고 결제를 기록했습니다.',
  failed:
    '최근 확인 시점까지 거래가 성공하지 않았습니다. 업데이트가 늦을 수 있으니 다시 결제하기 전에 확인하세요.',
  unavailable:
    '서버가 결제할 수 있는 예약금을 제공하지 않았습니다. 새로고침하거나 프런트에 문의하세요.',
  error: '거래를 확인할 수 없습니다. 다시 확인하세요. 아직 결제 여부를 판단할 수 없습니다.',
  check: '거래 확인',
  prepare: '결제 전 확인',
  confirm: '확인 후 결제 게이트웨이 열기',
  portal: '결제 게이트웨이에서 계속',
  back: '예약 보기',
  confirmInfo:
    '선택한 게이트웨이로 이동해 아래 예약금을 정확히 결제합니다. Pine Hill은 이 화면에서 카드 정보를 수집하지 않습니다.',
  poll: '최대 12번 자동으로 확인하며, 탭을 벗어나거나 거래가 만료되거나 결과가 나오면 멈춥니다. 직접 확인할 수도 있습니다.',
  unknown: '요청은 보냈지만 결과가 불분명합니다. 이 거래를 유지하고 새 결제를 만들지 마세요.',
  currentVersion: '서버의 새 버전',
  previousVersion: '이전 버전',
  methodRequired: 'VNPay 또는 MoMo를 선택하세요.',
  summaryBooking: '예약 {code}',
  total: '객실 요금 합계',
  paid: '수령액',
  balance: '장부상 잔액',
  deposit: '서버 기준 예약금',
  bookingStatus: '서버의 예약 상태',
  holdExpiry: '보류 만료: {time}. 보류는 결제 거래와 별개입니다.',
  provider: '결제 게이트웨이',
  providerVnpay: 'VNPay',
  providerMomo: 'MoMo',
  selectedProvider: '선택한 게이트웨이: {provider}.',
  observed: '확인한 거래',
  transaction: '거래 ID:',
  paymentStatus: '금액: {amount} · 서버 상태: {status}',
  paymentExpiry: '거래 만료: {time}.',
};
