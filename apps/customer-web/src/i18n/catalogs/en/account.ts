/** Bản tiếng Anh của SCR-08 (đăng ký, đăng nhập, quên và đặt lại mật khẩu) — HB-312. */
import type { AccountMessageKey } from '../vi/account';

export const enAccount: Readonly<Record<AccountMessageKey, string>> = {
  navLabel: 'Guest account',
  statusChecking: 'Checking your session…',
  statusIn: 'Signed in',
  statusOut: 'Not signed in',
  logout: 'Sign out',
  loggingOut: 'Signing out…',
  logoutPartial:
    'You are signed out on this device, but the server session could not be revoked. Try signing out again when you are online.',
  home: 'Home',
  loginLink: 'Sign in',
  registerLink: 'Register',
  profileLink: 'My profile',

  registerTitle: 'Create an account',
  registerIntro: 'Create an account with your phone number to see and manage your bookings.',
  loginTitle: 'Sign in',
  loginIntro: 'Sign in with the phone number and password you registered.',
  forgotTitle: 'Forgot password',
  forgotIntro:
    'Enter your registered phone number. If an email is linked to the account, we will send instructions to reset your password.',
  resetTitle: 'Reset password',
  resetIntro: 'Enter a new password for your account (8 to 128 characters).',

  fullName: 'Full name',
  phone: 'Phone number',
  phoneHint: 'Enter 0912345678 or +84912345678 — the system uses the +84… form',
  phoneCanonical: 'This phone number will be used: {phone}',
  email: 'Email (optional)',
  emailHint: 'An email is needed if you want password reset emails.',
  password: 'Password',
  passwordHint: '8 to 128 characters.',
  newPassword: 'New password',
  confirmPassword: 'Repeat new password',
  consent: 'I agree to receive offers from Pine Hill (optional)',
  consentNote: 'You can leave this unticked; booking does not depend on your choice.',

  submitRegister: 'Register',
  submitLogin: 'Sign in',
  submitForgot: 'Send request',
  submitReset: 'Reset password',
  submitting: 'Sending…',

  toLogin: 'Have an account? Sign in',
  toRegister: 'No account yet? Register',
  toForgot: 'Forgot password?',
  toNewLink: 'Request a new link',
  toLoginAfterReset: 'Go to sign in',

  issueRequired: 'Required.',
  issuePhone: 'Phone number must be 0XXXXXXXXX or +84XXXXXXXXX.',
  issueEmail: 'This email is not in a valid format.',
  issueTooShort: 'Password needs at least 8 characters.',
  issueTooLong: 'Too long.',
  issueMismatch: 'The two entries do not match.',
  fieldIssue: '{field}: {issue}',
  validationSummary: 'Please fix {count} highlighted fields.',

  phoneRegistered:
    'This phone number already has a profile at the hotel. Please contact reception for help.',
  contactGeneric:
    'Contact Pine Hill reception (details are in your booking confirmation email or at the front desk).',
  contactLine: 'Contact reception: {contact}',
  invalidCredentials: 'The phone number or password is incorrect.',
  locked:
    'This account is temporarily locked after several failed sign-ins. Try again in a few minutes or use "Forgot password".',
  rateLimited: 'You are going too fast. Try again in a few minutes.',
  resetTokenInvalid:
    'This password reset link is invalid, expired or already used. Request a new link.',
  validation: 'The server did not accept the details entered. Please check the fields.',
  unavailable: 'The system is not responding right now. Please try again later.',
  other: 'The request could not be completed. Try again or contact reception.',
  registerUnknown:
    'The registration result is not confirmed. Try signing in with the phone number and password you entered before registering again.',
  loginUnknown: 'Could not reach the system. Check your connection and try again.',
  forgotUnknown: 'The result of the request is not confirmed. Please try again.',
  resetUnknown:
    'The password reset result is not confirmed. Try signing in with the new password; if that fails, try again.',
  registeredNotSignedIn:
    'Your account was created but you could not be signed in. Sign in with the phone number and password you just registered.',

  forgotDone:
    'If this phone number has a registered email, you will receive reset instructions within a few minutes.',
  forgotNoEmail: 'No email? Contact reception for help.',
  resetDone: 'Your password has been reset. Sign in with the new password.',
  resetNotice: 'Your password has been reset. Sign in with the new password.',
  resetMissingToken: 'The link is missing its reset code. Request a new link.',
  signedInAlready: 'You are already signed in.',
};
