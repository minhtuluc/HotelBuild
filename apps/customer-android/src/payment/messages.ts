import type { Phase } from './flow';
import { makeTranslate, type TranslateFor } from '@pinehill/ui-native';
import type { Locale } from '@pinehill/i18n';
import { enPayment, enPhases } from '../i18n/catalogs/en-payment';
import { jaPayment, jaPhases } from '../i18n/catalogs/ja-payment';
import { koPayment, koPhases } from '../i18n/catalogs/ko-payment';
import { ruPayment, ruPhases } from '../i18n/catalogs/ru-payment';
import { zhPayment, zhPhases } from '../i18n/catalogs/zh-cn-payment';
import { currentLocale } from '../i18n/locale';

export const paymentCatalog = {
  title: 'Thanh toán tiền cọc',
  reading: 'Đang đọc máy chủ',
  changed: 'Số tiền hoặc đặt phòng đã đổi. Đọc dữ liệu mới rồi xác nhận lại.',
  handoffFailed:
    'Không mở được trình duyệt. Giao dịch vẫn được giữ; kiểm tra lại hoặc mở lại cùng giao dịch.',
  backToBookings: 'Về đơn của tôi',
  booking: 'Đặt phòng {code}',
  money: '{amount} ₫',
  total: 'Tổng tiền phòng: {amount}',
  paid: 'Đã thu: {amount}',
  balance: 'Còn nợ theo sổ cái: {amount}',
  deposit: 'Cọc cần trả theo máy chủ: {amount}',
  unavailableAmount: 'Chưa có dữ liệu',
  bookingStatus: 'Trạng thái đặt phòng từ máy chủ: {status}',
  holdExpiry: 'Hạn giữ chỗ: {time}. Hạn giữ chỗ độc lập với giao dịch thanh toán.',
  transaction: 'Mã giao dịch: {id}',
  paymentStatus: 'Trạng thái giao dịch từ máy chủ: {status}',
  checkedAt: 'Đã đọc máy chủ lúc {time}',
  provider: 'Cổng thanh toán',
  providerVnpay: 'VNPay',
  providerMomo: 'MoMo',
  prepare: 'Xem lại trước khi thanh toán',
  confirmInfo:
    'Cổng đã chọn: {provider}. Thanh toán mở trình duyệt hệ thống; khi trở về sẽ đọc lại máy chủ.',
  confirm: 'Xác nhận và mở cổng thanh toán',
  reopen: 'Mở lại cổng thanh toán cho giao dịch này',
  unsafeUrl: 'Máy chủ chưa trả liên kết HTTPS an toàn. Hãy kiểm tra trạng thái giao dịch.',
  reference: 'Mã tham chiếu: {id}',
  login: 'Về đăng nhập',
  check: 'Kiểm tra lại từ máy chủ',
} as const;

export type PaymentKey = keyof typeof paymentCatalog;
export type PaymentCatalog = Readonly<Record<PaymentKey, string>>;
export type PhaseCatalog = Readonly<Record<Phase, string>>;

const phaseMessages: PhaseCatalog = {
  loading: 'Đang đọc giao dịch và đặt phòng từ máy chủ…',
  ready: 'Chọn cổng thanh toán. Số cọc lấy từ máy chủ.',
  confirm: 'Kiểm tra số tiền và cổng thanh toán trước khi xác nhận.',
  pending: 'Giao dịch đang chờ. Chỉ máy chủ xác nhận kết quả thanh toán.',
  unknown:
    'Chưa biết kết quả gửi. Không tạo giao dịch khác; kiểm tra lại hoặc liên hệ lễ tân với mã tham chiếu.',
  received: 'Đã nhận tiền, đang xử lý. Trạng thái đặt phòng vẫn do máy chủ quyết định.',
  confirmed: 'Máy chủ đã xác nhận giao dịch và đặt phòng.',
  failed: 'Giao dịch không thành công. Kiểm tra lại để biết trạng thái mới nhất.',
  blocked:
    'Chưa đủ dữ liệu máy chủ để tạo thanh toán trực tuyến. Vui lòng kiểm tra lại hoặc liên hệ lễ tân.',
  forbidden: 'Không có quyền xem giao dịch này.',
  expired: 'Phiên đã hết hạn. Vui lòng đăng nhập lại.',
  offline:
    'Cần kết nối mạng để đọc trạng thái hoặc thanh toán. Dữ liệu cũ không xác nhận đã trả tiền.',
  error: 'Không đọc được trạng thái máy chủ. Vui lòng kiểm tra lại.',
};

/** HB-275: câu chữ thanh toán theo 6 ngôn ngữ; tiếng Việt là bộ khoá chuẩn. */
export const PAYMENT_CATALOGS: Readonly<Record<Locale, PaymentCatalog>> = {
  vi: paymentCatalog,
  en: enPayment,
  'zh-CN': zhPayment,
  ja: jaPayment,
  ko: koPayment,
  ru: ruPayment,
};

export const PHASE_CATALOGS: Readonly<Record<Locale, PhaseCatalog>> = {
  vi: phaseMessages,
  en: enPhases,
  'zh-CN': zhPhases,
  ja: jaPhases,
  ko: koPhases,
  ru: ruPhases,
};

const translators = new Map<Locale, TranslateFor<PaymentCatalog>>();

export function paymentText(
  key: PaymentKey,
  vars?: Readonly<Record<string, string | number>>,
): string {
  const locale = currentLocale();
  let translate = translators.get(locale);
  if (translate === undefined) {
    translate = makeTranslate(PAYMENT_CATALOGS[locale]);
    translators.set(locale, translate);
  }
  return translate(key, vars);
}

export function phaseText(phase: Phase): string {
  return PHASE_CATALOGS[currentLocale()][phase];
}
