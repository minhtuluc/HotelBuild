/**
 * Bản tiếng Nhật của danh mục dùng chung `ui-web` cho customer web — HB-313.
 * Bản dịch do frontend soạn cho demo (quyết định Q6); cần người bản ngữ duyệt trước ngày phát hành công khai.
 */
import type { MessageKey } from '@pinehill/ui-web/messages';

export const jaUiWeb: Readonly<Record<MessageKey, string>> = {
  'common.skipToContent': 'メインコンテンツへスキップ',
  'state.loading': '読み込み中…',
  'state.refreshing': '{time} に更新',
  'state.refreshing.stale': '以前のデータを表示しています',
  'state.empty.noData': 'データはまだありません',
  'state.empty.filtered': '条件に合う結果はありません',
  'state.empty.soldOut': '選択した日程は満室です',
  'state.empty.create': '新規作成',
  'state.validation': '表示された {count} 項目を修正してください',
  'state.validation.field': '{field}：{issue}',
  'state.forbidden': 'この内容を表示する権限がありません',
  'state.conflict': 'データが変更されました：お使いの版 {attempted}、現在の版 {current}',
  'state.conflict.reload': '再読み込みして比較',
  'state.expired': 'この内容は {time} に期限切れになりました',
  'state.expired.reload': '再読み込み',
  'state.unknownOutcome':
    '結果はまだ確定していません。再送信せず、参照番号 {reference} で確認してください',
  'state.unknownOutcome.lookup': '結果を確認',
  'state.success': 'サーバーで確認済み',
  'action.enterPin': 'PIN を再入力',
  'action.reauth': '再ログイン',
  'action.changePassword': 'パスワードを変更',
  'action.requestNewLink': '新しいリンクを請求',
  'action.requestAccess': 'アクセスを申請',
  'action.notFound': '一覧に戻る',
  'action.newKey': '新しいキーで再送信',
  'action.retryAfter': '数分後にもう一度お試しください',
  'action.reloadAndDiff': '再読み込みして比較',
  'action.restartQuote': '見積もりをやり直す',
  'action.reloadAndReselect': '再読み込みして選び直す',
  'action.fixFields': '指摘された項目を修正',
  'action.retryLater': '後でもう一度お試しください',
  'action.contactSupport': 'サポートに連絡',
  'error.boundary.title': 'この画面で予期しないエラーが発生しました',
  'error.accountLocked':
    'このアカウントは一時的にロックされています。{minutes} 分後にもう一度お試しください。',
  'error.rateLimited': 'リクエストが多すぎます。{minutes} 分後にもう一度お試しください。',
  'error.channelSignature': '販売チャネルの webhook 署名が無効か、タイムスタンプが許容範囲外です。',
  'error.channelReplay':
    'この OTA イベント ID は別の内容で使用済みです。続行する前に隔離して照合してください。',
  'error.channelSyncFailed': '販売チャネルへの同期に失敗しました。システムが自動で再試行します。',
  'error.overNoConsent': '相部屋にするには、お二人とも同意が必要です。',
  'error.overMergeGender': '異なる性別のお客様の相部屋はまだマネージャーに承認されていません。',
  'error.overNoPlan': '移動先の案がないため、他施設への手配に切り替えます。',
  'error.overMoveNotAllowed':
    'お客様はチェックイン済みです。移動には不可抗力の理由とマネージャーの承認が必要です。',
  'error.overApprovalRequired': '移動費用は実行前にマネージャーの承認が必要です。',
  'error.overCrossCity': 'お客様は他都市の施設への移動に書面で同意していません。',
  'error.overCaseDeadline':
    'オーバーブッキング案件が T−24h の期限を過ぎ、上位に報告されました。現場で対応を続け、案件を自分で閉じないでください。',
  'error.compensationUnknown':
    '補償金の支払い結果はまだ確定していません。再度支払わず、参照番号 {reference} で確認してください。',
  'error.boundary.body':
    '技術的な詳細は表示していません。もう一度お試しください。解決しない場合は参照番号をサポートにお送りください。',
  'error.boundary.retry': 'もう一度試す',
  'access.denied.title': 'アクセスできません',
  'access.denied.body':
    'お使いのアカウントにはこのエリアへのアクセス権がありません。必要な場合は施設の管理者にご連絡ください。',
  'access.denied.back': 'トップページに戻る',
  'api.probe.title': 'システムの状態',
  'api.probe.ok': '予約システムは正常に稼働しています',
  'api.probe.failed': '予約システムが中断しています（{code}）',
  'format.stayPeriod': '{nights} 泊 · 大人 {adults} 名 · 子ども {children} 名',
  'format.remaining.hours': '残り {hours} 時間 {minutes} 分',
  'format.remaining.minutes': '残り {minutes} 分',
};
