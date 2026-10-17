'use client';

/**
 * SCR-49 — Hồ sơ khách & danh sách đen (UC-CRM-01…03, BR-CRM-01,04,05).
 * Tra cứu hồ sơ, thêm/gỡ danh sách đen (lý do bắt buộc) và **ẩn danh hoá có hộp xác nhận + lý do**.
 * Không có thao tác xoá cứng hồ sơ (§2.14); PII do máy chủ che theo vai trò trước khi trả về (NFR-SEC-03).
 */
import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { createGuestApi, isApiError, type ApiClient } from '@pinehill/api-client';
import type { GuestSummary, LoyaltyTier } from '@pinehill/contracts';
import { StateSurface, formatDateTimeVn, type ScreenState } from '@pinehill/ui-web';
import { ScreenAlert } from '../../../../components/screen-alert';
import { useForcedState } from '../../../../components/forced-state';
import { useOpsSession } from '../../../../lib/ops-session';
import { t } from '../../../../lib/i18n';
import { readFailureState, writeFailureState } from '../../../../lib/screen-state';
import {
  EMPTY_SEARCH,
  anonymizeIssues,
  anonymizeRequest,
  blacklistIssues,
  searchParams,
  TIER_LABEL_KEY,
  type GuestSearch,
} from '../crm-shared';

const TIERS: readonly LoyaltyTier[] = ['GUEST', 'MEMBER', 'SILVER', 'GOLD', 'PLATINUM'];

const ROW_STYLE = {
  display: 'flex',
  gap: 'var(--space-s2, 8px)',
  flexWrap: 'wrap',
  alignItems: 'end',
} as const;

const FIELD_STYLE = { display: 'grid', gap: 4 } as const;
const CELL = { textAlign: 'start', borderBottom: '1px solid var(--color-border)' } as const;

type ActionKind = 'anonymize' | 'blacklist' | 'release';

interface PendingAction {
  kind: ActionKind;
  guest: GuestSummary;
}

function blacklistFilterOf(value: string): GuestSearch['blacklisted'] {
  if (value === 'YES') return 'YES';
  return value === 'NO' ? 'NO' : 'ALL';
}

function tierOf(value: string): LoyaltyTier | '' {
  return TIERS.find((tier) => tier === value) ?? '';
}

function actionTitleKey(
  kind: ActionKind,
): 'crm.anonymize.title' | 'crm.action.blacklist' | 'crm.action.release' {
  if (kind === 'anonymize') return 'crm.anonymize.title';
  return kind === 'blacklist' ? 'crm.action.blacklist' : 'crm.action.release';
}

/** Gọi đúng tuyến theo hành động đã chọn, trả câu xác nhận đã lưu (không có đường xoá cứng). */
async function performAction(
  client: ApiClient,
  action: PendingAction,
  reason: string,
): Promise<string> {
  const api = createGuestApi(client);
  const { kind, guest } = action;
  if (kind === 'anonymize') {
    await api.anonymize(guest.id, anonymizeRequest(reason, new Date().toISOString()));
    return t('crm.saved.anonymized', { name: guest.fullName });
  }
  if (kind === 'blacklist') {
    await api.addBlacklist(guest.id, { blacklistReason: reason.trim() });
    return t('crm.saved.blacklisted', { name: guest.fullName });
  }
  await api.removeBlacklist(guest.id, reason.trim());
  return t('crm.saved.released', { name: guest.fullName });
}

export function GuestsScreen(): ReactElement {
  const forced = useForcedState();
  const session = useOpsSession(['/guests'], {
    onExpired: () => setState({ kind: 'forbidden' }),
  });
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [guests, setGuests] = useState<readonly GuestSummary[]>([]);
  const [draft, setDraft] = useState<GuestSearch>(EMPTY_SEARCH);
  const [applied, setApplied] = useState<GuestSearch>(EMPTY_SEARCH);
  const [action, setAction] = useState<PendingAction | null>(null);
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [readError, setReadError] = useState<unknown>(null);
  const canEdit = state.kind !== 'forbidden';

  const load = useCallback(
    async (filters: GuestSearch): Promise<void> => {
      setReadError(null);
      try {
        const page = await createGuestApi(session.client).list(searchParams(filters));
        setGuests(page.data.data);
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
    [session],
  );

  useEffect(() => {
    if (forced !== undefined) return;
    void load(applied);
  }, [forced, load, applied]);

  const openAction = (kind: ActionKind, guest: GuestSummary): void => {
    setSaved(null);
    setReason('');
    setConfirmed(false);
    setAction({ kind, guest });
  };

  const submitAction = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (action === null) return;
    const issues =
      action.kind === 'anonymize' ? anonymizeIssues(reason, confirmed) : blacklistIssues(reason);
    if (issues.length > 0) {
      setState({ kind: 'validationError', details: issues });
      return;
    }
    try {
      setSaved(await performAction(session.client, action, reason));
      setAction(null);
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

  const actionTitle = action === null ? '' : t(actionTitleKey(action.kind));

  return (
    <section
      style={{ padding: 'var(--space-s6, 24px)', display: 'grid', gap: 'var(--space-s4, 16px)' }}
    >
      <h1 style={{ margin: 0 }}>{t('crm.guests.title')}</h1>
      <p style={{ margin: 0 }}>{t('crm.guests.intro')}</p>
      <form
        data-testid="guest-search"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          setApplied(draft);
        }}
        style={ROW_STYLE}
      >
        <label style={FIELD_STYLE}>
          {t('crm.search.q')}
          <input
            name="q"
            value={draft.q}
            onChange={(event) => setDraft({ ...draft, q: event.target.value })}
          />
        </label>
        <label style={FIELD_STYLE}>
          {t('crm.search.tier')}
          <select
            name="loyaltyTier"
            value={draft.loyaltyTier}
            onChange={(event) => setDraft({ ...draft, loyaltyTier: tierOf(event.target.value) })}
          >
            <option value="">{t('crm.search.allTiers')}</option>
            {TIERS.map((tier) => (
              <option key={tier} value={tier}>
                {t(TIER_LABEL_KEY[tier])}
              </option>
            ))}
          </select>
        </label>
        <label style={FIELD_STYLE}>
          {t('crm.search.blacklisted')}
          <select
            name="blacklisted"
            value={draft.blacklisted}
            onChange={(event) =>
              setDraft({ ...draft, blacklisted: blacklistFilterOf(event.target.value) })
            }
          >
            <option value="ALL">{t('crm.search.blacklistAll')}</option>
            <option value="YES">{t('crm.search.blacklistYes')}</option>
            <option value="NO">{t('crm.search.blacklistNo')}</option>
          </select>
        </label>
        <button type="submit">{t('crm.search.submit')}</button>
      </form>
      <StateSurface state={state}>
        {readError === null ? null : (
          <ScreenAlert error={readError} onRetry={() => void load(applied)} />
        )}
        {saved === null ? null : (
          <p role="status" data-testid="crm-saved" style={{ margin: 0 }}>
            {saved}
          </p>
        )}
        {guests.length === 0 ? null : (
          <div style={{ overflowX: 'auto' }}>
            <table data-testid="guests-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {[
                    t('crm.col.guest'),
                    t('crm.col.phone'),
                    t('crm.col.email'),
                    t('crm.col.tier'),
                    t('crm.col.points'),
                    t('crm.col.stays'),
                    t('crm.col.blacklist'),
                    t('crm.col.createdAt'),
                    t('crm.col.actions'),
                  ].map((label) => (
                    <th key={label} scope="col" style={CELL}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {guests.map((guest) => (
                  <tr key={guest.id} data-testid={`guest-${guest.id}`}>
                    <td style={CELL}>{guest.fullName}</td>
                    <td style={CELL}>{guest.phone}</td>
                    <td style={CELL}>{guest.email ?? '—'}</td>
                    <td style={CELL}>{t(TIER_LABEL_KEY[guest.loyaltyTier])}</td>
                    <td style={CELL}>{guest.loyaltyPoints}</td>
                    <td style={CELL}>{guest.totalStays}</td>
                    <td style={CELL}>
                      {guest.blacklisted ? t('crm.blacklisted.yes') : t('crm.blacklisted.no')}
                    </td>
                    <td style={CELL}>{formatDateTimeVn(guest.createdAt)}</td>
                    <td style={CELL}>
                      {canEdit ? (
                        <div style={ROW_STYLE}>
                          <button type="button" onClick={() => openAction('anonymize', guest)}>
                            {t('crm.action.anonymize')}
                          </button>
                          {guest.blacklisted ? (
                            <button type="button" onClick={() => openAction('release', guest)}>
                              {t('crm.action.release')}
                            </button>
                          ) : (
                            <button type="button" onClick={() => openAction('blacklist', guest)}>
                              {t('crm.action.blacklist')}
                            </button>
                          )}
                          <a href={`/crm/loyalty?guestId=${encodeURIComponent(guest.id)}`}>
                            {t('crm.action.loyalty')}
                          </a>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {action === null ? null : (
          <form
            data-testid="guest-action"
            onSubmit={(event) => void submitAction(event)}
            style={{ display: 'grid', gap: 'var(--space-s2, 8px)', maxWidth: 520 }}
          >
            <legend>
              {actionTitle} · {action.guest.fullName}
            </legend>
            {action.kind === 'anonymize' ? (
              <>
                <p role="note" style={{ margin: 0 }}>
                  {t('crm.anonymize.warning')}
                </p>
                <label style={FIELD_STYLE}>
                  {t('crm.anonymize.reason')}
                  <input
                    name="reason"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </label>
                <label style={FIELD_STYLE}>
                  <input
                    name="confirmed"
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />
                  {t('crm.anonymize.confirm')}
                </label>
                <button type="submit">{t('crm.anonymize.submit')}</button>
              </>
            ) : (
              <>
                <label style={FIELD_STYLE}>
                  {action.kind === 'blacklist'
                    ? t('crm.blacklist.reason')
                    : t('crm.release.reason')}
                  <input
                    name="reason"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </label>
                <button type="submit">
                  {action.kind === 'blacklist'
                    ? t('crm.blacklist.submit')
                    : t('crm.release.submit')}
                </button>
              </>
            )}
            <button type="button" onClick={() => setAction(null)}>
              {t('crm.cancel')}
            </button>
          </form>
        )}
      </StateSurface>
    </section>
  );
}
