/** Bản tiếng Nhật của SCR-08 (đăng ký, đăng nhập, quên và đặt lại mật khẩu) — HB-313. */
import type { AccountMessageKey } from '../vi/account';

export const jaAccount: Readonly<Record<AccountMessageKey, string>> = {
  navLabel: 'ゲストアカウント',
  statusChecking: 'ログイン状態を確認しています…',
  statusIn: 'ログイン中',
  statusOut: '未ログイン',
  logout: 'ログアウト',
  loggingOut: 'ログアウトしています…',
  logoutPartial:
    'この端末ではログアウトしましたが、サーバーのセッションを取り消せませんでした。オンラインのときにもう一度ログアウトしてください。',
  home: 'ホーム',
  loginLink: 'ログイン',
  registerLink: '新規登録',
  profileLink: 'マイプロフィール',

  registerTitle: 'アカウントを作成',
  registerIntro: '電話番号でアカウントを作成すると、予約を確認・管理できます。',
  loginTitle: 'ログイン',
  loginIntro: '登録した電話番号とパスワードでログインしてください。',
  forgotTitle: 'パスワードをお忘れの方',
  forgotIntro:
    '登録した電話番号を入力してください。アカウントにメールアドレスが登録されていれば、パスワード再設定の案内をお送りします。',
  resetTitle: 'パスワードの再設定',
  resetIntro: 'アカウントの新しいパスワードを入力してください（8〜128 文字）。',

  fullName: '氏名',
  phone: '電話番号',
  phoneHint: '0912345678 または +84912345678 と入力。システムでは +84… の形式を使います',
  phoneCanonical: '次の電話番号を使用します：{phone}',
  email: 'メールアドレス（任意）',
  emailHint: 'パスワード再設定メールを受け取るにはメールアドレスが必要です。',
  password: 'パスワード',
  passwordHint: '8〜128 文字。',
  newPassword: '新しいパスワード',
  confirmPassword: '新しいパスワード（確認）',
  consent: 'Pine Hill からのお得な情報を受け取る（任意）',
  consentNote: 'チェックしなくても構いません。予約には影響しません。',

  submitRegister: '登録する',
  submitLogin: 'ログイン',
  submitForgot: '送信する',
  submitReset: 'パスワードを再設定',
  submitting: '送信中…',

  toLogin: 'アカウントをお持ちの方はログイン',
  toRegister: 'アカウントをお持ちでない方は新規登録',
  toForgot: 'パスワードをお忘れですか？',
  toNewLink: '新しいリンクを請求',
  toLoginAfterReset: 'ログインへ',

  issueRequired: '必須項目です。',
  issuePhone: '電話番号は 0XXXXXXXXX または +84XXXXXXXXX の形式で入力してください。',
  issueEmail: 'メールアドレスの形式が正しくありません。',
  issueTooShort: 'パスワードは 8 文字以上必要です。',
  issueTooLong: '長すぎます。',
  issueMismatch: '2 つの入力が一致しません。',
  fieldIssue: '{field}：{issue}',
  validationSummary: '表示された {count} 項目を修正してください。',

  phoneRegistered:
    'この電話番号はすでにホテルにお客様情報があります。フロントにお問い合わせください。',
  contactGeneric:
    'Pine Hill のフロントにご連絡ください（連絡先は予約確認メールまたはフロントにあります）。',
  contactLine: 'フロントの連絡先：{contact}',
  invalidCredentials: '電話番号またはパスワードが正しくありません。',
  locked:
    'ログインに何度か失敗したため、アカウントを一時的にロックしました。数分後にもう一度お試しいただくか、「パスワードをお忘れの方」をご利用ください。',
  rateLimited: '操作が速すぎます。数分後にもう一度お試しください。',
  retryInSeconds: '{n} 秒後にもう一度お試しください。',
  retryInMinutes: '約 {n} 分後にもう一度お試しください。',
  resetTokenInvalid:
    'このパスワード再設定リンクは無効、期限切れ、または使用済みです。新しいリンクを請求してください。',
  validation: '入力内容がサーバーで受け付けられませんでした。各項目を確認してください。',
  unavailable: '現在システムが応答していません。後でもう一度お試しください。',
  other: 'リクエストを完了できませんでした。もう一度お試しいただくか、フロントにご連絡ください。',
  registerUnknown:
    '登録の結果は確定していません。もう一度登録する前に、入力した電話番号とパスワードでログインをお試しください。',
  loginUnknown: 'システムに接続できません。通信環境を確認して、もう一度お試しください。',
  forgotUnknown: 'リクエストの結果は確定していません。もう一度お試しください。',
  resetUnknown:
    'パスワード再設定の結果は確定していません。新しいパスワードでログインをお試しください。失敗した場合はもう一度お試しください。',
  registeredNotSignedIn:
    'アカウントは作成されましたが、ログインできませんでした。登録した電話番号とパスワードでログインしてください。',

  forgotDone: 'この電話番号にメールアドレスが登録されていれば、数分以内に再設定の案内が届きます。',
  forgotNoEmail: 'メールが届かない場合は、フロントにお問い合わせください。',
  resetDone: 'パスワードを再設定しました。新しいパスワードでログインしてください。',
  resetNotice: 'パスワードを再設定しました。新しいパスワードでログインしてください。',
  resetMissingToken: 'リンクに再設定コードがありません。新しいリンクを請求してください。',
  signedInAlready: 'すでにログインしています。',
};
