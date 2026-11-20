/**
 * HB-275 — mốc thời gian UTC hiện theo giờ Việt Nam, ngày/giờ theo ngôn ngữ đang chọn (`@pinehill/i18n`).
 * Tiếng Việt giữ đúng định dạng cũ `20/11/2026 12:30 (giờ VN)`.
 */
import { dateTimeVn } from '@pinehill/i18n';
import { t } from '../strings';
import { currentLocale } from './locale';

export function dateTimeLabel(isoUtc: string): string {
  return dateTimeVn(isoUtc, currentLocale(), t('format.vnTime'));
}
