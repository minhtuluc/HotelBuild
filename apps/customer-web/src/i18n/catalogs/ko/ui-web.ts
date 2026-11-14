/**
 * Bản tiếng Hàn của danh mục dùng chung `ui-web` cho customer web — HB-313.
 * Bản dịch do frontend soạn cho demo (quyết định Q6); cần người bản ngữ duyệt trước ngày phát hành công khai.
 */
import type { MessageKey } from '@pinehill/ui-web/messages';

export const koUiWeb: Readonly<Record<MessageKey, string>> = {
  'common.skipToContent': '본문으로 건너뛰기',
  'state.loading': '불러오는 중…',
  'state.refreshing': '{time}에 업데이트됨',
  'state.refreshing.stale': '이전 데이터를 표시하고 있습니다',
  'state.empty.noData': '아직 데이터가 없습니다',
  'state.empty.filtered': '필터에 맞는 결과가 없습니다',
  'state.empty.soldOut': '선택한 일정은 매진입니다',
  'state.empty.create': '새로 만들기',
  'state.validation': '표시된 {count}개 항목을 수정해 주세요',
  'state.validation.field': '{field}: {issue}',
  'state.forbidden': '이 내용을 볼 권한이 없습니다',
  'state.conflict': '데이터가 변경되었습니다: 내 버전 {attempted}, 현재 버전 {current}',
  'state.conflict.reload': '새로고침 후 비교',
  'state.expired': '이 내용은 {time}에 만료되었습니다',
  'state.expired.reload': '새로고침',
  'state.unknownOutcome':
    '결과가 아직 확인되지 않았습니다. 다시 보내지 말고 참조 번호 {reference}로 조회하세요',
  'state.unknownOutcome.lookup': '결과 조회',
  'state.success': '서버에서 확인됨',
  'action.enterPin': 'PIN 다시 입력',
  'action.reauth': '다시 로그인',
  'action.changePassword': '비밀번호 변경',
  'action.requestNewLink': '새 링크 요청',
  'action.requestAccess': '접근 권한 요청',
  'action.notFound': '목록으로 돌아가기',
  'action.newKey': '새 키로 다시 보내기',
  'action.retryAfter': '몇 분 후 다시 시도하세요',
  'action.reloadAndDiff': '새로고침 후 비교',
  'action.restartQuote': '견적 다시 받기',
  'action.reloadAndReselect': '새로고침 후 다시 선택',
  'action.fixFields': '표시된 항목 수정',
  'action.retryLater': '나중에 다시 시도하세요',
  'action.contactSupport': '고객 지원 문의',
  'error.boundary.title': '이 화면에서 예기치 않은 오류가 발생했습니다',
  'error.accountLocked': '이 계정은 일시적으로 잠겼습니다. {minutes}분 후 다시 시도하세요.',
  'error.rateLimited': '요청이 너무 많습니다. {minutes}분 후 다시 시도하세요.',
  'error.channelSignature':
    '판매 채널 webhook 서명이 유효하지 않거나 타임스탬프가 허용 범위를 벗어났습니다.',
  'error.channelReplay':
    '이 OTA 이벤트 ID는 다른 내용으로 이미 사용되었습니다. 계속하기 전에 격리하고 대사하세요.',
  'error.channelSyncFailed': '판매 채널 동기화에 실패했습니다. 시스템이 자동으로 다시 시도합니다.',
  'error.overNoConsent': '두 분 모두 동의해야 객실을 함께 쓸 수 있습니다.',
  'error.overMergeGender': '성별이 다른 고객의 객실 공유를 매니저가 아직 승인하지 않았습니다.',
  'error.overNoPlan': '이동할 수 있는 방안이 없어 외부 숙소 안내로 전환합니다.',
  'error.overMoveNotAllowed':
    '고객이 이미 체크인했습니다. 이동하려면 불가항력 사유와 매니저 승인이 필요합니다.',
  'error.overApprovalRequired': '이동 비용은 실행 전에 매니저 승인이 필요합니다.',
  'error.overCrossCity': '고객이 다른 도시의 숙소로 이동하는 데 서면 동의하지 않았습니다.',
  'error.overCaseDeadline':
    '오버부킹 건이 T−24h 기한을 넘겨 상부에 보고되었습니다. 현장 처리를 계속하고 건을 직접 종료하지 마세요.',
  'error.compensationUnknown':
    '보상금 지급 결과가 확인되지 않았습니다. 다시 지급하지 말고 참조 번호 {reference}로 조회하세요.',
  'error.boundary.body':
    '기술 정보는 표시하지 않습니다. 다시 시도해 보시고, 계속 실패하면 참조 번호를 고객 지원에 보내 주세요.',
  'error.boundary.retry': '다시 시도',
  'access.denied.title': '접근할 수 없습니다',
  'access.denied.body':
    '이 계정은 이 영역에 접근할 수 없습니다. 필요하면 숙소 관리자에게 문의하세요.',
  'access.denied.back': '메인 페이지로 돌아가기',
  'api.probe.title': '시스템 상태',
  'api.probe.ok': '예약 시스템이 정상 작동 중입니다',
  'api.probe.failed': '예약 시스템이 중단되었습니다 ({code})',
  'format.stayPeriod': '{nights}박 · 성인 {adults}명 · 어린이 {children}명',
  'format.remaining.hours': '{hours}시간 {minutes}분 남음',
  'format.remaining.minutes': '{minutes}분 남음',
};
