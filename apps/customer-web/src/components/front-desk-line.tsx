'use client';
/**
 * Dòng liên hệ lễ tân cạnh nút "Thử lại" khi lỗi mạng ở bước báo giá và điền thông tin (HB-323, P6).
 *
 * Chủ dự án quyết (15/11/2026): chỉ hiện liên hệ lễ tân, không mở `mailto:` hay giữ chỗ ngoài hệ thống. Số lễ
 * tân đọc từ `NEXT_PUBLIC_FRONT_DESK_CONTACT` ở trang máy chủ (`frontDeskContact()`) rồi truyền xuống; chưa
 * cấu hình thì hiện lời hướng dẫn chung thay vì số giả.
 */
import type { ReactElement } from 'react';
import { useT } from '../i18n/client';
import type { CustomerTranslate } from '../i18n/translate';

/** Câu liên hệ theo cấu hình. Thuần, để test. */
export function frontDeskLine(t: CustomerTranslate, contact: string | null): string {
  return contact === null
    ? t('guest.contact.frontDeskGeneric')
    : t('guest.contact.frontDesk', { contact });
}

export function FrontDeskLine({ contact }: { contact: string | null }): ReactElement {
  const t = useT();
  return (
    <p className="ph-front-desk-line" data-testid="front-desk-line">
      {frontDeskLine(t, contact)}
    </p>
  );
}
