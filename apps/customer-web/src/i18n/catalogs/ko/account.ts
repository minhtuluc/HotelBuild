/** Bản tiếng Hàn của SCR-08 (đăng ký, đăng nhập, quên và đặt lại mật khẩu) — HB-313. */
import type { AccountMessageKey } from '../vi/account';

export const koAccount: Readonly<Record<AccountMessageKey, string>> = {
  navLabel: '고객 계정',
  statusChecking: '로그인 상태를 확인하는 중…',
  statusIn: '로그인됨',
  statusOut: '로그인 안 됨',
  logout: '로그아웃',
  loggingOut: '로그아웃하는 중…',
  logoutPartial:
    '이 기기에서는 로그아웃되었지만 서버 세션을 해제하지 못했습니다. 온라인일 때 다시 로그아웃하세요.',
  home: '홈',
  loginLink: '로그인',
  registerLink: '회원가입',
  profileLink: '내 프로필',

  registerTitle: '계정 만들기',
  registerIntro: '전화번호로 계정을 만들면 예약을 보고 관리할 수 있습니다.',
  loginTitle: '로그인',
  loginIntro: '가입한 전화번호와 비밀번호로 로그인하세요.',
  forgotTitle: '비밀번호 찾기',
  forgotIntro:
    '가입한 전화번호를 입력하세요. 계정에 이메일이 연결되어 있으면 비밀번호 재설정 안내를 보내 드립니다.',
  resetTitle: '비밀번호 재설정',
  resetIntro: '계정의 새 비밀번호를 입력하세요(8~128자).',

  fullName: '이름',
  phone: '전화번호',
  phoneHint: '0912345678 또는 +84912345678로 입력하세요. 시스템은 +84… 형식을 사용합니다',
  phoneCanonical: '다음 전화번호를 사용합니다: {phone}',
  email: '이메일(선택)',
  emailHint: '비밀번호 재설정 메일을 받으려면 이메일이 필요합니다.',
  password: '비밀번호',
  passwordHint: '8~128자.',
  newPassword: '새 비밀번호',
  confirmPassword: '새 비밀번호 확인',
  consent: 'Pine Hill의 혜택 정보 수신에 동의합니다(선택)',
  consentNote: '선택하지 않아도 됩니다. 예약에는 영향이 없습니다.',

  submitRegister: '가입하기',
  submitLogin: '로그인',
  submitForgot: '요청 보내기',
  submitReset: '비밀번호 재설정',
  submitting: '보내는 중…',

  toLogin: '계정이 있으신가요? 로그인',
  toRegister: '계정이 없으신가요? 회원가입',
  toForgot: '비밀번호를 잊으셨나요?',
  toNewLink: '새 링크 요청',
  toLoginAfterReset: '로그인하러 가기',

  issueRequired: '필수 항목입니다.',
  issuePhone: '전화번호는 0XXXXXXXXX 또는 +84XXXXXXXXX 형식이어야 합니다.',
  issueEmail: '이메일 형식이 올바르지 않습니다.',
  issueTooShort: '비밀번호는 8자 이상이어야 합니다.',
  issueTooLong: '너무 깁니다.',
  issueMismatch: '두 입력이 일치하지 않습니다.',
  fieldIssue: '{field}: {issue}',
  validationSummary: '표시된 {count}개 항목을 수정해 주세요.',

  phoneRegistered: '이 전화번호는 이미 호텔에 고객 정보가 있습니다. 프런트에 문의해 주세요.',
  contactGeneric: 'Pine Hill 프런트에 문의하세요(연락처는 예약 확인 메일 또는 프런트에 있습니다).',
  contactLine: '프런트 연락처: {contact}',
  invalidCredentials: '전화번호 또는 비밀번호가 올바르지 않습니다.',
  locked:
    '로그인에 여러 번 실패해 계정이 일시적으로 잠겼습니다. 몇 분 후 다시 시도하거나 "비밀번호 찾기"를 이용하세요.',
  rateLimited: '너무 빠르게 시도하고 있습니다. 몇 분 후 다시 시도하세요.',
  retryInSeconds: '{n}초 후 다시 시도하세요.',
  retryInMinutes: '약 {n}분 후 다시 시도하세요.',
  resetTokenInvalid:
    '이 비밀번호 재설정 링크는 유효하지 않거나, 만료되었거나, 이미 사용되었습니다. 새 링크를 요청하세요.',
  validation: '서버가 입력한 정보를 받아들이지 않았습니다. 각 항목을 확인하세요.',
  unavailable: '지금은 시스템이 응답하지 않습니다. 나중에 다시 시도하세요.',
  other: '요청을 완료하지 못했습니다. 다시 시도하거나 프런트에 문의하세요.',
  registerUnknown:
    '가입 결과가 확인되지 않았습니다. 다시 가입하기 전에 입력한 전화번호와 비밀번호로 로그인해 보세요.',
  loginUnknown: '시스템에 연결할 수 없습니다. 연결 상태를 확인하고 다시 시도하세요.',
  forgotUnknown: '요청 결과가 확인되지 않았습니다. 다시 시도하세요.',
  resetUnknown:
    '비밀번호 재설정 결과가 확인되지 않았습니다. 새 비밀번호로 로그인해 보고, 실패하면 다시 시도하세요.',
  registeredNotSignedIn:
    '계정은 만들어졌지만 로그인하지 못했습니다. 방금 가입한 전화번호와 비밀번호로 로그인하세요.',

  forgotDone: '이 전화번호에 이메일이 등록되어 있으면 몇 분 안에 재설정 안내를 받게 됩니다.',
  forgotNoEmail: '이메일이 없으신가요? 프런트에 문의하세요.',
  resetDone: '비밀번호가 재설정되었습니다. 새 비밀번호로 로그인하세요.',
  resetNotice: '비밀번호가 재설정되었습니다. 새 비밀번호로 로그인하세요.',
  resetMissingToken: '링크에 재설정 코드가 없습니다. 새 링크를 요청하세요.',
  signedInAlready: '이미 로그인되어 있습니다.',
};
