/** Bản tiếng Nhật của SCR-06 (thanh toán tiền cọc) — HB-313. */
import type { PaymentMessageKey } from '../vi/payment';

export const jaPayment: Readonly<Record<PaymentMessageKey, string>> = {
  title: 'デポジットを支払う',
  intro: '決済ゲートウェイを選んでください。取引と予約の状態はサーバーで再確認します。',
  pending: '入金の確認はまだ取れていません。結果が不明な間は再度支払わないでください。',
  received:
    '支払いを受け付け、処理中です。予約の状態はサーバーの情報に基づきます。もう一度確認するか、フロントにご連絡ください。',
  confirmed: 'サーバーが予約を確定し、支払いを記録しました。',
  failed:
    '最新の確認時点で取引は成功していません。更新が遅れることがあるため、再度支払う前に確認してください。',
  unavailable:
    'サーバーから支払い可能なデポジットが提供されていません。再読み込みするか、フロントにご連絡ください。',
  error:
    '取引を確認できませんでした。もう一度確認してください。支払い済みかどうかはまだ判断できません。',
  check: '取引を確認',
  prepare: '支払い前に確認',
  confirm: '確認して決済ゲートウェイを開く',
  portal: '決済ゲートウェイで続ける',
  back: '予約を見る',
  confirmInfo:
    '選択したゲートウェイで、下記のデポジット額ちょうどを支払います。Pine Hill はこの画面でカード情報を収集しません。',
  poll: '最大 12 回まで自動で確認し、タブを離れたとき、取引が期限切れになったとき、結果が出たときに停止します。手動でも確認できます。',
  unknown:
    'リクエストは送信されましたが、結果が不明です。この取引を保持し、新しい支払いを作成しないでください。',
  currentVersion: 'サーバーの新しい版',
  previousVersion: '以前の版',
  methodRequired: 'VNPay または MoMo を選んでください。',
  summaryBooking: '予約 {code}',
  total: '客室料金合計',
  paid: '受領済み',
  balance: '台帳上の残高',
  deposit: 'サーバーが示すデポジット',
  bookingStatus: 'サーバー上の予約状態',
  holdExpiry: '仮押さえの期限：{time}。仮押さえは支払い取引とは別に管理されます。',
  provider: '決済ゲートウェイ',
  providerVnpay: 'VNPay',
  providerMomo: 'MoMo',
  selectedProvider: '選択したゲートウェイ：{provider}。',
  observed: '確認した取引',
  transaction: '取引 ID：',
  paymentStatus: '金額：{amount} · サーバーの状態：{status}',
  paymentExpiry: '取引の期限：{time}。',
};
