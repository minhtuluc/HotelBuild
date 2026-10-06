'use client';

/**
 * SCR-51 — Mẫu & hàng đợi thông báo (UC-NOTI-01, UC-NOTI-02, BR-SYS-06).
 * Hàng đợi hiện trạng thái, số lần thử, lỗi và người nhận **đã che** (máy chủ che, giao diện không tự che).
 * Gửi lại chỉ bật khi chưa đủ 3 lần **và** lần thử gần nhất đã quá 5 phút; gửi lại kèm lý do bắt buộc.
 */
import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { createNotificationApi, isApiError } from '@pinehill/api-client';
import type { NotificationChannel, NotificationSummary } from '@pinehill/contracts';
import { StateSurface, formatDateTimeVn, type ScreenState } from '@pinehill/ui-web';
import { ScreenAlert } from '../../../../components/screen-alert';
import { useForcedState } from '../../../../components/forced-state';
import { opsApiClient } from '../../../../lib/api';
import { t } from '../../../../lib/i18n';
import { readFailureState, writeFailureState } from '../../../../lib/screen-state';
import {
  CHANNEL_LABEL_KEY,
  STATUS_LABEL_KEY,
  notiParams,
  resendIssues,
  resendRequest,
  resendState,
  type NotificationStatus,
} from '../noti-shared';

const STATUSES: readonly NotificationStatus[] = ['PENDING', 'SENT', 'FAILED'];
const CHANNELS: readonly NotificationChannel[] = ['EMAIL', 'SMS', 'ZALO_OA', 'PUSH'];

const ROW_STYLE = {
  display: 'flex',
  gap: 'var(--space-s2, 8px)',
  flexWrap: 'wrap',
  alignItems: 'end',
} as const;

const FIELD_STYLE = { display: 'grid', gap: 4 } as const;
const CELL = { textAlign: 'start', borderBottom: '1px solid var(--color-border)' } as const;

function statusOf(value: string): NotificationStatus | '' {
  return STATUSES.find((status) => status === value) ?? '';
}

function channelOf(value: string): NotificationChannel | '' {
  return CHANNELS.find((channel) => channel === value) ?? '';
}

function blockKey(
  reason: 'MAX_RETRIES' | 'TOO_SOON',
): 'noti.resend.blockedMax' | 'noti.resend.blockedSoon' {
  return reason === 'MAX_RETRIES' ? 'noti.resend.blockedMax' : 'noti.resend.blockedSoon';
}

export function NotificationsScreen({ baseUrl }: { baseUrl: string }): ReactElement {
  const forced = useForcedState();
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [rows, setRows] = useState<readonly NotificationSummary[]>([]);
  const [draft, setDraft] = useState<{
    status: NotificationStatus | '';
    channel: NotificationChannel | '';
    template: string;
  }>({
    status: '',
    channel: '',
    template: '',
  });
  const [applied, setApplied] = useState(draft);
  const [target, setTarget] = useState<NotificationSummary | null>(null);
  const [reason, setReason] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [readError, setReadError] = useState<unknown>(null);
  const canEdit = state.kind !== 'forbidden';

  const load = useCallback(
    async (filters: typeof applied): Promise<void> => {
      setReadError(null);
      try {
        const page = await createNotificationApi(opsApiClient(baseUrl)).list(notiParams(filters));
        setRows(page.data.data);
        setState(
          page.data.data.length === 0
            ? { kind: 'empty', reason: 'noData', canCreate: false }
            : { kind: 'ready' },
        );
      } catch (caught) {
        const mapped = isApiError(caught) ? readFailureState(caught) : undefined;
        if (mapped !== undefined) {
          setState(mapped);
          return;
        }
        setReadError(caught);
        setState({ kind: 'ready' });
      }
    },
    [baseUrl],
  );

  useEffect(() => {
    if (forced !== undefined) return;
    void load(applied);
  }, [forced, load, applied]);

  const submitResend = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (target === null) return;
    const issues = resendIssues(reason);
    if (issues.length > 0) {
      setState({ kind: 'validationError', details: issues });
      return;
    }
    try {
      await createNotificationApi(opsApiClient(baseUrl)).resend(target.id, resendRequest(reason));
      setSaved(t('noti.saved.resend', { id: target.id }));
      setTarget(null);
      setReason('');
      await load(applied);
    } catch (caught) {
      setState(
        writeFailureState(caught, {
          attemptedVersion: '—',
          onReload: () => void load(applied),
          onLookup: () => void load(applied),
        }),
      );
    }
  };

  if (forced !== undefined) {
    return (
      <StateSurface state={forced}>
        <p>{t('screen.demo')}</p>
      </StateSurface>
    );
  }

  const nowMs = Date.now();

  return (
    <section
      style={{ padding: 'var(--space-s6, 24px)', display: 'grid', gap: 'var(--space-s4, 16px)' }}
    >
      <h1 style={{ margin: 0 }}>{t('noti.title')}</h1>
      <p style={{ margin: 0 }}>{t('noti.intro')}</p>
      <form
        data-testid="noti-filters"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          setApplied(draft);
        }}
        style={ROW_STYLE}
      >
        <label style={FIELD_STYLE}>
          {t('noti.form.status')}
          <select
            name="status"
            value={draft.status}
            onChange={(event) => setDraft({ ...draft, status: statusOf(event.target.value) })}
          >
            <option value="">{t('noti.form.anyStatus')}</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(STATUS_LABEL_KEY[status])}
              </option>
            ))}
          </select>
        </label>
        <label style={FIELD_STYLE}>
          {t('noti.form.channel')}
          <select
            name="channel"
            value={draft.channel}
            onChange={(event) => setDraft({ ...draft, channel: channelOf(event.target.value) })}
          >
            <option value="">{t('noti.form.anyChannel')}</option>
            {CHANNELS.map((channel) => (
              <option key={channel} value={channel}>
                {t(CHANNEL_LABEL_KEY[channel])}
              </option>
            ))}
          </select>
        </label>
        <label style={FIELD_STYLE}>
          {t('noti.form.template')}
          <input
            name="template"
            value={draft.template}
            onChange={(event) => setDraft({ ...draft, template: event.target.value })}
          />
        </label>
        <button type="submit">{t('noti.form.load')}</button>
      </form>
      <StateSurface state={state}>
        {readError === null ? null : (
          <ScreenAlert error={readError} onRetry={() => void load(applied)} />
        )}
        {saved === null ? null : (
          <p role="status" data-testid="noti-saved" style={{ margin: 0 }}>
            {saved}
          </p>
        )}
        {rows.length === 0 ? null : (
          <div style={{ overflowX: 'auto' }}>
            <table data-testid="noti-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {[
                    t('noti.col.template'),
                    t('noti.col.channel'),
                    t('noti.col.recipient'),
                    t('noti.col.status'),
                    t('noti.col.retries'),
                    t('noti.col.error'),
                    t('noti.col.sentAt'),
                    t('noti.col.createdAt'),
                    t('noti.col.actions'),
                  ].map((label) => (
                    <th key={label} scope="col" style={CELL}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const resend = resendState(row, nowMs);
                  return (
                    <tr key={row.id} data-testid={`noti-row-${row.id}`}>
                      <td style={CELL}>{row.template}</td>
                      <td style={CELL}>{t(CHANNEL_LABEL_KEY[row.channel])}</td>
                      <td style={CELL}>{row.recipientMasked}</td>
                      <td style={CELL}>
                        {t(STATUS_LABEL_KEY[row.status])}
                        {row.status === 'FAILED' && row.retryCount >= 3 ? (
                          <span role="note"> · {t('noti.failed.warning')}</span>
                        ) : null}
                      </td>
                      <td style={CELL}>{row.retryCount}</td>
                      <td style={CELL} data-testid={`noti-error-${row.id}`}>
                        {row.errorMessage ?? '—'}
                      </td>
                      <td style={CELL}>
                        {row.sentAt === null ? '—' : formatDateTimeVn(row.sentAt)}
                      </td>
                      <td style={CELL}>{formatDateTimeVn(row.createdAt)}</td>
                      <td style={CELL}>
                        {canEdit ? (
                          <div style={ROW_STYLE}>
                            <button
                              type="button"
                              data-testid={`noti-resend-${row.id}`}
                              disabled={!resend.allowed}
                              onClick={() => {
                                setSaved(null);
                                setReason('');
                                setTarget(row);
                              }}
                            >
                              {t('noti.action.resend')}
                            </button>
                            {resend.reason === null ? null : (
                              <span data-testid={`noti-block-${row.id}`} role="note">
                                {t(blockKey(resend.reason))}
                              </span>
                            )}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {target === null ? null : (
          <form
            data-testid="noti-resend-form"
            onSubmit={(event) => void submitResend(event)}
            style={{ display: 'grid', gap: 'var(--space-s2, 8px)', maxWidth: 480 }}
          >
            <legend>
              {t('noti.action.resend')} · {target.id}
            </legend>
            <label style={FIELD_STYLE}>
              {t('noti.resend.reason')}
              <input
                name="reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            <button type="submit">{t('noti.resend.submit')}</button>
            <button type="button" onClick={() => setTarget(null)}>
              {t('noti.resend.cancel')}
            </button>
          </form>
        )}
      </StateSurface>
    </section>
  );
}
