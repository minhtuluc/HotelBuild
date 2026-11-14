'use client';
/**
 * HB-310 (TD-06) — khung sửa / ngừng mùa của SCR-27: `PUT /seasons/{id}` qua BFF, `If-Match` của bản
 * đang xem, chỉ trường đổi, lý do bắt buộc. Thành công thì tải lại danh sách để thấy phiên bản mới do
 * máy chủ trả (giao diện không tự tăng `version`).
 */
import { createRateApi, type ApiClient } from '@pinehill/api-client';
import type { SeasonSummary } from '@pinehill/contracts';
import { useConfigEdit, type ConfigEditState } from '../../../components/use-config-edit';
import { ifMatchOf } from '../../../lib/config-edit';
import {
  seasonEditDraftOf,
  toSeasonToggle,
  toSeasonUpdate,
  validateSeasonEdit,
  type SeasonEditDraft,
} from '../../../lib/seasons';

export type SeasonEditState = ConfigEditState<SeasonSummary, SeasonEditDraft>;

export function useSeasonEdit(client: ApiClient, onSaved: (name: string) => Promise<void>) {
  return useConfigEdit({
    draftOf: seasonEditDraftOf,
    validate: (_season, draft) => validateSeasonEdit(draft),
    toUpdate: toSeasonUpdate,
    toToggle: toSeasonToggle,
    send: (season, body) =>
      createRateApi(client).updateSeason(season.id, body, ifMatchOf(season.version)),
    onSaved: (season, body) => onSaved(body.name ?? season.name),
  });
}
