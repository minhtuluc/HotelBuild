/**
 * Bản tiếng Anh của danh mục dùng chung `ui-web` (trạng thái, lỗi, định dạng) cho customer web — HB-312.
 * Bản dịch do frontend soạn cho demo (quyết định Q6).
 */
import type { MessageKey } from '@pinehill/ui-web/messages';

export const enUiWeb: Readonly<Record<MessageKey, string>> = {
  'common.skipToContent': 'Skip to main content',
  'state.loading': 'Loading…',
  'state.refreshing': 'Updated at {time}',
  'state.refreshing.stale': 'Showing earlier data',
  'state.empty.noData': 'No data yet',
  'state.empty.filtered': 'Nothing matches the filters',
  'state.empty.soldOut': 'Sold out for the selected stay',
  'state.empty.create': 'Create new',
  'state.validation': 'Please fix {count} highlighted fields',
  'state.validation.field': '{field}: {issue}',
  'state.forbidden': 'You do not have permission to view this',
  'state.conflict': 'The data has changed: your version {attempted}, current version {current}',
  'state.conflict.reload': 'Reload and compare',
  'state.expired': 'This content expired at {time}',
  'state.expired.reload': 'Reload',
  'state.unknownOutcome':
    'The result is not confirmed yet. Do not resend; look it up with reference {reference}',
  'state.unknownOutcome.lookup': 'Look up the result',
  'state.success': 'Confirmed by the server',
  'action.enterPin': 'Enter PIN again',
  'action.reauth': 'Sign in again',
  'action.changePassword': 'Change password',
  'action.requestNewLink': 'Request a new link',
  'action.requestAccess': 'Request access',
  'action.notFound': 'Back to the list',
  'action.newKey': 'Resend with a new key',
  'action.retryAfter': 'Try again in a few minutes',
  'action.reloadAndDiff': 'Reload and compare',
  'action.restartQuote': 'Get a new quote',
  'action.reloadAndReselect': 'Reload and choose again',
  'action.fixFields': 'Fix the flagged fields',
  'action.retryLater': 'Try again later',
  'action.contactSupport': 'Contact support',
  'error.boundary.title': 'This screen ran into an unexpected error',
  'error.accountLocked': 'This account is temporarily locked. Try again in {minutes} minutes.',
  'error.rateLimited': 'Too many requests. Try again in {minutes} minutes.',
  'error.channelSignature':
    'The sales channel webhook signature is invalid or its timestamp is outside the allowed window.',
  'error.channelReplay':
    'This OTA event ID was already used with different content. Quarantine and reconcile before continuing.',
  'error.channelSyncFailed':
    'Sync to the sales channel failed. The system will retry automatically.',
  'error.overNoConsent': 'Both guests must agree before sharing a room.',
  'error.overMergeGender':
    'A manager has not approved sharing a room between guests of different genders.',
  'error.overNoPlan': 'No relocation option is available; switching to walk-out.',
  'error.overMoveNotAllowed':
    'The guest has checked in: relocation needs a force majeure reason and manager approval.',
  'error.overApprovalRequired':
    'A manager must approve the relocation cost before it is carried out.',
  'error.overCrossCity':
    'The guest has not agreed in writing to move to a property in another city.',
  'error.overCaseDeadline':
    'The overbooking case passed its T−24h deadline and was escalated. Keep handling it on site; do not close the case yourself.',
  'error.compensationUnknown':
    'The compensation payout result is not confirmed. Do not pay again; look it up with reference {reference}.',
  'error.boundary.body':
    'Technical details are hidden. Try again; if it still fails, send the reference code to support.',
  'error.boundary.retry': 'Try again',
  'access.denied.title': 'Access not allowed',
  'access.denied.body':
    'Your account does not have access to this area. Contact the property manager if you need it.',
  'access.denied.back': 'Back to the main page',
  'api.probe.title': 'System status',
  'api.probe.ok': 'The booking system is running',
  'api.probe.failed': 'The booking system is interrupted ({code})',
  'format.stayPeriod': '{nights} nights · {adults} adults · {children} children',
  'format.remaining.hours': '{hours} h {minutes} min left',
  'format.remaining.minutes': '{minutes} min left',
};
