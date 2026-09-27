/**
 * Hợp đồng trạng thái UI dùng chung (§8.1) — 9 trạng thái bắt buộc cho mọi màn hình có tải dữ liệu.
 * Quy tắc: không hiện số 0 hay thành công giả khi chưa có dữ liệu; không rò chi tiết đối tượng ngoài
 * phạm vi; không last-write-wins; hết hạn thì khoá xác nhận; ghi thất bại không rõ kết quả không được
 * gọi là "thất bại chắc chắn".
 */
'use client';

import type { ReactElement, ReactNode } from 'react';
import { formatDateTimeVn } from './format.js';
import { useTranslate } from './i18n.js';

export type ScreenState =
  | { kind: 'ready' }
  | { kind: 'loading' }
  | { kind: 'refreshing'; updatedAt: string; stale: boolean }
  | {
      kind: 'empty';
      reason: 'noData' | 'filtered' | 'soldOut';
      canCreate: boolean;
      onCreate?: () => void | undefined;
    }
  | { kind: 'validationError'; details: readonly { field: string; issue: string }[] }
  | { kind: 'forbidden' }
  | { kind: 'conflict'; currentVersion: string; attemptedVersion: string; onReload: () => void }
  | { kind: 'expired'; expiresAt: string; onReload: () => void }
  | { kind: 'unknownOutcome'; referenceId: string; onLookup: () => void }
  | { kind: 'success'; onCreateNext?: () => void };

export interface StateSurfaceProps {
  state: ScreenState;
  children?: ReactNode;
}

/** `{field}` đến từ server nên phải escape trước khi dựng selector. */
export function focusFieldByName(field: string): boolean {
  const escaped =
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(field)
      : field.replace(/["\\]/g, '\\$&');
  const node = document.querySelector(`[name="${escaped}"]`);
  if (!(node instanceof HTMLElement)) return false;
  node.focus();
  return true;
}

function LoadingBlock(): ReactElement {
  const t = useTranslate();
  return (
    <div role="status" aria-busy="true" aria-live="polite" style={{ padding: 16 }}>
      {t('state.loading')}
    </div>
  );
}

function EmptyBlock({
  reason,
  canCreate,
  onCreate,
}: {
  reason: 'noData' | 'filtered' | 'soldOut';
  canCreate: boolean;
  onCreate?: (() => void) | undefined;
}): ReactElement {
  const t = useTranslate();
  const key =
    reason === 'noData'
      ? 'state.empty.noData'
      : reason === 'filtered'
        ? 'state.empty.filtered'
        : 'state.empty.soldOut';
  return (
    <div role="status" style={{ padding: 16 }}>
      <p>{t(key)}</p>
      {canCreate && onCreate !== undefined ? (
        <button type="button" onClick={onCreate}>
          {t('state.empty.create')}
        </button>
      ) : null}
    </div>
  );
}

function ForbiddenBlock(): ReactElement {
  const t = useTranslate();
  return (
    <div role="alert" style={{ padding: 16 }}>
      {t('state.forbidden')}
    </div>
  );
}

function ConflictBlock({
  state,
}: {
  state: Extract<ScreenState, { kind: 'conflict' }>;
}): ReactElement {
  const t = useTranslate();
  return (
    <div role="alert" style={{ padding: 16 }}>
      <p>
        {t('state.conflict', { attempted: state.attemptedVersion, current: state.currentVersion })}
      </p>
      <button type="button" onClick={state.onReload}>
        {t('state.conflict.reload')}
      </button>
    </div>
  );
}

function ExpiredBlock({
  state,
}: {
  state: Extract<ScreenState, { kind: 'expired' }>;
}): ReactElement {
  const t = useTranslate();
  return (
    <div role="alert" style={{ padding: 16 }}>
      <p>{t('state.expired', { time: formatDateTimeVn(state.expiresAt) })}</p>
      <button type="button" onClick={state.onReload}>
        {t('state.expired.reload')}
      </button>
    </div>
  );
}

function UnknownOutcomeBlock({
  state,
}: {
  state: Extract<ScreenState, { kind: 'unknownOutcome' }>;
}): ReactElement {
  const t = useTranslate();
  return (
    <div role="alert" style={{ padding: 16 }}>
      <p>{t('state.unknownOutcome', { reference: state.referenceId })}</p>
      <button type="button" onClick={state.onLookup}>
        {t('state.unknownOutcome.lookup')}
      </button>
    </div>
  );
}

function SuccessBlock({
  state,
}: {
  state: Extract<ScreenState, { kind: 'success' }>;
}): ReactElement {
  const t = useTranslate();
  return (
    <div role="status" aria-live="polite" style={{ padding: 16 }}>
      <p>{t('state.success')}</p>
      {state.onCreateNext === undefined ? null : (
        <button type="button" onClick={state.onCreateNext}>
          {t('state.empty.create')}
        </button>
      )}
    </div>
  );
}

/** Trạng thái thay thế hoàn toàn nội dung: không render children để không lộ dữ liệu hay cho xác nhận. */
function replacedContent(state: ScreenState): ReactElement | null {
  switch (state.kind) {
    case 'loading':
      return <LoadingBlock />;
    case 'empty':
      return (
        <EmptyBlock reason={state.reason} canCreate={state.canCreate} onCreate={state.onCreate} />
      );
    case 'forbidden':
      return <ForbiddenBlock />;
    case 'conflict':
      return <ConflictBlock state={state} />;
    case 'expired':
      return <ExpiredBlock state={state} />;
    case 'unknownOutcome':
      return <UnknownOutcomeBlock state={state} />;
    case 'success':
      return <SuccessBlock state={state} />;
    default:
      return null;
  }
}

function RefreshingBanner({
  state,
}: {
  state: Extract<ScreenState, { kind: 'refreshing' }>;
}): ReactElement {
  const t = useTranslate();
  return (
    <div role="status" aria-live="polite" style={{ padding: 16 }}>
      <span>{t('state.refreshing', { time: formatDateTimeVn(state.updatedAt) })}</span>
      {state.stale ? <span role="note"> · {t('state.refreshing.stale')}</span> : null}
    </div>
  );
}

function ValidationSummary({
  state,
}: {
  state: Extract<ScreenState, { kind: 'validationError' }>;
}): ReactElement {
  const t = useTranslate();
  return (
    <div role="alert" style={{ padding: 16 }}>
      <p>{t('state.validation', { count: state.details.length })}</p>
      <ul>
        {state.details.map((detail) => (
          <li key={detail.field}>
            <button
              type="button"
              onClick={() => {
                focusFieldByName(detail.field);
              }}
            >
              {t('state.validation.field', { field: detail.field, issue: detail.issue })}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Trạng thái bọc quanh nội dung, giữ nguyên dữ liệu và bản nhập đang có. */
function surroundingContent(state: ScreenState): ReactElement | null {
  switch (state.kind) {
    case 'refreshing':
      return <RefreshingBanner state={state} />;
    case 'validationError':
      return <ValidationSummary state={state} />;
    default:
      return null;
  }
}

export function StateSurface({ state, children }: StateSurfaceProps): ReactElement {
  const replacement = replacedContent(state);
  if (replacement !== null) return replacement;
  return (
    <>
      {surroundingContent(state)}
      {children}
    </>
  );
}
