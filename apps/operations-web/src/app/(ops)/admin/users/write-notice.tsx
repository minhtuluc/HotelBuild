'use client';
import type { ReactElement } from 'react';
import { StateSurface, type ScreenState } from '@pinehill/ui-web';
import type { WriteFailure } from './users-model';
import { userText } from './messages';

/**
 * Lỗi của lệnh ghi: từ chối chắc chắn hiện đúng mã + lý do máy chủ trả (kể cả 403); xung đột phiên bản
 * và kết quả chưa xác định dùng bề mặt trạng thái §8.1 và chỉ cho **đọc lại**, không gửi lại mù.
 */
export function WriteNotice({
  failure,
  attemptedVersion,
  onReload,
}: {
  failure: WriteFailure;
  attemptedVersion: string;
  onReload: () => void;
}): ReactElement {
  if (failure.kind === 'rejected')
    return (
      <div role="alert" data-testid="write-rejected" style={{ display: 'grid', gap: 4 }}>
        <strong>{userText('rejected')}</strong>
        <span>{userText('rejectedCode', { code: failure.code })}</span>
        <span>{userText('rejectedReason', { reason: failure.reason })}</span>
      </div>
    );
  if (failure.kind === 'expired')
    return (
      <p role="alert" data-testid="write-expired" style={{ margin: 0 }}>
        {userText('expiredWrite')}
      </p>
    );
  const state: ScreenState =
    failure.kind === 'validation'
      ? { kind: 'validationError', details: failure.details }
      : failure.kind === 'conflict'
        ? { kind: 'conflict', currentVersion: '—', attemptedVersion, onReload }
        : { kind: 'unknownOutcome', referenceId: failure.reference, onLookup: onReload };
  return (
    <div data-testid={`write-${failure.kind}`}>
      <StateSurface state={state}>{null}</StateSurface>
    </div>
  );
}
