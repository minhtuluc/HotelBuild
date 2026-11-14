/**
 * Bản tiếng Nga của danh mục dùng chung `ui-web` cho customer web — HB-313.
 * Bản dịch do frontend soạn cho demo (quyết định Q6); cần người bản ngữ duyệt trước ngày phát hành công khai.
 */
import type { MessageKey } from '@pinehill/ui-web/messages';

export const ruUiWeb: Readonly<Record<MessageKey, string>> = {
  'common.skipToContent': 'Перейти к основному содержанию',
  'state.loading': 'Загрузка…',
  'state.refreshing': 'Обновлено в {time}',
  'state.refreshing.stale': 'Показаны более ранние данные',
  'state.empty.noData': 'Данных пока нет',
  'state.empty.filtered': 'Ничего не найдено по фильтрам',
  'state.empty.soldOut': 'На выбранные даты мест нет',
  'state.empty.create': 'Создать',
  'state.validation': 'Исправьте отмеченные поля: {count}',
  'state.validation.field': '{field}: {issue}',
  'state.forbidden': 'У вас нет прав на просмотр',
  'state.conflict': 'Данные изменились: ваша версия {attempted}, текущая версия {current}',
  'state.conflict.reload': 'Обновить и сравнить',
  'state.expired': 'Срок действия истёк {time}',
  'state.expired.reload': 'Обновить',
  'state.unknownOutcome':
    'Результат ещё не подтверждён. Не отправляйте повторно; проверьте по номеру {reference}',
  'state.unknownOutcome.lookup': 'Проверить результат',
  'state.success': 'Подтверждено сервером',
  'action.enterPin': 'Ввести PIN ещё раз',
  'action.reauth': 'Войти снова',
  'action.changePassword': 'Сменить пароль',
  'action.requestNewLink': 'Запросить новую ссылку',
  'action.requestAccess': 'Запросить доступ',
  'action.notFound': 'Вернуться к списку',
  'action.newKey': 'Отправить с новым ключом',
  'action.retryAfter': 'Повторите через несколько минут',
  'action.reloadAndDiff': 'Обновить и сравнить',
  'action.restartQuote': 'Получить новый расчёт',
  'action.reloadAndReselect': 'Обновить и выбрать заново',
  'action.fixFields': 'Исправить отмеченные поля',
  'action.retryLater': 'Повторите позже',
  'action.contactSupport': 'Связаться с поддержкой',
  'error.boundary.title': 'На этой странице произошла непредвиденная ошибка',
  'error.accountLocked': 'Аккаунт временно заблокирован. Повторите через {minutes} мин.',
  'error.rateLimited': 'Слишком много запросов. Повторите через {minutes} мин.',
  'error.channelSignature':
    'Подпись webhook канала продаж недействительна или метка времени вне допустимого окна.',
  'error.channelReplay':
    'Этот ID события OTA уже использован с другим содержимым. Изолируйте и сверьте, прежде чем продолжать.',
  'error.channelSyncFailed':
    'Не удалось синхронизировать с каналом продаж. Система повторит попытку автоматически.',
  'error.overNoConsent': 'Чтобы жить в одном номере, нужно согласие обоих гостей.',
  'error.overMergeGender': 'Менеджер ещё не одобрил совместное проживание гостей разного пола.',
  'error.overNoPlan': 'Вариантов переселения нет; переходим к размещению в другом отеле.',
  'error.overMoveNotAllowed':
    'Гость уже заселился: для переселения нужна причина форс-мажора и одобрение менеджера.',
  'error.overApprovalRequired': 'Расходы на переселение должен одобрить менеджер до выполнения.',
  'error.overCrossCity': 'Гость не дал письменного согласия на переезд в отель другого города.',
  'error.overCaseDeadline':
    'Случай овербукинга превысил срок T−24h и передан выше. Продолжайте работу на месте и не закрывайте случай сами.',
  'error.compensationUnknown':
    'Результат выплаты компенсации не подтверждён. Не платите повторно; проверьте по номеру {reference}.',
  'error.boundary.body':
    'Технические подробности скрыты. Попробуйте ещё раз; если ошибка повторится, отправьте номер обращения в поддержку.',
  'error.boundary.retry': 'Попробовать ещё раз',
  'access.denied.title': 'Доступ запрещён',
  'access.denied.body':
    'У вашего аккаунта нет доступа к этому разделу. При необходимости обратитесь к управляющему отелем.',
  'access.denied.back': 'На главную',
  'api.probe.title': 'Состояние системы',
  'api.probe.ok': 'Система бронирования работает',
  'api.probe.failed': 'Система бронирования недоступна ({code})',
  'format.stayPeriod': 'Ночей: {nights} · взрослых: {adults} · детей: {children}',
  'format.remaining.hours': 'Осталось {hours} ч {minutes} мин',
  'format.remaining.minutes': 'Осталось {minutes} мин',
};
