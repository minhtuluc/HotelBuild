import { makeTranslate } from '@pinehill/ui-web/messages';

/**
 * Câu chữ SCR-08 (đăng ký/đăng nhập/quên và đặt lại mật khẩu khách). Danh mục chung (`lib/i18n.ts`) nằm
 * ngoài phạm vi ticket nên màn tự khai báo tại chỗ theo mẫu `pay/messages-payment.ts`.
 */
export const messages = {
  navLabel: 'Tài khoản khách',
  statusChecking: 'Đang kiểm tra phiên…',
  statusIn: 'Đã đăng nhập',
  statusOut: 'Chưa đăng nhập',
  logout: 'Đăng xuất',
  loggingOut: 'Đang đăng xuất…',
  logoutPartial:
    'Đã đăng xuất trên thiết bị này, nhưng chưa thu hồi được phiên trên máy chủ. Hãy thử đăng xuất lại khi có mạng.',
  home: 'Trang chủ',
  loginLink: 'Đăng nhập',
  registerLink: 'Đăng ký',
  profileLink: 'Hồ sơ của tôi',

  registerTitle: 'Đăng ký tài khoản',
  registerIntro: 'Tạo tài khoản bằng số điện thoại để xem và quản lý đặt phòng của bạn.',
  loginTitle: 'Đăng nhập',
  loginIntro: 'Đăng nhập bằng số điện thoại và mật khẩu đã đăng ký.',
  forgotTitle: 'Quên mật khẩu',
  forgotIntro:
    'Nhập số điện thoại đã đăng ký. Nếu có email gắn với tài khoản, chúng tôi sẽ gửi thư hướng dẫn đặt lại mật khẩu.',
  resetTitle: 'Đặt lại mật khẩu',
  resetIntro: 'Nhập mật khẩu mới cho tài khoản của bạn (từ 8 đến 128 ký tự).',

  fullName: 'Họ và tên',
  phone: 'Số điện thoại',
  phoneHint: 'Nhập 0912345678 hoặc +84912345678 — hệ thống dùng dạng +84…',
  phoneCanonical: 'Số điện thoại sẽ được dùng: {phone}',
  email: 'Email (không bắt buộc)',
  emailHint: 'Cần email nếu bạn muốn nhận thư đặt lại mật khẩu.',
  password: 'Mật khẩu',
  passwordHint: 'Từ 8 đến 128 ký tự.',
  newPassword: 'Mật khẩu mới',
  confirmPassword: 'Nhập lại mật khẩu mới',
  consent: 'Tôi đồng ý nhận thông tin ưu đãi từ Pine Hill (không bắt buộc)',
  consentNote: 'Bạn có thể bỏ trống ô này; việc đặt phòng không phụ thuộc vào lựa chọn của bạn.',

  submitRegister: 'Đăng ký',
  submitLogin: 'Đăng nhập',
  submitForgot: 'Gửi yêu cầu',
  submitReset: 'Đặt lại mật khẩu',
  submitting: 'Đang gửi…',

  toLogin: 'Đã có tài khoản? Đăng nhập',
  toRegister: 'Chưa có tài khoản? Đăng ký',
  toForgot: 'Quên mật khẩu?',
  toNewLink: 'Yêu cầu liên kết mới',
  toLoginAfterReset: 'Đến trang đăng nhập',

  issueRequired: 'Bắt buộc nhập.',
  issuePhone: 'Số điện thoại phải là 0XXXXXXXXX hoặc +84XXXXXXXXX.',
  issueEmail: 'Email chưa đúng định dạng.',
  issueTooShort: 'Mật khẩu cần ít nhất 8 ký tự.',
  issueTooLong: 'Nội dung quá dài.',
  issueMismatch: 'Hai lần nhập chưa khớp.',
  fieldIssue: '{field}: {issue}',
  validationSummary: 'Vui lòng sửa {count} trường được đánh dấu.',

  phoneRegistered:
    'Số điện thoại này đã có hồ sơ tại khách sạn. Vui lòng liên hệ lễ tân để được hỗ trợ.',
  contactGeneric:
    'Hãy liên hệ lễ tân Pine Hill (theo thông tin trên email xác nhận đặt phòng hoặc tại quầy).',
  contactLine: 'Liên hệ lễ tân: {contact}',
  invalidCredentials: 'Số điện thoại hoặc mật khẩu chưa đúng.',
  locked:
    'Tài khoản tạm khoá do đăng nhập sai nhiều lần. Hãy thử lại sau ít phút hoặc dùng "Quên mật khẩu".',
  rateLimited: 'Bạn thao tác quá nhanh. Hãy thử lại sau ít phút.',
  resetTokenInvalid:
    'Liên kết đặt lại mật khẩu không hợp lệ, đã hết hạn hoặc đã được dùng. Hãy yêu cầu liên kết mới.',
  validation: 'Máy chủ không chấp nhận thông tin vừa nhập. Hãy kiểm tra lại các trường.',
  unavailable: 'Hệ thống tạm thời không phản hồi. Hãy thử lại sau.',
  other: 'Không thể hoàn tất yêu cầu. Hãy thử lại hoặc liên hệ lễ tân.',
  registerUnknown:
    'Chưa xác định kết quả đăng ký. Hãy thử đăng nhập bằng số điện thoại và mật khẩu vừa nhập trước khi đăng ký lại.',
  loginUnknown: 'Không kết nối được hệ thống. Hãy kiểm tra mạng rồi thử lại.',
  forgotUnknown: 'Chưa xác định kết quả gửi yêu cầu. Hãy thử lại.',
  resetUnknown:
    'Chưa xác định kết quả đặt lại mật khẩu. Hãy thử đăng nhập bằng mật khẩu mới; nếu không được, hãy thử lại.',
  registeredNotSignedIn:
    'Đã tạo tài khoản nhưng chưa đăng nhập được. Hãy đăng nhập bằng số điện thoại và mật khẩu vừa đăng ký.',

  forgotDone:
    'Nếu số điện thoại này có email đăng ký, bạn sẽ nhận thư hướng dẫn đặt lại mật khẩu trong ít phút.',
  forgotNoEmail: 'Không có email? Hãy liên hệ lễ tân để được hỗ trợ.',
  resetDone: 'Đã đặt lại mật khẩu. Hãy đăng nhập bằng mật khẩu mới.',
  resetNotice: 'Mật khẩu đã được đặt lại. Hãy đăng nhập bằng mật khẩu mới.',
  resetMissingToken: 'Liên kết thiếu mã đặt lại. Hãy yêu cầu liên kết mới.',
  signedInAlready: 'Bạn đã đăng nhập.',
} as const;

export const accountText = makeTranslate(messages);
