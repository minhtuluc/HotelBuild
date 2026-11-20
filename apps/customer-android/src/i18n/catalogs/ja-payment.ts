/**
 * HB-275 — câu chữ app khách bằng 日本語. Bộ khoá theo tiếng Việt; thiếu khoá thì báo lỗi khi biên dịch.
 * Bản dịch do Claude soạn — nên có người bản ngữ đọc lại trước khi phát hành.
 */
import type { PaymentCatalog, PhaseCatalog } from '../../payment/messages';

export const jaPayment: PaymentCatalog = {
  title: 'デポジットのお支払い',
  reading: 'サーバーに確認中',
  changed:
    '金額または予約が変更されました。最新のデータを読み込んでから、もう一度確定してください。',
  handoffFailed:
    'ブラウザを開けませんでした。取引は保持されています。再確認するか、同じ取引をもう一度開いてください。',
  backToBookings: '予約一覧に戻る',
  booking: '予約 {code}',
  money: '{amount} ₫',
  total: '客室料金合計：{amount}',
  paid: '支払済み：{amount}',
  balance: '未払い残高：{amount}',
  deposit: 'お支払いいただくデポジット：{amount}',
  unavailableAmount: 'まだデータがありません',
  bookingStatus: '予約の状態：{status}',
  holdExpiry: '仮押さえの期限：{time}。仮押さえの期限は支払い取引とは別です。',
  transaction: '取引番号：{id}',
  paymentStatus: '取引の状態：{status}',
  checkedAt: '{time} にサーバーで確認',
  provider: '決済サービス',
  providerVnpay: 'VNPay',
  providerMomo: 'MoMo',
  prepare: '支払い前に確認',
  confirmInfo:
    '選択した決済サービス：{provider}。支払いはシステムのブラウザで開きます。戻るとサーバーにもう一度確認します。',
  confirm: '確定して決済ページを開く',
  reopen: 'この取引の決済ページをもう一度開く',
  unsafeUrl:
    'サーバーから安全な HTTPS リンクがまだ返されていません。取引の状態を確認してください。',
  reference: '参照番号：{id}',
  login: 'ログインに戻る',
  check: 'サーバーにもう一度確認',
};

export const jaPhases: PhaseCatalog = {
  loading: 'サーバーから取引と予約を読み込んでいます…',
  ready: '決済サービスを選んでください。デポジット額はサーバーから取得します。',
  confirm: '確定する前に金額と決済サービスを確認してください。',
  pending: '取引は処理待ちです。支払い結果はサーバーでのみ確定します。',
  unknown:
    '送信結果が不明です。新しい取引は作成せず、再確認するか参照番号を添えてフロントにお問い合わせください。',
  received: '入金を受け付け、処理中です。予約の状態はサーバーが決定します。',
  confirmed: 'サーバーで取引と予約が確定しました。',
  failed: '取引は成功しませんでした。最新の状態を再確認してください。',
  blocked:
    'オンライン決済を開始するためのサーバーデータが不足しています。再確認するか、フロントにお問い合わせください。',
  forbidden: 'この取引を表示する権限がありません。',
  expired: 'セッションの有効期限が切れました。もう一度ログインしてください。',
  offline: '状態の確認や支払いにはネット接続が必要です。古いデータでは支払い済みと確認できません。',
  error: 'サーバーの状態を読み込めませんでした。再確認してください。',
};
