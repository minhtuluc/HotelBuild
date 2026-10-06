'use client';

/**
 * SCR-50 — Hạng & điểm khách hàng (UC-CRM-02, BR-CRM-02, BR-CRM-03).
 * Hạng, điểm tích luỹ, số lần ở 12 tháng và tổng số lần ở đọc nguyên từ máy chủ; giao diện **không**
 * tự suy hạng hay cộng điểm. `guestId` nhận từ truy vấn (đi từ SCR-49) hoặc chọn trong danh sách.
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { useSearchParams } from 'next/navigation';
import { createGuestApi, isApiError } from '@pinehill/api-client';
import type { GuestLoyalty, GuestSummary } from '@pinehill/contracts';
import { StateSurface, formatDateTimeVn, type ScreenState } from '@pinehill/ui-web';
import { ScreenAlert } from '../../../../components/screen-alert';
import { useForcedState } from '../../../../components/forced-state';
import { opsApiClient } from '../../../../lib/api';
import { t } from '../../../../lib/i18n';
import { readFailureState } from '../../../../lib/screen-state';
import { EMPTY_SEARCH, searchParams, TIER_LABEL_KEY } from '../crm-shared';

const FIELD_STYLE = { display: 'grid', gap: 4 } as const;

interface Loaded {
  guests: readonly GuestSummary[];
  guestId: string;
  loyalty: GuestLoyalty;
}

export function LoyaltyScreen({ baseUrl }: { baseUrl: string }): ReactElement {
  const forced = useForcedState();
  const params = useSearchParams();
  const wanted = params.get('guestId') ?? '';
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [guests, setGuests] = useState<readonly GuestSummary[]>([]);
  const [guestId, setGuestId] = useState(wanted);
  const [loyalty, setLoyalty] = useState<GuestLoyalty | null>(null);
  const [readError, setReadError] = useState<unknown>(null);

  const load = useCallback(
    async (chosen: string): Promise<void> => {
      setReadError(null);
      try {
        const api = createGuestApi(opsApiClient(baseUrl));
        const guestPage = await api.list(searchParams(EMPTY_SEARCH));
        const list = guestPage.data.data;
        const target = chosen === '' ? (list[0]?.id ?? '') : chosen;
        const loaded: Loaded | null =
          target === ''
            ? null
            : { guests: list, guestId: target, loyalty: (await api.loyalty(target)).data };
        if (loaded === null) {
          setGuests(list);
          setLoyalty(null);
          setState({ kind: 'empty', reason: 'noData', canCreate: false });
          return;
        }
        setGuests(loaded.guests);
        setGuestId(loaded.guestId);
        setLoyalty(loaded.loyalty);
        setState({ kind: 'ready' });
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
    void load(guestId);
  }, [forced, load, guestId]);

  if (forced !== undefined) {
    return (
      <StateSurface state={forced}>
        <p>{t('screen.demo')}</p>
      </StateSurface>
    );
  }

  return (
    <section
      style={{ padding: 'var(--space-s6, 24px)', display: 'grid', gap: 'var(--space-s4, 16px)' }}
    >
      <h1 style={{ margin: 0 }}>{t('crm.loyalty.title')}</h1>
      <p style={{ margin: 0 }}>{t('crm.loyalty.intro')}</p>
      <label style={FIELD_STYLE}>
        {t('crm.loyalty.pick')}
        <select name="guestId" value={guestId} onChange={(event) => setGuestId(event.target.value)}>
          <option value="">{t('crm.loyalty.empty')}</option>
          {guests.map((guest) => (
            <option key={guest.id} value={guest.id}>
              {guest.fullName} · {guest.phone}
            </option>
          ))}
        </select>
      </label>
      <StateSurface state={state}>
        {readError === null ? null : (
          <ScreenAlert error={readError} onRetry={() => void load(guestId)} />
        )}
        {loyalty === null ? null : (
          <table data-testid="loyalty-table" style={{ borderCollapse: 'collapse' }}>
            <tbody>
              <tr>
                <th scope="row" style={{ textAlign: 'start' }}>
                  {t('crm.loyalty.tier')}
                </th>
                <td data-testid="loyalty-tier">{t(TIER_LABEL_KEY[loyalty.loyaltyTier])}</td>
              </tr>
              <tr>
                <th scope="row" style={{ textAlign: 'start' }}>
                  {t('crm.loyalty.points')}
                </th>
                <td data-testid="loyalty-points">{loyalty.loyaltyPoints}</td>
              </tr>
              <tr>
                <th scope="row" style={{ textAlign: 'start' }}>
                  {t('crm.loyalty.stays12')}
                </th>
                <td>{loyalty.staysLast12Months}</td>
              </tr>
              <tr>
                <th scope="row" style={{ textAlign: 'start' }}>
                  {t('crm.loyalty.totalStays')}
                </th>
                <td>{loyalty.totalStays}</td>
              </tr>
              <tr>
                <th scope="row" style={{ textAlign: 'start' }}>
                  {t('crm.loyalty.updatedAt')}
                </th>
                <td>{formatDateTimeVn(loyalty.updatedAt)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </StateSurface>
    </section>
  );
}
