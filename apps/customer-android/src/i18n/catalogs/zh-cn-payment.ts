/**
 * HB-275 — câu chữ app khách bằng 简体中文. Bộ khoá theo tiếng Việt; thiếu khoá thì báo lỗi khi biên dịch.
 * Bản dịch do Claude soạn — nên có người bản ngữ đọc lại trước khi phát hành.
 */
import type { PaymentCatalog, PhaseCatalog } from '../../payment/messages';

export const zhPayment: PaymentCatalog = {
  title: '支付订金',
  reading: '正在向服务器查询',
  changed: '金额或预订已变更。请加载最新数据后再次确认。',
  handoffFailed: '无法打开浏览器。交易仍会保留；请再次查询或重新打开同一笔交易。',
  backToBookings: '返回我的预订',
  booking: '预订 {code}',
  money: '{amount} ₫',
  total: '房费合计：{amount}',
  paid: '已付：{amount}',
  balance: '待付余额：{amount}',
  deposit: '应付订金：{amount}',
  unavailableAmount: '暂无数据',
  bookingStatus: '预订状态：{status}',
  holdExpiry: '保留截止：{time}。保留期限与支付交易相互独立。',
  transaction: '交易编号：{id}',
  paymentStatus: '交易状态：{status}',
  checkedAt: '于 {time} 向服务器查询',
  provider: '支付渠道',
  providerVnpay: 'VNPay',
  providerMomo: 'MoMo',
  prepare: '支付前核对',
  confirmInfo: '已选渠道：{provider}。支付将在系统浏览器中打开；返回后会再次向服务器查询。',
  confirm: '确认并打开支付页面',
  reopen: '重新打开这笔交易的支付页面',
  unsafeUrl: '服务器尚未返回安全的 HTTPS 链接。请查看交易状态。',
  reference: '参考编号：{id}',
  login: '返回登录',
  check: '再次向服务器查询',
};

export const zhPhases: PhaseCatalog = {
  loading: '正在从服务器读取交易和预订…',
  ready: '请选择支付渠道。订金金额由服务器提供。',
  confirm: '确认前请核对金额和支付渠道。',
  pending: '交易处理中。支付结果仅以服务器确认为准。',
  unknown: '发送结果未知。请勿发起新交易；请再次查询或凭参考编号联系前台。',
  received: '已收到付款，正在处理。预订状态仍由服务器决定。',
  confirmed: '服务器已确认交易和预订。',
  failed: '交易未成功。请再次查询最新状态。',
  blocked: '服务器数据不足，暂时无法发起在线支付。请再次查询或联系前台。',
  forbidden: '您无权查看此交易。',
  expired: '会话已过期。请重新登录。',
  offline: '需要网络连接才能查询状态或付款。旧数据不能证明已付款。',
  error: '无法读取服务器状态。请再次查询。',
};
